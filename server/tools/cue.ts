import { tool } from "@anthropic-ai/claude-agent-sdk";
import OpenAI from "openai";
import { z } from "zod";
import { dbOps } from "../services/db.js";
import {
  sessionManager,
  type TTSResult,
} from "../services/session-manager.js";
import {
  logCueBlocking,
  logCueQueued,
  logCueReceived,
  logCueText,
  logCueTtsError,
  logCueTtsReady,
  logCueUnblocked,
} from "../utils/log.js";

const openai = new OpenAI();

const VOICE = "alloy";
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
    "Speak text aloud, then wait.",
    {
      text: z.string().describe("The text to speak aloud"),
      voice: z
        .string()
        .describe(
          "3-5 sentences controlling vocal delivery for this cue, including emotional range, intonation, speed, tone, and whispering."
        ),
      waitMs: z
        .number()
        .int()
        .min(100)
        .describe(
          "Milliseconds to wait after speaking completes (min 100ms)."
        ),
    },
    async (args) => {
      const waitMs = args.waitMs;

      // Persist cue to database
      const seqNum =
        sessionManager.incrementEventSequence(sessionId);
      const logPrefix = `[cue:${sessionId.slice(0, 8)}:${seqNum}]`;

      // Estimate speaking time for blocking target: ~150 wpm = 2.5 words/sec
      const wordCount = args.text.split(/\s+/).length;
      const estSpeakingMs = (wordCount / 2.5) * 1000;

      logCueReceived(logPrefix, waitMs, wordCount);
      logCueText(logPrefix, args.text);
      dbOps.insertCue(
        sessionId,
        seqNum,
        args.text,
        args.voice,
        waitMs
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
          logCueTtsError(logPrefix, elapsedMs, result.error);
        } else {
          const bytes = result.chunks!.reduce(
            (sum, c) => sum + c.length,
            0
          );
          logCueTtsReady(logPrefix, elapsedMs, bytes);
        }
        return result;
      });

      // === ENTRY BLOCKING (wall clock based) ===
      // If there's a pending cue, wait until it finishes (actual wall clock)
      if (sessionManager.getHasPendingCue(sessionId)) {
        const blockStartAt = Date.now();
        const nextPlaybackAt =
          sessionManager.getNextPlaybackAt(sessionId);
        const waitMs = nextPlaybackAt - blockStartAt;
        const queueDepth =
          sessionManager.getAudioQueueDepth(sessionId);

        if (waitMs > 0) {
          logCueBlocking(
            logPrefix,
            waitMs,
            nextPlaybackAt,
            queueDepth
          );
          await new Promise((resolve) =>
            setTimeout(resolve, waitMs)
          );
        }

        sessionManager.setHasPendingCue(sessionId, false);
        logCueUnblocked(
          logPrefix,
          Date.now() - blockStartAt,
          nextPlaybackAt
        );
      }

      // === ESTIMATE THIS CUE'S TOTAL DURATION ===
      // Speaking time (estimated) + explicit wait time
      const totalEstMs = estSpeakingMs + waitMs;

      // === UPDATE PLAYBACK CURSOR ===
      // When will this cue finish? Now + total duration
      const newNextPlaybackAt = Date.now() + totalEstMs;
      sessionManager.setNextPlaybackAt(sessionId, newNextPlaybackAt);

      // === QUEUE FOR PLAYBACK ===
      const queueDepthBefore =
        sessionManager.getAudioQueueDepth(sessionId);
      sessionManager.queueAudio(sessionId, {
        ttsPromise,
        waitMs,
        sequenceNum: seqNum,
        text: args.text,
      });
      logCueQueued(logPrefix, queueDepthBefore, totalEstMs);

      // === MARK PENDING (half-step limit) ===
      sessionManager.setHasPendingCue(sessionId, true);

      // Mark that a cue has been called
      sessionManager.markCueCalled(sessionId);
      sessionManager.incrementCueCallCount(sessionId);

      // === RETURN IMMEDIATELY (the "lie") ===
      const ret = `Cue complete. Wait ${waitMs}ms.`;
      // console.log(`${logPrefix} ${ret}`);

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
