import { v4 as uuidv4 } from "uuid";
import type { Response } from "express";

type AudioItem =
  | { type: "audio"; stream: AsyncIterable<Uint8Array> }
  | { type: "silence"; durationMs: number };

interface Session {
  id: string;
  createdAt: Date;
  audioQueue: AudioItem[];
  audioStreamActive: boolean;
  agentSessionId?: string;
  sseResponse?: Response;
  // Resolvers for when new audio is available
  audioReady: (() => void) | null;
}

// MP3 silence frame at 44100Hz, 128kbps (~26ms per frame)
const SILENCE_FRAME = Buffer.from([
  0xff, 0xfb, 0x90, 0x00, // MP3 header for 128kbps, 44100Hz, stereo
  ...new Array(417).fill(0), // Silence data
]);

function generateSilence(durationMs: number): Buffer {
  const framesNeeded = Math.ceil(durationMs / 26);
  const frames: Buffer[] = [];
  for (let i = 0; i < framesNeeded; i++) {
    frames.push(SILENCE_FRAME);
  }
  return Buffer.concat(frames);
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

  queueAudio(sessionId: string, stream: AsyncIterable<Uint8Array>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.audioQueue.push({ type: "audio", stream });
    // Signal that new audio is available
    session.audioReady?.();
  }

  queueSilence(sessionId: string, durationMs: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.audioQueue.push({ type: "silence", durationMs });
    session.audioReady?.();
  }

  // Send an SSE event to the client
  sendSSE(sessionId: string, event: string, data: unknown): void {
    const session = this.sessions.get(sessionId);
    if (!session?.sseResponse) return;

    session.sseResponse.write(`event: ${event}\n`);
    session.sseResponse.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  // Async generator that yields audio chunks from the queue
  async *consumeAudioQueue(sessionId: string): AsyncGenerator<Buffer> {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.audioStreamActive = true;

    while (session.audioStreamActive) {
      // If queue is empty, wait for new audio
      if (session.audioQueue.length === 0) {
        await new Promise<void>((resolve) => {
          session.audioReady = resolve;
        });
        session.audioReady = null;
        continue;
      }

      const item = session.audioQueue.shift()!;

      if (item.type === "audio") {
        // Yield chunks from the audio stream
        for await (const chunk of item.stream) {
          yield Buffer.from(chunk);
        }
      } else if (item.type === "silence") {
        // Generate and yield silence
        yield generateSilence(item.durationMs);
      }
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
