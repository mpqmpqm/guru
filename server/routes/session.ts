import { Router } from "express";
import {
  DEFAULT_STACK_SIZE,
  MAX_STACK_SIZE,
  sessionManager,
} from "../services/session-manager.js";

export const sessionRouter = Router();

function parseStackSize(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? Math.trunc(value)
      : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_STACK_SIZE;
  }
  return Math.min(parsed, MAX_STACK_SIZE);
}

// Create a new session
sessionRouter.post("/", (req, res) => {
  const { timezone, stackSize } = req.body ?? {};
  const normalizedStackSize = parseStackSize(stackSize);
  const sessionId = sessionManager.createSession(
    timezone,
    normalizedStackSize
  );
  res.json({ sessionId, stackSize: normalizedStackSize });
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
    stackSize: session.stackSize,
  });
});
