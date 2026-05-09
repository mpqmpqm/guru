import { Router } from "express";
import { sessionManager } from "../services/session-manager.js";

export const sessionRouter = Router();

export const DEFAULT_MODEL = "gpt-5.5";

// Model config: selector value or legacy alias → stack behavior + model ID
export const MODEL_CONFIG: Record<
  string,
  { stackSize: number; modelId: string }
> = {
  "gpt-5.5": { stackSize: 9, modelId: DEFAULT_MODEL },
  "gpt-5.4": { stackSize: 9, modelId: "gpt-5.4" },
  "gpt-5-mini": {
    stackSize: 6,
    modelId: "gpt-5-mini",
  },
  "gpt-5-nano": {
    stackSize: 3,
    modelId: "gpt-5-nano",
  },
  opus: { stackSize: 9, modelId: DEFAULT_MODEL },
  sonnet: { stackSize: 6, modelId: "gpt-5-mini" },
  haiku: { stackSize: 3, modelId: "gpt-5-nano" },
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
    hasPreviousResponse: !!session.previousResponseId,
    model: session.model,
    stackSize: session.stackSize,
  });
});
