import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { sessionManager } from "../services/session-manager.js";

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

// Rachel voice - calm and clear, good for yoga
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
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
      // Generate audio stream from ElevenLabs
      const audioStream = await elevenlabs.textToSpeech.stream(VOICE_ID, {
        text: args.text,
        modelId: "eleven_flash_v2_5",
        outputFormat: "mp3_44100_128",
      });

      // Queue the audio to the session's audio stream
      sessionManager.queueAudio(sessionId, audioStream);

      // Queue silence for the pause
      if (args.pause && args.pause > 0) {
        sessionManager.queueSilence(sessionId, args.pause * MS_PER_COUNT);
      }

      // Notify the client via SSE that a cue was spoken
      sessionManager.sendSSE(sessionId, "cue", {
        text: args.text,
        pause: args.pause || 0,
      });

      return {
        content: [
          {
            type: "text" as const,
            text:
              args.pause && args.pause > 0
                ? `Cue complete with ${args.pause} count pause`
                : "Cue complete",
          },
        ],
      };
    }
  );
}
