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

// Burst mode: send first N bytes at max speed to fill client buffer quickly
const BURST_SECONDS = 0.5;
const BURST_BYTES = Math.floor(BURST_SECONDS * BYTES_PER_SECOND); // 24000

export interface TTSResult {
  chunks?: Uint8Array[];
  error?: string;
}

type AudioItem = {
  type: "audio";
  ttsResult: TTSResult;
  waitMs: number;
  sequenceNum: number;
  text: string;
};

interface Session {
  id: string;
  createdAt: Date;
  timezone?: string;
  stackSize: number;
  audioQueue: AudioItem[];
  audioStreamActive: boolean;
  agentSessionId?: string;
  sseResponse?: Response;
  // Resolvers for when new audio is available
  audioReady: (() => void) | null;
  // Resolver for when queue has room (item dequeued)
  queueDrained: (() => void) | null;
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
  // Agent synthetic clock: sum of all cue durations (speaking + wait)
  agentSyntheticElapsedMs: number;
  // Signals that the producer (agent) is done queuing items
  producerDone: boolean;
  // Resolver for when queue has been fully drained
  drainResolver: (() => void) | null;
}

class SessionManager {
  private sessions = new Map<string, Session>();

  createSession(timezone?: string, stackSize = 1): string {
    const id = uuidv4();
    this.sessions.set(id, {
      id,
      createdAt: new Date(),
      timezone,
      stackSize,
      audioQueue: [],
      audioStreamActive: false,
      audioReady: null,
      queueDrained: null,
      abortController: null,
      eventSequence: 0,
      pendingThinking: "",
      cueCallCount: 0,
      listenerElapsedMs: 0,
      agentSyntheticElapsedMs: 0,
      producerDone: false,
      drainResolver: null,
    });
    return id;
  }

  getSession(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  getStackSize(sessionId: string): number {
    return this.sessions.get(sessionId)?.stackSize ?? 1;
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

  // Listener clock methods (actual playback position)
  getListenerElapsed(sessionId: string): number {
    return this.sessions.get(sessionId)?.listenerElapsedMs ?? 0;
  }

  advanceListenerClock(sessionId: string, ms: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const before = session.listenerElapsedMs;
      session.listenerElapsedMs += ms;
      console.log(
        `[time] advance +${ms}ms: ${before} -> ${session.listenerElapsedMs}`
      );
    }
  }

  // Agent synthetic clock: tracks where the agent is on the timeline
  getAgentSyntheticElapsed(sessionId: string): number {
    return this.sessions.get(sessionId)?.agentSyntheticElapsedMs ?? 0;
  }

  advanceAgentSyntheticClock(sessionId: string, ms: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      const before = session.agentSyntheticElapsedMs;
      session.agentSyntheticElapsedMs += ms;
      console.log(
        `[synthetic] advance +${ms}ms: ${before} -> ${session.agentSyntheticElapsedMs}`
      );
    }
  }

  getAudioQueueDepth(sessionId: string): number {
    return this.sessions.get(sessionId)?.audioQueue.length ?? 0;
  }

  // Block until queue has room for a new item
  async waitForQueueRoom(
    sessionId: string,
    maxItems: number
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    while (session.audioQueue.length >= maxItems) {
      await new Promise<void>((resolve) => {
        session.queueDrained = resolve;
      });
      session.queueDrained = null;
    }
  }

  queueAudio(
    sessionId: string,
    item: {
      ttsResult: TTSResult;
      waitMs: number;
      sequenceNum: number;
      text: string;
    }
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.audioQueue.push({
      type: "audio",
      ttsResult: item.ttsResult,
      waitMs: item.waitMs,
      sequenceNum: item.sequenceNum,
      text: item.text,
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
        // If producer is done and queue is empty, exit gracefully
        if (
          session.producerDone &&
          session.audioQueue.length === 0
        ) {
          break;
        }

        // Wait for audio if queue is empty
        if (session.audioQueue.length === 0) {
          await new Promise<void>((resolve) => {
            session.audioReady = resolve;
          });
          session.audioReady = null;

          if (!session.audioStreamActive) break;
          if (
            session.producerDone &&
            session.audioQueue.length === 0
          ) {
            break;
          }
          if (session.audioQueue.length === 0) continue;
        }

        const item = session.audioQueue.shift();
        if (!item) continue;

        if (item.type === "audio") {
          const logPrefix = `[audio:${sessionId.slice(0, 8)}:${item.sequenceNum}]`;
          const dequeueAt = Date.now();

          // TTS result is already resolved (cue tool awaits it)
          const result = item.ttsResult;

          if (result.error) {
            // Log error, skip this cue but advance listener clock
            // so subsequent cues don't block forever
            // Estimate speaking time from text + explicit waitMs
            const estSpeakingMs =
              (item.text.split(/\s+/).length / 2.5) * 1000;
            const advanceMs = estSpeakingMs + item.waitMs;
            this.advanceListenerClock(sessionId, advanceMs);
            logAudioTtsSkip(
              logPrefix,
              result.error,
              advanceMs,
              this.getListenerElapsed(sessionId)
            );
            // Signal queue room after error handling
            session.queueDrained?.();
            continue;
          }

          const audioBytes = result.chunks!.reduce(
            (sum, c) => sum + c.length,
            0
          );
          const expectedSpeakingMs =
            (audioBytes / BYTES_PER_SECOND) * 1000;

          logAudioPlayStart(
            logPrefix,
            0, // TTS already resolved in cue tool
            audioBytes,
            expectedSpeakingMs,
            item.waitMs,
            session.audioQueue.length
          );

          // Emit cue when playback starts so visuals align with audio.
          this.sendSSE(sessionId, "cue", {
            text: item.text,
            waitMs: item.waitMs,
          });

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

          // Apply explicit wait time (waitMs is the silence after speaking)
          const silenceMs = item.waitMs;

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
          logAudioPlayEnd(logPrefix, speakingMs, silenceMs, totalPlaybackMs);

          // Signal queue room after playback + silence completes
          session.queueDrained?.();
        }
      }
    } finally {
      session.audioStreamActive = false;
      session.audioReady = null;
      // Signal drain complete to anyone awaiting
      session.drainResolver?.();
      session.drainResolver = null;
    }
  }

  closeAudioStream(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.audioStreamActive = false;
      session.audioReady?.();
    }
  }

  // Signal that the producer (agent) is done queuing items.
  // Returns a promise that resolves when the queue has been drained.
  signalProducerDone(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return Promise.resolve();

    const drainQueueWhenInactive = (): void => {
      if (!session.audioStreamActive && session.audioQueue.length > 0) {
        session.audioQueue = [];
        session.queueDrained?.();
        session.queueDrained = null;
        session.drainResolver?.();
        session.drainResolver = null;
      }
    };

    // Already signaled - return existing promise or resolve immediately
    if (session.producerDone) {
      drainQueueWhenInactive();
      if (
        session.audioQueue.length === 0 &&
        !session.audioStreamActive
      ) {
        return Promise.resolve();
      }
      // Return a promise that waits for drain
      return new Promise<void>((resolve) => {
        const existingResolver = session.drainResolver;
        session.drainResolver = () => {
          existingResolver?.();
          resolve();
        };
      });
    }

    session.producerDone = true;

    // Wake consumer if waiting for new audio
    session.audioReady?.();

    drainQueueWhenInactive();

    // If queue already empty and stream not active, resolve immediately
    if (
      session.audioQueue.length === 0 &&
      !session.audioStreamActive
    ) {
      return Promise.resolve();
    }

    // Return promise that resolves when queue drains
    return new Promise<void>((resolve) => {
      session.drainResolver = resolve;
    });
  }

  resetProducerState(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.producerDone = false;
      session.drainResolver = null;
    }
  }

  closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      this.closeAudioStream(sessionId);
      session.sseResponse?.end();
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
