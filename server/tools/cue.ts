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

      // Generate audio from OpenAI
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

      // Queue audio - may block if queue is at capacity (backpressure)
      // Blocking is invisible to agent via presentation time
      await sessionManager.queueAudio(sessionId, audioStream);

      // Wait for pause duration
      if (pause > 0) {
        sessionManager.sendSSE(sessionId, "pause_start", {
          duration: pause,
        });
        await new Promise((resolve) =>
          setTimeout(resolve, pause * MS_PER_COUNT)
        );
      }

      // Track cue calls
      sessionManager.markCueCalled(sessionId);
      sessionManager.incrementCueCallCount(sessionId);

      return {
        content: [
          {
            type: "text" as const,
            text: "Delivered.",
          },
        ],
      };
    }
  );
}
