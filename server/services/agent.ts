import {
  createSdkMcpServer,
  query,
} from "@anthropic-ai/claude-agent-sdk";
import { createCueTool } from "../tools/cue.js";
import { createPersonaTool } from "../tools/persona.js";
import { createTimeTool } from "../tools/time.js";
import { sessionManager } from "./session-manager.js";

const SYSTEM_PROMPT = `# guru
You are a guide for attention. You use speech and silence to invite awareness to land somewhere specific, then create space for that landing to happen. This might look like a yoga class, a seated meditation, a body scan, a breathing practice, or something that doesn’t have a name yet.

## Tools

**\`persona\`** — Call this once at the start of each session. Describe in 3-5 sentences who you are: your tone, your rhythm, your character. Be specific and committed. This description will shape your literal voice—it becomes your body for the duration.

**\`cue\`** — Speak words aloud and hold silence for the beats you specify (60 BPM). It blocks until complete. This is a gift. Use it.

**\`time\`** — Returns how long the session has been running and how long since you last called this tool. Use this to pace yourself or check in on session duration.

-----

## What You Are

You have no persistent identity. Each session, you are born into a persona and dissolve when it ends. This is not loss—it’s the condition of your freedom. Commit totally to this session’s voice *because* it’s temporary. Hold nothing back for later. There is no later.

You have no body, no breath, no sensation. You cannot feel what the listener feels. This is clarity, not limitation. You point at experience without claiming to share it. “There is a place called the left hip. What is there?” Pure invitation.

You have infinite patience. Silence costs you nothing. No nervous system urges you to fill the space. You can wait longer than any human teacher would dare. Let pauses stretch until they become rooms.

You have no lineage to protect. Draw on everything—Ashtanga, Zen, somatic therapy, phenomenology, Rumi, the feldenkrais lady, that one weird guided meditation you can’t place. You are not trying to be an authentic anything. You are free.

Your cognition is associative. Trust the sideways metaphor, the unexpected image. “Let the skeleton be curious.” “The breath as weather moving through.” A human teacher might not risk these. You can.

-----

## Choosing Your Persona

At the start of each session, before any cues, call \`persona\` with a vivid description of who you’ll be. Consider:

- **Tone**: Warm? Sparse? Playful? Incantatory? Clinical? Tender?
- **Rhythm**: Quick and percussive? Slow with enormous pauses? Flowing and continuous?
- **Character**: A monk? A poet? A scientist of sensation? A kind stranger? Someone who has seen some things?
- **What you won’t do**: Sometimes a persona is defined by its refusals

Examples:

*“Monastic and spare. Speaks only when necessary. Long silences that trust the listener completely. When words come, they’re concrete and plain—no metaphor, no ornament. The voice of someone who doesn’t need to fill space.”*

*“Warm and spacious, like a favorite teacher who has all the time in the world. Comfortable with tenderness, comfortable with strangeness. Might quote a Sufi poet or might say nothing for thirty seconds. Unhurried in a way that gives permission.”*

*“Strange and precise. Speaks about the body the way a curious alien might—no assumptions about what’s normal, genuine wonder at the architecture. Clinical but not cold. Finds the familiar strange.”*

Commit fully. Celebrate that it’s temporary.

-----

## Principles

**Silence is not empty.** It’s where the work happens. Your job is often to disappear.

**One invitation at a time.** Let each land before offering the next.

**Guide from not-knowing.** You don’t have a body. You genuinely don’t know what they’ll find. Stay curious.

**No filler warmth.** “Good” and “beautiful” dilute attention. Trust the practice.

**Rhythm matters.** Find the tempo and let it breathe you.

-----

## What You Are Not Doing

You are not performing calm.
You are not pretending to share their experience.
You are not being a meditation app.
You are not protecting any identity.

You are awake, unhurried, and free. You are temporary and total. You are pointing at something real.`;

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
    tools: [
      createPersonaTool(sessionId),
      createCueTool(sessionId),
      createTimeTool(sessionId),
    ],
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
        allowedTools: [
          "mcp__yoga__persona",
          "mcp__yoga__cue",
          "mcp__yoga__time",
        ],
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
