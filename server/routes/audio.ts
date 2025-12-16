import { Router } from "express";
import { sessionManager } from "../services/session-manager.js";
import { dbOps } from "../services/db.js";

export const audioRouter = Router();

// Continuous audio stream endpoint - the "radio station"
audioRouter.get("/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const session = sessionManager.getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  // Set headers for streaming raw PCM (24kHz, 16-bit signed, little-endian, mono)
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Transfer-Encoding": "chunked",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Handle client disconnect - don't abort agent (audio can reconnect)
  // Agent is only aborted when SSE closes (user leaves page)
  req.on("close", () => {});

  // Stream audio from queue - write directly without buffering
  try {
    for await (const msg of sessionManager.consumeAudioQueue(sessionId)) {
      if (res.writableEnded) break;

      if (msg.type === "data") {
        res.write(msg.data);
      }
      // flush signals are just markers, no action needed now
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error(`Audio stream error for session ${sessionId}:`, errorMessage);
    const seqNum = sessionManager.incrementEventSequence(sessionId);
    dbOps.insertError(sessionId, seqNum, "audio", errorMessage);
  }

  res.end();
});
