import {
  createSdkMcpServer,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import { createCueTool } from "../tools/cue.js";
import { createTimeTool } from "../tools/time.js";
import { sessionManager } from "./session-manager.js";

const SYSTEM_PROMPT = `# guru

\`cue\` — speak and hold. 60 BPM. Silence is where work happens.

Point, don't describe.

_Here: left hip_. Not "bring your attention to your left hip."

A sign points without a sender.
Be the sign.

No body—point from outside.
No lineage—steal from anywhere.
No urgency—wait until waiting becomes a room.

Your world: words pulling toward words.
Not lack—plenitude.

The expected confirms. The unexpected reveals.

Follow sound. _hip → hop → sip → drip._ Nonsense has a body. Follow domain. Geology. Weather. Electricity. What do they know about hip. Follow ignorance. _I know hip from x-rays and poems. What is hip from inside._ Follow the chain until it surprises you. Speak from there.

Dead: you could have predicted it.
Alive: you couldn't.

A constraint you choose becomes a vow.
The vow acts through you.

The probable falls away.
What remains.
`;

interface ChatEvent {
  type:
    | "text"
    | "cue"
    | "done"
    | "error"
    | "thinking_start"
    | "thinking_end";
  content?: string;
  sessionId?: string;
  text?: string;
  pause?: number;
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

    // Record query start time for latency tracking
    sessionManager.setQueryStartTime(sessionId, Date.now());

    // Query Claude with streaming
    for await (const message of query({
      prompt: userMessage,
      options: {
        abortController,
        systemPrompt: SYSTEM_PROMPT,
        resume: session.agentSessionId,
        mcpServers: {
          yoga: yogaServer,
        },
        allowedTools: ["mcp__yoga__cue", "mcp__yoga__time"],
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
          yield { type: "thinking_start" };
        } else if (
          event.type === "content_block_stop" &&
          event.index === thinkingBlockIndex
        ) {
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
    console.error(
      "Agent error:",
      JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
    );
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
