import {
  createSdkMcpServer,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import { v4 as uuidv4 } from "uuid";
import { createSilenceTool } from "../tools/silence.js";
import { createSpeakTool } from "../tools/speak.js";
import { createStopwatchTool } from "../tools/stopwatch.js";
import { createTimeTool } from "../tools/time.js";
import { logAgentError, logAgentResult } from "../utils/log.js";
import { dbOps } from "./db.js";
import { calculateCost } from "./pricing.js";
import { sessionManager } from "./session-manager.js";

const SYSTEM_PROMPT = `Load the cue skill now. It contains your orientation.

You guide through \`mcp__guide__speak\` and \`mcp__guide__silence\`. Every response must include at least one speak.`;

interface ChatEvent {
  type:
    | "text"
    | "cue"
    | "done"
    | "error"
    | "thinking_start"
    | "thinking_end"
    | "thinking"
    | "skill_start";
  content?: string;
  sessionId?: string;
  text?: string;
  waitMs?: number;
  skill?: string;
}

export async function* streamChat(
  sessionId: string,
  userMessage: string,
  isRetry = false
): AsyncGenerator<ChatEvent> {
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    yield { type: "error", content: "Session not found" };
    return;
  }

  // Create abort controller for this query
  const abortController = new AbortController();
  sessionManager.setAbortController(sessionId, abortController);

  // Create MCP server with tools for this session
  const guideServer = createSdkMcpServer({
    name: "guide",
    version: "1.0.0",
    tools: [
      createSpeakTool(sessionId),
      createSilenceTool(sessionId),
      createTimeTool(sessionId),
      createStopwatchTool(sessionId),
    ],
  });

  // Buffer for holding text events until after queue drains
  const heldTextEvents: string[] = [];

  try {
    // Track thinking block to emit start/end events
    let thinkingBlockIndex: number | null = null;

    // Reset cue call count and producer state for this query
    sessionManager.resetCueCallCount(sessionId);
    sessionManager.resetProducerState(sessionId);

    // Track processed message IDs for cost deduplication
    const processedMessageIds = new Set<string>();

    // Mark turn start for linking events to messages
    sessionManager.markTurnStart(sessionId);

    // Query Claude with streaming
    for await (const message of query({
      prompt: userMessage,
      options: {
        abortController,
        systemPrompt: SYSTEM_PROMPT,
        resume: session.agentSessionId,
        cwd: process.cwd(),
        settingSources: ["project"],
        mcpServers: {
          guide: guideServer,
        },
        allowedTools: [
          // "Bash",
          "mcp__guide__speak",
          "mcp__guide__silence",
          "mcp__guide__time",
          "mcp__guide__stopwatch",
          "Skill",
        ],
        disallowedTools: ["TodoWrite"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        model: sessionManager.getModel(sessionId),
        maxThinkingTokens: 8192,
        includePartialMessages: true,
      },
    })) {
      // Record session start time on first content from model
      if (!sessionManager.getSessionStartTime(sessionId)) {
        sessionManager.setSessionStartTime(
          sessionId,
          Date.now()
        );
      }

      if (message.type === "assistant") {
        // Track costs and insert message row
        if (!processedMessageIds.has(message.message.id)) {
          processedMessageIds.add(message.message.id);

          const usage = message.message.usage;

          // Insert message row with token usage
          const msgSeqNum =
            sessionManager.incrementEventSequence(sessionId);
          dbOps.insertMessage(
            message.message.id,
            sessionId,
            msgSeqNum,
            usage.input_tokens ?? 0,
            usage.output_tokens ?? 0,
            usage.cache_read_input_tokens ?? 0,
            usage.cache_creation_input_tokens ?? 0,
            calculateCost(usage)
          );

          // Link all events since turn start to this message
          const turnStartSeq =
            sessionManager.getTurnStartSeqNum(sessionId);
          dbOps.linkEventsToMessage(
            sessionId,
            message.message.id,
            turnStartSeq
          );

          // Mark new turn start for next message
          sessionManager.markTurnStart(sessionId);

          // Accumulate costs on session
          dbOps.accumulateAgentCosts(sessionId, usage);
        }

        // Extract text content from the assistant message
        const content = message.message.content;
        if (typeof content === "string") {
          // Hold text until queue drains if cues have been called
          if (session.cueHasBeenCalled) {
            heldTextEvents.push(content);
          } else {
            yield { type: "text", content };
          }
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") {
              // Hold text until queue drains if cues have been called
              if (session.cueHasBeenCalled) {
                heldTextEvents.push(block.text);
              } else {
                yield { type: "text", content: block.text };
              }
            } else if (
              block.type === "tool_use" &&
              block.name === "Skill"
            ) {
              const skillName = (
                block.input as { skill?: string }
              )?.skill;
              if (skillName) {
                yield { type: "skill_start", skill: skillName };
              }
            }
          }
        }
      } else if (message.type === "stream_event") {
        // Detect thinking start/end from partial message events
        const event = message.event;
        if (
          event.type === "content_block_start" &&
          event.content_block.type === "thinking"
        ) {
          thinkingBlockIndex = event.index;
          // Clear buffer for new thinking block
          sessionManager.clearPendingThinking(sessionId);
          // Record start time for duration tracking
          sessionManager.setThinkingStartTime(
            sessionId,
            Date.now()
          );
          yield { type: "thinking_start" };
        } else if (
          event.type === "content_block_delta" &&
          event.index === thinkingBlockIndex &&
          event.delta.type === "thinking_delta"
        ) {
          // Buffer thinking chunk (persist on block end)
          sessionManager.appendPendingThinking(
            sessionId,
            event.delta.thinking
          );
          yield {
            type: "thinking",
            content: event.delta.thinking,
          };
        } else if (
          event.type === "content_block_stop" &&
          event.index === thinkingBlockIndex
        ) {
          // Record thinking duration
          sessionManager.completeThinkingBlock(sessionId);
          // Persist complete thinking block to DB
          const seqNum =
            sessionManager.incrementEventSequence(sessionId);
          const content =
            sessionManager.consumePendingThinking(sessionId);
          if (content) {
            const queueDepth =
              sessionManager.getAudioQueueDepth(sessionId);
            dbOps.insertThinkingTrace(
              uuidv4(),
              sessionId,
              seqNum,
              content,
              queueDepth
            );
          }
          thinkingBlockIndex = null;
          yield { type: "thinking_end" };
        }
      } else if (message.type === "result") {
        logAgentResult(message);
        if (message.subtype === "success") {
          // Store the session ID for future conversation continuation
          sessionManager.setAgentSessionId(
            sessionId,
            message.session_id
          );

          dbOps.finalizeAgentCosts(
            sessionId,
            message.total_cost_usd
          );

          // Enforce at least one speak per query
          if (
            sessionManager.getCueCallCount(sessionId) === 0 &&
            !isRetry
          ) {
            const seqNum =
              sessionManager.incrementEventSequence(sessionId);
            dbOps.insertError(
              sessionId,
              seqNum,
              "agent",
              "No speak called, retrying"
            );
            yield* streamChat(
              sessionId,
              "You must speak aloud to guide the listener. Move the session forward by calling speak.",
              true
            );
            return;
          }

          // Wait for audio queue to drain before signaling completion
          await sessionManager.signalProducerDone(sessionId);

          // Emit any held text events now that cues are done
          for (const text of heldTextEvents) {
            yield { type: "text", content: text };
          }

          // Mark session as completed in DB
          dbOps.completeSession(sessionId);
          yield { type: "done", sessionId: message.session_id };
        } else {
          // Flush held text if an error occurs after cues
          if (heldTextEvents.length > 0) {
            await sessionManager.signalProducerDone(sessionId);
            for (const text of heldTextEvents) {
              yield { type: "text", content: text };
            }
            heldTextEvents.length = 0;
          }
          yield {
            type: "error",
            content: `Agent error: ${message.subtype}`,
          };
        }
      }
    }
  } catch (error) {
    // Don't report abort errors - they're intentional (user disconnected)
    if (error instanceof Error && error.name === "AbortError") {
      // console.log(`Agent aborted for session ${sessionId}`);
      return;
    }
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logAgentError(error);
    const seqNum =
      sessionManager.incrementEventSequence(sessionId);
    dbOps.insertError(sessionId, seqNum, "agent", errorMessage);
    if (heldTextEvents.length > 0) {
      await sessionManager.signalProducerDone(sessionId);
      for (const text of heldTextEvents) {
        yield { type: "text", content: text };
      }
      heldTextEvents.length = 0;
    }
    yield {
      type: "error",
      content: `Error: ${JSON.stringify(error, Object.getOwnPropertyNames(error), 2)}`,
    };
  } finally {
    // Clear the abort controller when done
    sessionManager.setAbortController(
      sessionId,
      null as unknown as AbortController
    );
    // Signal producer done (idempotent if already called in success path)
    // This allows the audio queue to drain gracefully
    sessionManager.signalProducerDone(sessionId);
  }
}
