import { Router } from "express";
import { streamChat } from "../services/agent.js";
import { sessionManager } from "../services/session-manager.js";
import { dbOps } from "../services/db.js";
import { logChatError } from "../utils/log.js";
import { MODEL_CONFIG } from "./session.js";

export const chatRouter = Router();

// SSE endpoint for streaming chat events
chatRouter.get("/events/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  const session = sessionManager.getSession(sessionId);

  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Send initial connection event
  res.write(
    `event: connected\ndata: ${JSON.stringify({ sessionId })}\n\n`
  );

  // Store SSE response for this session
  sessionManager.setSSEResponse(sessionId, res);

  // Keep connection alive with heartbeat
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: heartbeat\n\n`);
    }
  }, 15000);

  // Handle client disconnect - stop the agent and mark session closed
  req.on("close", () => {
    clearInterval(heartbeat);
    // console.log(`SSE connection closed for session ${sessionId} - stopping agent`);
    sessionManager.abortAgent(sessionId);
    dbOps.closeSession(sessionId);
  });
});

// POST endpoint for sending messages
chatRouter.post("/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const { message, model, voice, timezone, livingInstruction } =
    req.body;

  // console.log(`[chat] POST /${sessionId} - message: "${message?.slice(0, 50)}..."`);

  if (!message || typeof message !== "string") {
    return res
      .status(400)
      .json({ error: "Message is required" });
  }

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  // Update session from request
  const config = MODEL_CONFIG[model] ?? MODEL_CONFIG.opus;
  sessionManager.setModel(sessionId, config.claudeModelId);
  sessionManager.setStackSize(sessionId, config.stackSize);
  if (timezone) {
    sessionManager.setTimezone(sessionId, timezone);
  }
  if (voice) {
    sessionManager.setVoice(sessionId, voice);
  }

  // Persist session to DB on first message
  if (!session.agentSessionId) {
    dbOps.createSession(
      sessionId,
      session.createdAt.toISOString(),
      message,
      config.claudeModelId,
      livingInstruction,
      voice ?? "marin",
      "gpt-4o-mini"
    );
  }

  // Send "processing" event via SSE
  sessionManager.sendSSE(sessionId, "processing", { message });

  try {
    // Stream response via SSE
    for await (const event of streamChat(sessionId, message)) {
      sessionManager.sendSSE(sessionId, event.type, event);
    }
    res.json({ success: true });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logChatError(errorMessage);
    const seqNum =
      sessionManager.incrementEventSequence(sessionId);
    dbOps.insertError(sessionId, seqNum, "chat", errorMessage);
    sessionManager.sendSSE(sessionId, "error", {
      content: errorMessage,
    });
    res.status(500).json({ error: errorMessage });
  }
});
