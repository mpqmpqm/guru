import { tool } from "@anthropic-ai/claude-agent-sdk";
import OpenAI from "openai";
import { encoding_for_model } from "tiktoken";
import { z } from "zod";
import { dbOps } from "../services/db.js";
import {
  MIN_SPEAK_DELAY,
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
import { getTimeComponents, getTimeInfo } from "./time.js";

// Reusable encoder for TTS token counting
const ttsEncoder = encoding_for_model("gpt-4o");

let openaiClient: OpenAI | null = null;

const OPENAI_TIMEOUT_MS = 10_000;

// PCM audio: 24kHz, 16-bit mono
const BYTES_PER_SECOND = 24000 * 2;

export const SPEAK_TOOL_NAME = "speak";
export const SPEAK_TOOL_DESCRIPTION =
  "Deliver spoken guidance. Returns speaking duration (e.g., 'spoke 3.2s')—use this to size the following silence. Chain multiple speaks for alignment or flow sequences, then land with silence().";
export const speakArgShape = {
  content: z.string().describe("The text to speak aloud"),
  voice: z
    .string()
    .describe(
      "3-5 sentences controlling vocal delivery for this cue, including emotional range, intonation, speed, tone, and whispering."
    ),
};
export const speakArgsSchema = z.object(speakArgShape).strict();
export type SpeakArgs = z.infer<typeof speakArgsSchema>;

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    openaiClient = new OpenAI();
  }
  return openaiClient;
}

// Helper: fetch TTS and eagerly buffer the stream
async function fetchAndBufferTTS(
  text: string,
  voiceInstructions: string,
  voice: string
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
      getOpenAIClient().audio.speech.create({
        model: "gpt-4o-mini-tts",
        voice: voice as "alloy" | "shimmer" | "marin",
        input: text,
        instructions: voiceInstructions,
        response_format: "pcm",
      }),
      timeoutPromise,
    ]);

    console.log(voice, text.slice(0, 30));

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

export async function runSpeakTool(
  sessionId: string,
  args: SpeakArgs
): Promise<string> {
  const stackSize = sessionManager.getStackSize(sessionId);

  // Persist speak to database
  const seqNum = sessionManager.incrementEventSequence(sessionId);
  const logPrefix = `[speak:${sessionId.slice(0, 8)}:${seqNum}]`;

  const wordCount = args.content.split(/\s+/).length;

  logCueReceived(logPrefix, MIN_SPEAK_DELAY, wordCount);
  logCueText(logPrefix, args.content);

  // === AWAIT TTS TO GET DURATION ===
  // Block until we know the audio length for synthetic time
  const ttsStart = Date.now();
  const voice = sessionManager.getVoice(sessionId);
  const ttsResult = await fetchAndBufferTTS(
    args.content,
    args.voice,
    voice
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

    // Track TTS cost (text + voice instructions)
    const inputTokens = ttsEncoder.encode(
      args.content + args.voice
    ).length;
    dbOps.accumulateTTSCost(sessionId, inputTokens);
  }

  // Advance synthetic clock BEFORE returning
  sessionManager.advanceAgentSyntheticClock(
    sessionId,
    speakingMs + MIN_SPEAK_DELAY
  );

  // Mark when this speak completed (for silence tracking)
  sessionManager.markLastSpeak(sessionId);

  // Track cumulative speaking time for ratio
  sessionManager.addSpeakingTime(sessionId, speakingMs);

  // === BLOCK IF QUEUE IS FULL ===
  // Wait until an item is dequeued (playback completes)
  await sessionManager.waitForQueueRoom(sessionId, stackSize);

  // === QUEUE FOR PLAYBACK ===
  const queueDepthBefore =
    sessionManager.getAudioQueueDepth(sessionId);
  sessionManager.queueAudio(sessionId, {
    ttsResult,
    sequenceNum: seqNum,
    text: args.content,
  });
  logCueQueued(logPrefix, queueDepthBefore, stackSize);

  // Mark that a speak has been called
  sessionManager.markCueCalled(sessionId);
  sessionManager.incrementCueCallCount(sessionId);

  // === RETURN WITH ACTUAL DURATION + TIME + RATIO ===
  const ratio = sessionManager.getSpeakSilenceRatio(sessionId);
  const { elapsedMs, wallClock } = getTimeComponents(sessionId);
  const result = `spoke ${(speakingMs / 1000).toFixed(1)}s | ${ratio} | ${getTimeInfo(sessionId)}`;

  // Persist speak to database (after we have all data)
  dbOps.insertSpeak(
    sessionId,
    seqNum,
    args.content,
    args.voice,
    Math.round(speakingMs),
    ratio,
    elapsedMs,
    wallClock,
    queueDepthBefore + 1
  );

  return result;
}

export function createSpeakTool(sessionId: string) {
  return tool(
    SPEAK_TOOL_NAME,
    SPEAK_TOOL_DESCRIPTION,
    speakArgShape,
    async (args) => {
      const text = await runSpeakTool(sessionId, args);
      return {
        content: [
          {
            type: "text" as const,
            text,
          },
        ],
      };
    }
  );
}
