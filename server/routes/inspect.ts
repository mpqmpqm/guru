import { Router } from "express";
import { dbOps } from "../services/db.js";

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

  res.json({ session, events });
});
