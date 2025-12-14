import { tool } from "@anthropic-ai/claude-agent-sdk";
import OpenAI from "openai";
import { z } from "zod";
import { sessionManager } from "../services/session-manager.js";

const openai = new OpenAI();

const VOICE = "alloy";
const MS_PER_COUNT = 1000;

// Track latencies separately for running averages (in seconds)
const queryLatencies: number[] = [];
const openaiLatencies: number[] = [];
const MAX_LATENCY_SAMPLES = 10;
const INCLUDE_OPENAI_LATENCY = false;

function recordLatency(arr: number[], value: number): void {
  arr.push(value);
  if (arr.length > MAX_LATENCY_SAMPLES) {
    arr.shift();
  }
}

function average(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function computeAverageLatency(): number {
  const queryAvg = average(queryLatencies);
  const openaiAvg = INCLUDE_OPENAI_LATENCY
    ? average(openaiLatencies)
    : 0;
  const total = queryAvg + openaiAvg;
  return total;
}

export function createCueTool(sessionId: string) {
  return tool(
    "cue",
    "Speak and hold. 60 BPM. Silence is where work happens.",
    {
      text: z.string().describe("The text to speak aloud"),
      voice: z
        .string()
        .describe("2-3 sentences: delivery, tone, texture"),
      pause: z
        .number()
        .optional()
        .describe("Counts to hold after speaking (60 BPM). Default 0."),
    },
    async (args) => {
      const pause = args.pause ?? 0;
      const queryStartTime =
        sessionManager.getQueryStartTime(sessionId);

      // Record query latency (time since last cue or query start)
      if (queryStartTime) {
        recordLatency(
          queryLatencies,
          (Date.now() - queryStartTime) / 1000
        );
      }

      // Generate audio from OpenAI and stream directly to client
      const openaiStart = Date.now();
      const voiceInstructions = args.voice;
      const response = await openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: VOICE,
        input: args.text,
        instructions: voiceInstructions,
        response_format: "pcm",
      });
      recordLatency(
        openaiLatencies,
        (Date.now() - openaiStart) / 1000
      );

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

      // Send pause start/end events - client counts down from duration
      const adjusted = Math.max(
        0,
        pause - computeAverageLatency()
      );
      if (pause > 0) {
        sessionManager.sendSSE(sessionId, "pause_start", {
          duration: pause,
        });
        await new Promise((resolve) =>
          setTimeout(resolve, adjusted * MS_PER_COUNT)
        );
      }

      // Reset timestamp for next cue measurement
      sessionManager.setQueryStartTime(sessionId, Date.now());

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
