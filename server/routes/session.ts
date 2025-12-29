import { Router } from "express";
import { sessionManager } from "../services/session-manager.js";

export const sessionRouter = Router();

export const DEFAULT_MODEL = "claude-opus-4-5";

// Model config: shorthand → { stackSize, claudeModelId }
export const MODEL_CONFIG: Record<
  string,
  { stackSize: number; claudeModelId: string }
> = {
  opus: { stackSize: 9, claudeModelId: DEFAULT_MODEL },
  sonnet: {
    stackSize: 6,
    claudeModelId: "claude-sonnet-4-5",
  },
  haiku: {
    stackSize: 3,
    claudeModelId: "claude-haiku-4-5",
  },
};

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
    model: session.model,
    stackSize: session.stackSize,
  });
});
