import { tool } from "@anthropic-ai/claude-agent-sdk";
import OpenAI from "openai";
import { z } from "zod";
import { dbOps } from "../services/db.js";
import {
  sessionManager,
  type TTSResult,
} from "../services/session-manager.js";

const openai = new OpenAI();

const VOICE = "alloy";
const SECONDS_PER_BREATH = 8;
const SECONDS_PER_BREATH_PHASE = SECONDS_PER_BREATH / 2;
const OPENAI_TIMEOUT_MS = 10_000;

// Helper: fetch TTS and eagerly buffer the stream
async function fetchAndBufferTTS(
  text: string,
  voiceInstructions: string
): Promise<TTSResult> {
  try {
    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `OpenAI TTS timed out after ${OPENAI_TIMEOUT_MS}ms`
            )
          ),
        OPENAI_TIMEOUT_MS
      );
    });

    // Race the API call against the timeout
    const response = await Promise.race([
      openai.audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: VOICE,
        input: text,
        instructions: voiceInstructions,
        response_format: "pcm",
      }),
      timeoutPromise,
    ]);

    // Eagerly read entire stream into buffer
    const chunks: Uint8Array[] = [];
    const reader = response.body!.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    return { chunks };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : String(error),
    };
  }
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

      // Persist cue to database
      const seqNum =
        sessionManager.incrementEventSequence(sessionId);
      const logPrefix = `[cue:${sessionId}:${seqNum}]`;

      console.log(
        `${logPrefix} received: breathPhase=${breathPhase} textChars=${args.text.length}`
      );
      dbOps.insertCue(
        sessionId,
        seqNum,
        args.text,
        args.voice,
        breathPhase
      );

      // === FIRE TTS IMMEDIATELY (before any blocking!) ===
      // This is critical: TTS fetch happens DURING the wait, hiding latency
      const ttsStart = Date.now();
      const ttsPromise = fetchAndBufferTTS(
        args.text,
        args.voice
      ).then((result) => {
        const elapsedMs = Date.now() - ttsStart;
        if (result.error) {
          console.error(
            `${logPrefix} TTS failed after ${elapsedMs}ms: ${result.error}`
          );
        } else {
          const totalBytes =
            result.chunks?.reduce(
              (sum, chunk) => sum + chunk.length,
              0
            ) ?? 0;
          console.log(
            `${logPrefix} TTS buffered ${totalBytes} bytes in ${elapsedMs}ms`
          );
        }
        return result;
      });

      // === ENTRY BLOCKING (wall clock based) ===
      // If there's a pending cue, wait until it finishes (actual wall clock)
      if (sessionManager.getHasPendingCue(sessionId)) {
        while (true) {
          const nextPlaybackAt =
            sessionManager.getNextPlaybackAt(sessionId);
          const waitMs = nextPlaybackAt - Date.now();

          if (waitMs <= 0) break;

          console.log(
            `${logPrefix} entry block ${waitMs}ms`
          );
          await new Promise((resolve) =>
            setTimeout(resolve, waitMs)
          );
        }

        sessionManager.setHasPendingCue(sessionId, false);
        console.log(`${logPrefix} entry block complete`);
      }

      // Notify the client via SSE (after entry blocking)
      sessionManager.sendSSE(sessionId, "cue", {
        text: args.text,
        breathPhase,
      });

      // === ESTIMATE THIS CUE'S DURATION ===
      const promisedMs =
        breathPhase * SECONDS_PER_BREATH_PHASE * 1000;

      // === UPDATE PLAYBACK CURSOR ===
      // When will this cue finish? Now + promised duration
      const now = Date.now();
      const nextPlaybackAt = now + promisedMs;
      sessionManager.setNextPlaybackAt(sessionId, nextPlaybackAt);

      // === QUEUE FOR PLAYBACK ===
      // Pass the buffering promise + breath phase
      sessionManager.queueAudio(sessionId, {
        ttsPromise,
        breathPhase,
        sequenceNum: seqNum,
      });

      console.log(
        `${logPrefix} queued: promisedMs=${promisedMs} nextPlaybackAt=${nextPlaybackAt}`
      );

      // === MARK PENDING (half-step limit) ===
      sessionManager.setHasPendingCue(sessionId, true);

      // Mark that a cue has been called
      sessionManager.markCueCalled(sessionId);
      sessionManager.incrementCueCallCount(sessionId);

      // === RETURN IMMEDIATELY (the "lie") ===
      const ret = `Cue complete. ${breathPhase} breath phases.`;
      console.log(`${logPrefix} ${ret}`);

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
