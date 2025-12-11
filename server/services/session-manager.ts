import { v4 as uuidv4 } from "uuid";
import type { Response } from "express";

// PCM audio constants - 24kHz, 16-bit mono
const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2;
const BYTES_PER_SECOND = SAMPLE_RATE * BYTES_PER_SAMPLE; // 48000

type AudioItem = {
  type: "audio";
  stream: AsyncIterable<Uint8Array>;
  onComplete: () => void;
};

interface Session {
  id: string;
  createdAt: Date;
  audioQueue: AudioItem[];
  audioStreamActive: boolean;
  agentSessionId?: string;
  sseResponse?: Response;
  // Resolvers for when new audio is available
  audioReady: (() => void) | null;
  // Abort controller for cancelling the agent
  abortController: AbortController | null;
  // Timestamp when query() started (for latency tracking)
  queryStartTime?: number;
  // Persona for TTS voice instructions
  personaName?: string;
  personaDescription?: string;
}

class SessionManager {
  private sessions = new Map<string, Session>();

  createSession(): string {
    const id = uuidv4();
    this.sessions.set(id, {
      id,
      createdAt: new Date(),
      audioQueue: [],
      audioStreamActive: false,
      audioReady: null,
      abortController: null,
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

  setQueryStartTime(sessionId: string, time: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.queryStartTime = time;
    }
  }

  getQueryStartTime(sessionId: string): number | undefined {
    return this.sessions.get(sessionId)?.queryStartTime;
  }

  setPersona(sessionId: string, name: string, description: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.personaName = name;
      session.personaDescription = description;
    }
  }

  getPersona(sessionId: string): { name: string; description: string } | undefined {
    const session = this.sessions.get(sessionId);
    if (session?.personaName && session?.personaDescription) {
      return { name: session.personaName, description: session.personaDescription };
    }
    return undefined;
  }

  abortAgent(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.abortController) {
      session.abortController.abort();
      session.abortController = null;
    }
  }

  queueAudio(sessionId: string, stream: AsyncIterable<Uint8Array>): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return Promise.resolve();

    return new Promise((resolve) => {
      session.audioQueue.push({ type: "audio", stream, onComplete: resolve });
      // Signal that new audio is available
      session.audioReady?.();
    });
  }

  // Send an SSE event to the client
  sendSSE(sessionId: string, event: string, data: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session?.sseResponse) return;

    session.sseResponse.write(`event: ${event}\n`);
    session.sseResponse.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  // Async generator that yields audio chunks from the queue
  // Closes after each audio item - browser reconnects for next item
  async *consumeAudioQueue(
    sessionId: string
  ): AsyncGenerator<{ type: "data"; data: Buffer } | { type: "flush" }> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Wait for audio if queue is empty
    if (session.audioQueue.length === 0) {
      await new Promise<void>((resolve) => {
        session.audioReady = resolve;
      });
      session.audioReady = null;
    }

    // Process one audio item then close (browser will reconnect)
    const item = session.audioQueue.shift();
    if (!item) return;

    if (item.type === "audio") {
      // "Radio station" model: stream audio at playback rate
      // This ensures onComplete fires after audio has "played" on the server
      const streamStartTime = Date.now();
      let totalBytes = 0;

      for await (const chunk of item.stream) {
        totalBytes += chunk.length;
        yield { type: "data" as const, data: Buffer.from(chunk) };

        // Calculate how much audio we've sent and how long that should take
        const expectedDurationMs = (totalBytes / BYTES_PER_SECOND) * 1000;
        const elapsed = Date.now() - streamStartTime;
        const waitTime = expectedDurationMs - elapsed;

        // Throttle to real-time playback rate
        if (waitTime > 0) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }

      yield { type: "flush" as const };
      item.onComplete();
    }
    // Silence items are no longer used - timing handled by setTimeout in cue tool
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
