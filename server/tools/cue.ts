import { tool } from "@anthropic-ai/claude-agent-sdk";
import OpenAI from "openai";
import { z } from "zod";
import { dbOps } from "../services/db.js";
import { sessionManager } from "../services/session-manager.js";

const openai = new OpenAI();

const VOICE = "alloy";
const MS_PER_COUNT = 1000;
const OPENAI_TIMEOUT_MS = 10_000;

// Timeout wrapper for promises
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorMessage: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(errorMessage)), ms);
  });
  return Promise.race([promise, timeout]);
}

// Track latencies separately for running averages (in seconds)
const interCueLatencies: number[] = []; // Time from cue return to next cue invocation
const openaiTtfbLatencies: number[] = [];
const MAX_LATENCY_SAMPLES = 10;

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
  const interCueAvg = average(interCueLatencies);
  const openaiAvg = average(openaiTtfbLatencies);
  return interCueAvg + openaiAvg;
}

export function createCueTool(sessionId: string) {
  return tool(
    "cue",
    "Speak and hold. 60 BPM. Silence is where work happens.",
    {
      text: z.string().describe("The text to speak aloud"),
      voice: z
        .string()
        .describe(
          "3-5 sentences controlling vocal delivery for this cue, including emotional range, intonation, speed, tone, and whispering."
        ),
      pause: z
        .number()
        .optional()
        .describe(
          "Counts to hold after speaking (60 BPM). Default 0."
        ),
    },
    async (args) => {
      const pause = args.pause ?? 0;

      // Persist cue to database
      const seqNum =
        sessionManager.incrementEventSequence(sessionId);
      dbOps.insertCue(
        sessionId,
        seqNum,
        args.text,
        args.voice,
        pause
      );

      // Record inter-cue latency (time from last cue return to this invocation)
      const lastReturnTime =
        sessionManager.getLastCueReturnTime(sessionId);
      if (lastReturnTime !== undefined) {
        const interCueLatency =
          (Date.now() - lastReturnTime) / 1000;
        recordLatency(interCueLatencies, interCueLatency);
      }

      // Generate audio from OpenAI and stream directly to client
      const openaiStart = Date.now();
      const voiceInstructions = args.voice;

      let response;
      try {
        response = await withTimeout(
          openai.audio.speech.create({
            model: "gpt-4o-mini-tts",
            voice: VOICE,
            input: args.text,
            instructions: voiceInstructions,
            response_format: "pcm",
          }),
          OPENAI_TIMEOUT_MS,
          `OpenAI TTS timed out after ${OPENAI_TIMEOUT_MS}ms`
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        console.error(`[cue] OpenAI error: ${message}`);
        dbOps.insertError(sessionId, seqNum, "openai", message);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error generating audio: ${message}. Continuing without audio.`,
            },
          ],
          isError: true,
        };
      }

      // Notify the client via SSE immediately
      sessionManager.sendSSE(sessionId, "cue", {
        text: args.text,
        pause,
      });

      // Convert web ReadableStream to AsyncIterable<Uint8Array> and measure TTFB
      let ttfbRecorded = false;
      async function* streamToAsyncIterable(
        stream: ReadableStream<Uint8Array>
      ): AsyncIterable<Uint8Array> {
        const reader = stream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            // Record time to first byte
            if (!ttfbRecorded) {
              recordLatency(
                openaiTtfbLatencies,
                (Date.now() - openaiStart) / 1000
              );
              ttfbRecorded = true;
            }
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
        // pause - computeAverageLatency()
        pause
      );
      if (pause > 0) {
        sessionManager.sendSSE(sessionId, "pause_start", {
          duration: pause,
        });
        await new Promise((resolve) =>
          setTimeout(resolve, adjusted * MS_PER_COUNT)
        );
      }

      // Mark that a cue has been called
      sessionManager.markCueCalled(sessionId);
      sessionManager.incrementCueCallCount(sessionId);

      // Record return time for inter-cue latency tracking
      sessionManager.setLastCueReturnTime(sessionId, Date.now());

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
