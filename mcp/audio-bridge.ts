import "dotenv/config";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

interface PendingRequest {
  resolve: () => void;
  reject: (error: Error) => void;
}

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

// Rachel voice - calm and clear, good for yoga
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

export class AudioBridge {
  private wss: WebSocketServer;
  private clients: Set<WebSocket> = new Set();
  private pending: Map<string, PendingRequest> = new Map();

  constructor(port: number) {
    this.wss = new WebSocketServer({ port });

    this.wss.on("connection", (ws) => {
      this.clients.add(ws);
      process.stderr.write(
        `[AudioBridge] Browser connected (${this.clients.size} total)\n`
      );

      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "complete" && msg.id) {
            const pending = this.pending.get(msg.id);
            if (pending) {
              pending.resolve();
              this.pending.delete(msg.id);
            }
          }
        } catch {
          // Ignore invalid messages
        }
      });

      ws.on("close", () => {
        this.clients.delete(ws);
        process.stderr.write(
          `[AudioBridge] Browser disconnected (${this.clients.size} remaining)\n`
        );
      });
    });

    process.stderr.write(
      `[AudioBridge] WebSocket server listening on port ${port}\n`
    );
  }

  private broadcast(message: string) {
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  private broadcastBinary(data: Buffer) {
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  async speak(text: string): Promise<void> {
    if (this.clients.size === 0) {
      throw new Error(
        "No browser connected. Open http://localhost:5173 in your browser."
      );
    }

    const id = randomUUID();

    // Send start message with text
    const startMsg = JSON.stringify({ type: "audio-start", text, id });
    this.broadcast(startMsg);

    // Stream audio chunks from ElevenLabs
    const audioStream = await elevenlabs.textToSpeech.stream(VOICE_ID, {
      text,
      modelId: "eleven_flash_v2_5",
      outputFormat: "mp3_44100_128",
    });

    // Send chunks as binary
    for await (const chunk of audioStream) {
      this.broadcastBinary(Buffer.from(chunk));
    }

    // Send end message
    const endMsg = JSON.stringify({ type: "audio-end", id });
    this.broadcast(endMsg);

    // Wait for completion acknowledgment
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Speech timeout - no response from browser"));
      }, 60000); // 60 second timeout for longer audio

      this.pending.set(id, {
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
  }

  async wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Clear all pending requests
      for (const pending of this.pending.values()) {
        pending.reject(new Error("Server shutting down"));
      }
      this.pending.clear();

      // Close all client connections
      for (const client of this.clients) {
        client.terminate();
      }
      this.clients.clear();

      // Close the WebSocket server
      this.wss.close((err) => {
        if (err) {
          reject(err);
        } else {
          process.stderr.write("[AudioBridge] WebSocket server closed\n");
          resolve();
        }
      });
    });
  }
}
