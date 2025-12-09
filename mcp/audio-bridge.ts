import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "crypto";

interface PendingRequest {
  resolve: () => void;
  reject: (error: Error) => void;
}

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

  async speak(text: string): Promise<void> {
    if (this.clients.size === 0) {
      throw new Error(
        "No browser connected. Open http://localhost:5173 in your browser."
      );
    }

    const id = randomUUID();
    const message = JSON.stringify({ type: "speak", text, id });

    // Send to all connected clients
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }

    // Wait for completion acknowledgment
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error("Speech timeout - no response from browser")
        );
      }, 30000); // 30 second timeout

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
