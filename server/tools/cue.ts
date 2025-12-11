import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { sessionManager } from "../services/session-manager.js";

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

// Rachel voice - calm and clear, good for yoga
const VOICE_ID =
  process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
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
      console.log(
        `[cue] called: "${args.text.slice(0, 50)}..." pause=${args.pause || 0}`
      );

      const pause = args.pause ?? 0;

      // Notify the client via SSE immediately
      sessionManager.sendSSE(sessionId, "cue", {
        text: args.text,
        pause,
      });

      // Generate audio from ElevenLabs and stream directly to client
      console.log(`[cue] requesting ElevenLabs audio...`);
      const audioStream = await elevenlabs.textToSpeech.stream(VOICE_ID, {
        text: args.text,
        modelId: "eleven_flash_v2_5",
        outputFormat: "mp3_44100_128",
      });

      // Pass stream directly - chunks flow to client as they arrive
      await sessionManager.queueAudio(sessionId, audioStream);
      console.log(`[cue] audio streamed`);

      // Wait for the pause duration (browser will reconnect for next cue)
      if (pause > 0) {
        console.log(`[cue] waiting ${pause}s...`);
        await new Promise((resolve) => setTimeout(resolve, pause * MS_PER_COUNT));
        console.log(`[cue] pause complete`);
      }

      console.log(`[cue] complete`);
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
