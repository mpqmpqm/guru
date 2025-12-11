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

  // Handle client disconnect - don't abort agent (audio can reconnect)
  // Agent is only aborted when SSE closes (user leaves page)
  req.on("close", () => {
    console.log(`Audio stream closed for session ${sessionId}`);
  });

  console.log(`Audio stream started for session ${sessionId}`);

  // Stream audio from queue - write directly without buffering
  try {
    for await (const msg of sessionManager.consumeAudioQueue(sessionId)) {
      if (res.writableEnded) break;

      if (msg.type === "data") {
        console.log(`[audio] writing ${msg.data.length}b`);
        res.write(msg.data);
      }
      // flush signals are just markers, no action needed now
    }
  } catch (error) {
    console.error(`Audio stream error for session ${sessionId}:`, error);
  }

  res.end();
});
