import { tool } from "@anthropic-ai/claude-agent-sdk";
import OpenAI from "openai";
import { z } from "zod";
import { dbOps } from "../services/db.js";
import { sessionManager } from "../services/session-manager.js";

const openai = new OpenAI();

const VOICE = "alloy";
const SECONDS_PER_BREATH = 8;
const SECONDS_PER_BREATH_PHASE = SECONDS_PER_BREATH / 2;
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
    "Speak and hold. One breath is 8 seconds (two phases).",
    {
      text: z.string().describe("The text to speak aloud"),
      voice: z
        .string()
        .describe(
          "3-5 sentences controlling vocal delivery for this cue, including emotional range, intonation, speed, tone, and whispering."
        ),
      breathPhase: z
        .number()
        .int()
        .min(0)
        .describe(
          "Total expected breath phases for this cue (>= 0). A phase is one inhale or exhale; two phases = one full breath (~8 seconds)."
        ),
    },
    async (args) => {
      const breathPhase = args.breathPhase;
      const totalPhaseSeconds =
        breathPhase * SECONDS_PER_BREATH_PHASE;

      console.dir(args);
      console.time("tts");

      // Persist cue to database
      const seqNum =
        sessionManager.incrementEventSequence(sessionId);
      dbOps.insertCue(
        sessionId,
        seqNum,
        args.text,
        args.voice,
        breathPhase
      );

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
        breathPhase,
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
      console.timeEnd("tts");
      // Pass stream directly - chunks flow to client as they arrive
      await sessionManager.queueAudio(sessionId, audioStream);
      const speakingSeconds = (Date.now() - openaiStart) / 1000;
      const silenceSeconds = Math.max(
        0,
        totalPhaseSeconds - speakingSeconds
      );

      // Send breathe start events - client counts down from duration
      if (silenceSeconds > 0) {
        sessionManager.sendSSE(sessionId, "breathe_start", {
          duration: silenceSeconds,
        });
        await new Promise((resolve) =>
          setTimeout(resolve, silenceSeconds * 1000)
        );
      }

      // Mark that a cue has been called
      sessionManager.markCueCalled(sessionId);
      sessionManager.incrementCueCallCount(sessionId);

      const ret = `Cue complete. ${(
        speakingSeconds / SECONDS_PER_BREATH_PHASE
      ).toFixed(1)} breath phases speaking, ${(
        silenceSeconds / SECONDS_PER_BREATH_PHASE
      ).toFixed(1)} breath phases in silence.`;

      console.log(`[cue] ${ret}`);
      return {
        content: [
          {
            type: "text" as const,
            text: ret,
          },
        ],
      };
    }
  );
}
