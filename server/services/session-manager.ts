import { v4 as uuidv4 } from "uuid";
import type { Response } from "express";
import {
  logAudioPlayEnd,
  logAudioPlayStart,
  logAudioTtsSkip,
} from "../utils/log.js";

// PCM audio constants - 24kHz, 16-bit mono
const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE; // 48000
const SECONDS_PER_BREATH_PHASE = 4;

// Burst mode: send first N bytes at max speed to fill client buffer quickly
const BURST_SECONDS = 0.5;
const BURST_BYTES = Math.floor(BURST_SECONDS * BYTES_PER_SECOND); // 24000

export interface TTSResult {
  chunks?: Uint8Array[];
  error?: string;
}

type AudioItem = {
  type: "audio";
  ttsPromise: Promise<TTSResult>;
  breathPhase: number;
  sequenceNum: number;
};

type ListenerWaiter = {
  targetMs: number;
  resolve: () => void;
};

interface Session {
  id: string;
  createdAt: Date;
  timezone?: string;
  audioQueue: AudioItem[];
  audioStreamActive: boolean;
  agentSessionId?: string;
  sseResponse?: Response;
  // Resolvers for when new audio is available
  audioReady: (() => void) | null;
  // Abort controller for cancelling the agent
  abortController: AbortController | null;
  // Timestamp when first thinking block was received (session start for time tool)
  sessionStartTime?: number;
  // Timestamp when time tool was last called
  timeToolLastCalled?: number;
  // Unified counter for ordering events (cues + thinking) in the database
  eventSequence: number;
  // Buffer for accumulating thinking chunks during a thinking block
  pendingThinking: string;
  // Timestamp when current thinking block started
  thinkingStartTime?: number;
  // Duration of last completed thinking block (seconds)
  lastThinkingDuration?: number;
  // Whether a cue has been called (skip initial thinking)
  cueHasBeenCalled?: boolean;
  // Count of cue calls in current query (reset per query)
  cueCallCount: number;
  // Listener clock: actual elapsed playback time (for time tool)
  listenerElapsedMs: number;
  // Listener target: what listenerElapsedMs must reach before next SSE fires
  listenerTargetMs: number;
  // Waiters for listener clock to reach a target
  listenerWaiters: ListenerWaiter[];
  // Whether a cue is currently in flight (for half-step limit)
  hasPendingCue: boolean;
}

class SessionManager {
  private sessions = new Map<string, Session>();

  createSession(timezone?: string): string {
    const id = uuidv4();
    this.sessions.set(id, {
      id,
      createdAt: new Date(),
      timezone,
      audioQueue: [],
      audioStreamActive: false,
      audioReady: null,
      abortController: null,
      eventSequence: 0,
      pendingThinking: "",
      cueCallCount: 0,
      listenerElapsedMs: 0,
      listenerTargetMs: 0,
      listenerWaiters: [],
      hasPendingCue: false,
    });
    return id;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  setSSEResponse(sessionId: string, res: Response): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.sseResponse = res;
    }
  }

  setAgentSessionId(sessionId: string, agentSessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.agentSessionId = agentSessionId;
    }
  }

  setAbortController(sessionId: string, controller: AbortController): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.abortController = controller;
    }
  }

  setSessionStartTime(sessionId: string, time: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.sessionStartTime = time;
    }
  }

  getSessionStartTime(sessionId: string): number | undefined {
    return this.sessions.get(sessionId)?.sessionStartTime;
  }

  getTimezone(sessionId: string): string | undefined {
    return this.sessions.get(sessionId)?.timezone;
  }

  setTimeToolLastCalled(sessionId: string, time: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.timeToolLastCalled = time;
    }
  }

  getTimeToolLastCalled(sessionId: string): number | undefined {
    return this.sessions.get(sessionId)?.timeToolLastCalled;
  }

  incrementEventSequence(sessionId: string): number {
    const session = this.sessions.get(sessionId);
    if (!session) return 0;
    session.eventSequence += 1;
    return session.eventSequence;
  }

  clearPendingThinking(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pendingThinking = "";
    }
  }

  appendPendingThinking(sessionId: string, chunk: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.pendingThinking += chunk;
    }
  }

  consumePendingThinking(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return "";
    const content = session.pendingThinking;
    session.pendingThinking = "";
    return content;
  }

  setThinkingStartTime(sessionId: string, time: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.thinkingStartTime = time;
    }
  }

  completeThinkingBlock(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.thinkingStartTime) {
      // Only record thinking duration after first cue (initial thinking is longer)
      if (session.cueHasBeenCalled) {
        session.lastThinkingDuration = (Date.now() - session.thinkingStartTime) / 1000;
      }
      session.thinkingStartTime = undefined;
    }
  }

  markCueCalled(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.cueHasBeenCalled = true;
    }
  }

  incrementCueCallCount(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.cueCallCount++;
    }
  }

  resetCueCallCount(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.cueCallCount = 0;
    }
  }

  getCueCallCount(sessionId: string): number {
    return this.sessions.get(sessionId)?.cueCallCount ?? 0;
  }

  consumeThinkingDuration(sessionId: string): number | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    const duration = session.lastThinkingDuration;
    session.lastThinkingDuration = undefined;
    return duration;
  }

  abortAgent(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.abortController) {
      session.abortController.abort();
      session.abortController = null;
    }
  }

  // Listener target methods (based on actual playback position)
  getListenerTarget(sessionId: string): number {
    return this.sessions.get(sessionId)?.listenerTargetMs ?? 0;
  }

  setListenerTarget(sessionId: string, ms: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.listenerTargetMs = ms;
    }
  }

  // Listener clock methods (actual playback position)
  getListenerElapsed(sessionId: string): number {
    return this.sessions.get(sessionId)?.listenerElapsedMs ?? 0;
  }

  advanceListenerClock(sessionId: string, ms: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.listenerElapsedMs += ms;
      if (session.listenerWaiters.length > 0) {
        const elapsed = session.listenerElapsedMs;
        const remaining: ListenerWaiter[] = [];
        for (const waiter of session.listenerWaiters) {
          if (elapsed >= waiter.targetMs) {
            waiter.resolve();
          } else {
            remaining.push(waiter);
          }
        }
        session.listenerWaiters = remaining;
      }
    }
  }

  waitForListenerElapsed(sessionId: string, targetMs: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return Promise.resolve();
    if (session.listenerElapsedMs >= targetMs) return Promise.resolve();

    return new Promise<void>((resolve) => {
      session.listenerWaiters.push({ targetMs, resolve });
    });
  }

  // Half-step pending cue tracking
  getHasPendingCue(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.hasPendingCue ?? false;
  }

  setHasPendingCue(sessionId: string, value: boolean): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.hasPendingCue = value;
    }
  }

  getAudioQueueDepth(sessionId: string): number {
    return this.sessions.get(sessionId)?.audioQueue.length ?? 0;
  }

  queueAudio(
    sessionId: string,
    item: {
      ttsPromise: Promise<TTSResult>;
      breathPhase: number;
      sequenceNum: number;
    }
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.audioQueue.push({
      type: "audio",
      ttsPromise: item.ttsPromise,
      breathPhase: item.breathPhase,
      sequenceNum: item.sequenceNum,
    });
    // Signal that new audio is available
    session.audioReady?.();
  }

  // Send an SSE event to the client
  sendSSE(sessionId: string, event: string, data: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session?.sseResponse) return;

    session.sseResponse.write(`event: ${event}\n`);
    session.sseResponse.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  // Async generator that yields audio chunks from the queue.
  // Stays open until the client disconnects.
  // Handles TTS promises, playback throttling, silence, and listener clock updates.
  async *consumeAudioQueue(
    sessionId: string
  ): AsyncGenerator<{ type: "data"; data: Buffer } | { type: "flush" }> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.audioStreamActive = true;

    try {
      while (session.audioStreamActive) {
        // Wait for audio if queue is empty
        if (session.audioQueue.length === 0) {
          await new Promise<void>((resolve) => {
            session.audioReady = resolve;
          });
          session.audioReady = null;

          if (!session.audioStreamActive) break;
          if (session.audioQueue.length === 0) continue;
        }

        const item = session.audioQueue.shift();
        if (!item) continue;

        if (item.type === "audio") {
          const logPrefix = `[audio:${sessionId.slice(0, 8)}:${item.sequenceNum}]`;
          const dequeueAt = Date.now();

          // Await the TTS promise (should be resolved if prefetched correctly)
          const ttsWaitStart = Date.now();
          const result = await item.ttsPromise;
          const ttsWaitMs = Date.now() - ttsWaitStart;

          if (result.error) {
            // Log error, skip this cue but advance listener clock
            // so subsequent cues don't block forever
            const promisedMs =
              item.breathPhase * SECONDS_PER_BREATH_PHASE * 1000;
            this.advanceListenerClock(sessionId, promisedMs);
            logAudioTtsSkip(
              logPrefix,
              result.error,
              promisedMs,
              this.getListenerElapsed(sessionId)
            );
            continue;
          }

          const audioBytes = result.chunks!.reduce(
            (sum, c) => sum + c.length,
            0
          );
          const expectedSpeakingMs =
            (audioBytes / BYTES_PER_SECOND) * 1000;
          const promisedMs =
            item.breathPhase * SECONDS_PER_BREATH_PHASE * 1000;

          logAudioPlayStart(
            logPrefix,
            ttsWaitMs,
            audioBytes,
            expectedSpeakingMs,
            promisedMs,
            session.audioQueue.length
          );

          // Start timing AFTER TTS buffering so we measure only playback
          let playbackStart = Date.now();

          // Stream buffered chunks at playback rate, with initial burst
          let totalBytes = 0;
          let burstComplete = false;
          for (const chunk of result.chunks!) {
            if (!session.audioStreamActive) break;
            totalBytes += chunk.length;
            yield { type: "data" as const, data: Buffer.from(chunk) };

            // Skip throttling during burst phase to fill client buffer quickly
            if (totalBytes < BURST_BYTES) continue;

            // After burst, adjust baseline so throttle math is correct
            if (!burstComplete) {
              burstComplete = true;
              playbackStart =
                Date.now() - (BURST_BYTES / BYTES_PER_SECOND) * 1000;
            }

            // Throttle to real-time playback rate
            const expectedDurationMs =
              (totalBytes / BYTES_PER_SECOND) * 1000;
            const elapsed = Date.now() - playbackStart;
            const waitTime = expectedDurationMs - elapsed;

            if (waitTime > 0) {
              await new Promise((resolve) =>
                setTimeout(resolve, waitTime)
              );
            }
          }

          yield { type: "flush" as const };

          // Calculate speaking time from bytes (not wall time, for burst accuracy)
          const speakingMs = (totalBytes / BYTES_PER_SECOND) * 1000;

          // Advance listener clock by speaking time
          this.advanceListenerClock(sessionId, speakingMs);

          // Calculate and apply silence (promisedMs already calculated above)
          const silenceMs = Math.max(0, promisedMs - speakingMs);

          if (silenceMs > 0) {
            this.sendSSE(sessionId, "breathe_start", {
              duration: silenceMs / 1000,
            });
            await new Promise((resolve) =>
              setTimeout(resolve, silenceMs)
            );

            // Advance listener clock by silence time
            this.advanceListenerClock(sessionId, silenceMs);
          }

          const totalPlaybackMs = Date.now() - dequeueAt;
          const drift = totalPlaybackMs - promisedMs;
          // If speaking took longer than promised, there was no silence and we're behind
          const overrun =
            speakingMs > promisedMs
              ? ` ⚠️ OVERRUN by ${Math.round(speakingMs - promisedMs)}ms`
              : "";
          logAudioPlayEnd(
            logPrefix,
            speakingMs,
            silenceMs,
            totalPlaybackMs,
            promisedMs,
            drift,
            overrun
          );
        }
      }
    } finally {
      session.audioStreamActive = false;
      session.audioReady = null;
    }
  }

  closeAudioStream(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.audioStreamActive = false;
      session.audioReady?.();
    }
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.closeAudioStream(sessionId);
      session.sseResponse?.end();
      if (session.listenerWaiters.length > 0) {
        for (const waiter of session.listenerWaiters) {
          waiter.resolve();
        }
        session.listenerWaiters = [];
      }
    }
    // Keep session for potential reconnection, clean up after 30 minutes
    setTimeout(
      () => {
        this.sessions.delete(sessionId);
      },
      30 * 60 * 1000
    );
  }
}

export const sessionManager = new SessionManager();
