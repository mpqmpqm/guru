import { Router, type Response } from "express";
import { sessionManager } from "../services/session-manager.js";
import { dbOps } from "../services/db.js";
import { logAudioStreamError } from "../utils/log.js";

export const audioRouter = Router();

const FRAME_HEADER_SIZE = 5;
const FRAME_TYPE_DATA = 1;
const FRAME_TYPE_FLUSH = 2;

function writeFrame(
  res: Response,
  type: number,
  payload?: Buffer
): void {
  const payloadLength = payload ? payload.length : 0;
  const frame = Buffer.allocUnsafe(
    FRAME_HEADER_SIZE + payloadLength
  );
  frame.writeUInt8(type, 0);
  frame.writeUInt32BE(payloadLength, 1);
  if (payloadLength > 0 && payload) {
    payload.copy(frame, FRAME_HEADER_SIZE);
  }
  res.write(frame);
}

// Continuous audio stream endpoint - framed PCM "radio station"
audioRouter.get("/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const session = sessionManager.getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  // Set headers for streaming framed PCM (24kHz, 16-bit signed, little-endian, mono)
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Transfer-Encoding": "chunked",
    "Cache-Control": "no-cache, no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Audio-Format": "pcm16le-24k-framed",
  });

  // Handle client disconnect - abort agent and close session
  // Audio is the primary delivery channel; if it disconnects, guidance
  // cannot be heard, so continuing the agent wastes resources
  req.on("close", () => {
    // console.log(
    //   `Audio stream closed for session ${sessionId} - stopping agent`
    // );
    sessionManager.closeAudioStream(sessionId);
    sessionManager.abortAgent(sessionId);
    dbOps.closeSession(sessionId);
  });

  // Stream audio from queue - write directly without buffering
  try {
    for await (const msg of sessionManager.consumeAudioQueue(sessionId)) {
      if (res.writableEnded) break;

      if (msg.type === "data") {
        writeFrame(res, FRAME_TYPE_DATA, msg.data);
      } else {
        writeFrame(res, FRAME_TYPE_FLUSH);
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logAudioStreamError(sessionId, errorMessage);
    const seqNum = sessionManager.incrementEventSequence(sessionId);
    dbOps.insertError(sessionId, seqNum, "audio", errorMessage);
  }

  res.end();
});
