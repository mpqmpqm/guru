import { Router } from "express";
import { sessionManager } from "../services/session-manager.js";

export const audioRouter = Router();

// Continuous audio stream endpoint - the "radio station"
audioRouter.get("/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const session = sessionManager.getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  // Set headers for streaming MP3
  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Transfer-Encoding": "chunked",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
    // Prevent buffering
    "X-Accel-Buffering": "no",
  });

  // Handle client disconnect
  req.on("close", () => {
    console.log(`Audio stream closed for session ${sessionId}`);
    sessionManager.closeAudioStream(sessionId);
  });

  console.log(`Audio stream started for session ${sessionId}`);

  // Stream audio from queue
  try {
    for await (const chunk of sessionManager.consumeAudioQueue(sessionId)) {
      // Check if connection is still open
      if (res.writableEnded) break;

      const written = res.write(chunk);
      if (!written) {
        // Backpressure - wait for drain
        await new Promise((resolve) => res.once("drain", resolve));
      }
    }
  } catch (error) {
    console.error(`Audio stream error for session ${sessionId}:`, error);
  }

  res.end();
});
