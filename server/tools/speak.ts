import { tool } from "@anthropic-ai/claude-agent-sdk";
import OpenAI from "openai";
import { z } from "zod";
import { dbOps } from "../services/db.js";
import {
  sessionManager,
  type TTSResult,
} from "../services/session-manager.js";
import {
  logCueQueued,
  logCueReceived,
  logCueText,
  logCueTtsError,
  logCueTtsReady,
} from "../utils/log.js";
import { getTimeInfo } from "./time.js";

const openai = new OpenAI();

const VOICE = "alloy";
const OPENAI_TIMEOUT_MS = 10_000;

// PCM audio: 24kHz, 16-bit mono
const BYTES_PER_SECOND = 24000 * 2;

// Fixed delay after audio for queue pacing
const MIN_DELAY = 200;

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

export function createSpeakTool(sessionId: string) {
  return tool(
    "speak",
    "Speak text aloud.",
    {
      content: z.string().describe("The text to speak aloud"),
      voice: z
        .string()
        .describe(
          "3-5 sentences controlling vocal delivery for this cue, including emotional range, intonation, speed, tone, and whispering."
        ),
    },
    async (args) => {
      const stackSize = sessionManager.getStackSize(sessionId);

      // Persist speak to database
      const seqNum =
        sessionManager.incrementEventSequence(sessionId);
      const logPrefix = `[speak:${sessionId.slice(0, 8)}:${seqNum}]`;

      const wordCount = args.content.split(/\s+/).length;

      logCueReceived(logPrefix, MIN_DELAY, wordCount);
      logCueText(logPrefix, args.content);
      dbOps.insertSpeak(
        sessionId,
        seqNum,
        args.content,
        args.voice
      );

      // === AWAIT TTS TO GET DURATION ===
      // Block until we know the audio length for synthetic time
      const ttsStart = Date.now();
      const ttsResult = await fetchAndBufferTTS(
        args.content,
        args.voice
      );
      const ttsElapsedMs = Date.now() - ttsStart;

      // Calculate speaking duration and advance synthetic clock
      let speakingMs: number;
      if (ttsResult.error) {
        logCueTtsError(logPrefix, ttsElapsedMs, ttsResult.error);
        // Estimate duration from word count on error
        speakingMs = (wordCount / 2.5) * 1000;
      } else {
        const bytes = ttsResult.chunks!.reduce(
          (sum, c) => sum + c.length,
          0
        );
        logCueTtsReady(logPrefix, ttsElapsedMs, bytes);
        speakingMs = (bytes / BYTES_PER_SECOND) * 1000;
      }

      // Advance synthetic clock BEFORE returning
      sessionManager.advanceAgentSyntheticClock(
        sessionId,
        speakingMs + MIN_DELAY
      );

      // === BLOCK IF QUEUE IS FULL ===
      // Wait until an item is dequeued (playback completes)
      await sessionManager.waitForQueueRoom(
        sessionId,
        stackSize
      );

      // === QUEUE FOR PLAYBACK ===
      const queueDepthBefore =
        sessionManager.getAudioQueueDepth(sessionId);
      sessionManager.queueAudio(sessionId, {
        ttsResult,
        sequenceNum: seqNum,
        text: args.content,
      });
      logCueQueued(
        logPrefix,
        queueDepthBefore,
        MIN_DELAY,
        0,
        stackSize
      );

      // Mark that a speak has been called
      sessionManager.markCueCalled(sessionId);
      sessionManager.incrementCueCallCount(sessionId);

      // === RETURN WITH ACTUAL DURATION + TIME ===
      const ret = `Spoke for ${Math.round(speakingMs)}ms. ${getTimeInfo(sessionId)}`;

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
