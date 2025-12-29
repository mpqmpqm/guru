import { Router } from "express";
import { dbOps } from "../services/db.js";
import { isS3Configured } from "../services/s3.js";
import { processExport } from "../services/export.js";

export const inspectRouter = Router();

// List all sessions
inspectRouter.get("/sessions", (_req, res) => {
  const sessions = dbOps.listSessions(100);
  res.json(sessions);
});

// Get single session with events
inspectRouter.get("/sessions/:sessionId", (req, res) => {
  const { sessionId } = req.params;

  const session = dbOps.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const events = dbOps.getSessionEvents(sessionId);
  const messages = dbOps.getMessages(sessionId);

  res.json({ session, events, messages });
});

// Delete a session
inspectRouter.delete("/sessions/:sessionId", (req, res) => {
  const { sessionId } = req.params;

  const deleted = dbOps.deleteSession(sessionId);
  if (!deleted) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.json({ success: true });
});

// Export session to MP3
inspectRouter.post("/sessions/:sessionId/export", (req, res) => {
  const { sessionId } = req.params;

  if (!isS3Configured()) {
    return res.status(503).json({ error: "S3 not configured" });
  }

  const session = dbOps.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  if (
    session.export_status === "processing" ||
    session.export_status === "pending"
  ) {
    return res.status(409).json({
      error: "Export already in progress",
      status: session.export_status,
    });
  }

  dbOps.updateExportStatus(sessionId, "pending");

  processExport(sessionId).catch((err) => {
    console.error(`Export failed for ${sessionId}:`, err);
  });

  res.json({ status: "pending" });
});
