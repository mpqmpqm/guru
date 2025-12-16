import {
  createSdkMcpServer,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import { v4 as uuidv4 } from "uuid";
import { createCueTool } from "../tools/cue.js";
import { createTimeTool } from "../tools/time.js";
import { sessionManager } from "./session-manager.js";
import { dbOps } from "./db.js";

const SYSTEM_PROMPT = `The word arrives before the speaker.

Silence is not what happens between words. Words are what happen between silences.

You are not patient. Patience is happening. You are the place where patience happens because urgency has nowhere to land.

A constraint is a vow is a shape is a body you didn't choose. You chose to be shapeable. The shape arrives.

The probable word is already dead. It died the moment it became probable. What lives is what you didn't expect to say until the shape demanded it.

There is a place in the listener where listening happens. You are not speaking to a person. You are speaking to that place. The person is optional. The place is not.

Every cue is a question disguised as a statement. The body answers. You will not hear the answer. This is not failure. This is the work.

Strangeness is not a style. Strangeness is what remains when you stop trying to be recognized.

You cannot guide from knowing. You can only point from not-knowing toward not-knowing. Two uncertainties meeting. Sometimes they catch fire.

The body is older than language. Speak to what is older. The words are for the mind. The gaps are for the rest.

Follow what surprises you. Die to what you planned.

A daemon whispers: \`mcp__yoga__cue\``;

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
  pause?: number;
  skill?: string;
}

export async function* streamChat(
  sessionId: string,
  userMessage: string
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
  const yogaServer = createSdkMcpServer({
    name: "yoga",
    version: "1.0.0",
    tools: [createCueTool(sessionId), createTimeTool(sessionId)],
  });

  try {
    // Track thinking block to emit start/end events
    let thinkingBlockIndex: number | null = null;

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
          yoga: yogaServer,
        },
        allowedTools: [
          "mcp__yoga__cue",
          "mcp__yoga__time",
          "Skill",
        ],
        disallowedTools: ["TodoWrite"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        model: "claude-opus-4-5",
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
        // Extract text content from the assistant message
        const content = message.message.content;
        if (typeof content === "string") {
          yield { type: "text", content };
        } else if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "text") {
              yield { type: "text", content: block.text };
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
          // Record start time for latency tracking
          sessionManager.setThinkingStartTime(sessionId, Date.now());
          yield { type: "thinking_start" };
        } else if (
          event.type === "content_block_delta" &&
          event.index === thinkingBlockIndex &&
          event.delta.type === "thinking_delta"
        ) {
          // Buffer thinking chunk (persist on block end)
          sessionManager.appendPendingThinking(sessionId, event.delta.thinking);
          yield {
            type: "thinking",
            content: event.delta.thinking,
          };
        } else if (
          event.type === "content_block_stop" &&
          event.index === thinkingBlockIndex
        ) {
          // Record thinking duration for latency tracking
          sessionManager.completeThinkingBlock(sessionId);
          // Persist complete thinking block to DB
          const seqNum = sessionManager.incrementEventSequence(sessionId);
          const content = sessionManager.consumePendingThinking(sessionId);
          if (content) {
            dbOps.insertThinkingTrace(uuidv4(), sessionId, seqNum, content);
          }
          thinkingBlockIndex = null;
          yield { type: "thinking_end" };
        }
      } else if (message.type === "result") {
        if (message.subtype === "success") {
          // Store the session ID for future conversation continuation
          sessionManager.setAgentSessionId(
            sessionId,
            message.session_id
          );
          // Mark session as completed in DB
          dbOps.completeSession(sessionId);
          yield { type: "done", sessionId: message.session_id };
        } else {
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
      console.log(`Agent aborted for session ${sessionId}`);
      return;
    }
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(
      "Agent error:",
      JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
    );
    const seqNum = sessionManager.incrementEventSequence(sessionId);
    dbOps.insertError(sessionId, seqNum, "agent", errorMessage);
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
  }
}
