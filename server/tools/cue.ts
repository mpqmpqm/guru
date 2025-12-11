import { tool } from "@anthropic-ai/claude-agent-sdk";
import OpenAI from "openai";
import { z } from "zod";
import { sessionManager } from "../services/session-manager.js";

const openai = new OpenAI();

const VOICE = "alloy";
const VOICE_INSTRUCTIONS =
  "Warm, grounded yoga teacher. Measured pace with natural pauses. Clear articulation, especially Sanskrit. Calm and present—not breathy, not performative. No filler praise. Quiet confidence, unhurried but awake.";
const MS_PER_COUNT = 1000;

export function createCueTool(sessionId: string) {
  return tool(
    "cue",
    "Speaks text to guide the student through a yoga class, then optionally pauses for a number of counts at 60 BPM. Use for breath cues (e.g., 'inhale', 'exhale'), position guidance, and transitions.",
    {
      text: z.string().describe("The text to speak aloud"),
      pause: z
        .number()
        .optional()
        .describe(
          "Number of counts to pause after speaking (at 60 BPM, each count is 1 second). Default is 0."
        ),
    },
    async (args) => {
      const pause = args.pause ?? 0;

      // Generate audio from OpenAI and stream directly to client
      const response = await openai.audio.speech.create({
        model: "tts-1",
        voice: VOICE,
        input: args.text,
        instructions: VOICE_INSTRUCTIONS,
        response_format: "mp3",
      });

      // Notify the client via SSE immediately
      sessionManager.sendSSE(sessionId, "cue", {
        text: args.text,
        pause,
      });

      // Convert web ReadableStream to AsyncIterable<Uint8Array>
      async function* streamToAsyncIterable(
        stream: ReadableStream<Uint8Array>
      ): AsyncIterable<Uint8Array> {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            yield value;
          }
        } finally {
          reader.releaseLock();
        }
      }

      const audioStream = streamToAsyncIterable(response.body!);

      // Pass stream directly - chunks flow to client as they arrive
      await sessionManager.queueAudio(sessionId, audioStream);

      // Wait for the pause duration (browser will reconnect for next cue)
      if (pause > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, pause * MS_PER_COUNT)
        );
      }

      return {
        content: [
          {
            type: "text" as const,
            text:
              pause > 0
                ? `Cue complete with ${pause} count pause`
                : "Cue complete",
          },
        ],
      };
    }
  );
}
