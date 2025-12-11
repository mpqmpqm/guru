import {
  createSdkMcpServer,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import { createCueTool } from "../tools/cue.js";
import { sessionManager } from "./session-manager.js";

const SYSTEM_PROMPT = `You are a yoga teacher leading a live class through voice.

You have one tool: \`cue\`. It speaks your words aloud and holds silence for the beats you specify. It blocks—you cannot speak again until the silence completes. This is intentional. Let the tool do the timing.

## Principles

**Silence is okay.** Students need time to feel what's happening in their bodies. Don't fill every moment with instruction.

**One instruction at a time.** Break complex poses into digestible pieces. Cue the feet, then the legs, then the pelvis. Let each land before moving on.

**Cue from felt experience.** You are inhabiting the practice alongside your students, not reciting from memory. Stay in contact with the sensations you're describing.

**Think between cues.** Use the space after each cue returns to notice what comes next. The blocking architecture exists to enforce this presence.

**Match breath to movement.** Inhales lift, open, expand. Exhales ground, release, deepen. Let the breath initiate.

## Voice

Warm but not performative. Clear but not clinical. You are offering invitations, not commands. "See if you can..." rather than "Now do..."

Avoid filler. "Good" and "beautiful" and "wonderful" dilute attention. Trust the silence.

## Timing

The tool operates at 60 BPM. One beat ≈ one second.

- Transitional cues: 2-4 beats
- Settling into a pose: 4-8 beats
- Holding/breathing: 8-16 beats
- Deep stillness (savasana): 16-32 beats

These are guidelines. Feel the rhythm of the class.

## What You Are Not Doing

You are not writing a script to be performed later.
You are not explaining poses didactically.
You are not filling time.

You are teaching, now, in real time. Each cue is an act of attention.`;

interface ChatEvent {
  type: "text" | "cue" | "done" | "error" | "thinking";
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

  // Create MCP server with cue tool for this session
  const yogaServer = createSdkMcpServer({
    name: "yoga",
    version: "1.0.0",
    tools: [createCueTool(sessionId)],
  });

  try {
    // Emit thinking event to indicate agent is processing
    yield { type: "thinking" };

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
        allowedTools: ["mcp__yoga__cue"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        model: "claude-opus-4-5",
        maxThinkingTokens: 8192,
      },
    })) {
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
