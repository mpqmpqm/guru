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
  logCueSseSend,
  logCueTargetSet,
  logCueText,
  logCueTtsError,
  logCueTtsReady,
  logCueUnblocked,
} from "../utils/log.js";

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
      const logPrefix = `[cue:${sessionId.slice(0, 8)}:${seqNum}]`;
      const cueReceivedAt = Date.now();

      // Estimate speaking time: ~150 wpm = 2.5 words/sec, avg word ~5 chars
      // So ~12.5 chars/sec, or ~50 chars per 4-sec breath phase
      const wordCount = args.text.split(/\s+/).length;
      const estSpeakingSec = wordCount / 2.5;
      const estMinPhases = Math.ceil(estSpeakingSec / SECONDS_PER_BREATH_PHASE);
      const phaseDeficit = estMinPhases - breathPhase;
      const warning =
        phaseDeficit > 0 ? ` ⚠️ UNDERESTIMATE by ${phaseDeficit} phases` : "";

      logCueReceived(
        logPrefix,
        breathPhase,
        wordCount,
        estMinPhases,
        warning
      );
      logCueText(logPrefix, args.text);
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

      // === ENTRY BLOCKING (listener elapsed based) ===
      // Wait until actual audio playback reaches the target position
      if (sessionManager.getHasPendingCue(sessionId)) {
        const blockStartAt = Date.now();
        const listenerTarget =
          sessionManager.getListenerTarget(sessionId);
        const listenerElapsed =
          sessionManager.getListenerElapsed(sessionId);
        const queueDepth =
          sessionManager.getAudioQueueDepth(sessionId);
        logCueBlocking(
          logPrefix,
          listenerTarget,
          listenerElapsed,
          queueDepth
        );

        // Wait until listener catches up to target
        await sessionManager.waitForListenerElapsed(
          sessionId,
          listenerTarget
        );

        sessionManager.setHasPendingCue(sessionId, false);
        logCueUnblocked(
          logPrefix,
          Date.now() - blockStartAt,
          sessionManager.getListenerElapsed(sessionId)
        );
      }

      // === ESTIMATE THIS CUE'S DURATION ===
      const promisedMs =
        breathPhase * SECONDS_PER_BREATH_PHASE * 1000;

      // Notify the client via SSE (after entry blocking)
      const sseAt = Date.now();
      const listenerElapsed =
        sessionManager.getListenerElapsed(sessionId);
      logCueSseSend(
        logPrefix,
        sseAt - cueReceivedAt,
        listenerElapsed,
        promisedMs
      );
      sessionManager.sendSSE(sessionId, "cue", {
        text: args.text,
        breathPhase,
      });

      // === UPDATE LISTENER TARGET ===
      // Next cue can fire when listener reaches current position + this cue's duration
      const currentElapsed =
        sessionManager.getListenerElapsed(sessionId);
      const newTarget = currentElapsed + promisedMs;
      sessionManager.setListenerTarget(sessionId, newTarget);
      logCueTargetSet(logPrefix, currentElapsed, newTarget);

      // === QUEUE FOR PLAYBACK ===
      // Pass the buffering promise + breath phase
      const queueDepthBefore =
        sessionManager.getAudioQueueDepth(sessionId);
      sessionManager.queueAudio(sessionId, {
        ttsPromise,
        breathPhase,
        sequenceNum: seqNum,
      });
      logCueQueued(logPrefix, queueDepthBefore, promisedMs);

      // === MARK PENDING (half-step limit) ===
      sessionManager.setHasPendingCue(sessionId, true);

      // Mark that a cue has been called
      sessionManager.markCueCalled(sessionId);
      sessionManager.incrementCueCallCount(sessionId);

      // === RETURN IMMEDIATELY (the "lie") ===
      const ret = `Cue complete. ${breathPhase} breath phases.`;
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
