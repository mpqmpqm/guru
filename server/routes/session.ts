import { Router } from "express";
import { sessionManager } from "../services/session-manager.js";

export const sessionRouter = Router();

// Create a new session
sessionRouter.post("/", (_req, res) => {
  const sessionId = sessionManager.createSession();
  res.json({ sessionId });
});

// Check session status
sessionRouter.get("/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const session = sessionManager.getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.json({
    sessionId: session.id,
    createdAt: session.createdAt,
    hasAgentSession: !!session.agentSessionId,
  });
});
