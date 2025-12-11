import { Router } from "express";
import { streamChat } from "../services/agent.js";
import { sessionManager } from "../services/session-manager.js";

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
  res.write(`event: connected\ndata: ${JSON.stringify({ sessionId })}\n\n`);

  // Store SSE response for this session
  sessionManager.setSSEResponse(sessionId, res);

  // Keep connection alive with heartbeat
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(`: heartbeat\n\n`);
    }
  }, 15000);

  // Handle client disconnect - stop the agent
  req.on("close", () => {
    clearInterval(heartbeat);
    console.log(`SSE connection closed for session ${sessionId} - stopping agent`);
    sessionManager.abortAgent(sessionId);
  });
});

// POST endpoint for sending messages
chatRouter.post("/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  const { message } = req.body;

  console.log(`[chat] POST /${sessionId} - message: "${message?.slice(0, 50)}..."`);

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "Message is required" });
  }

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
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
    console.error(`[chat] error:`, errorMessage);
    sessionManager.sendSSE(sessionId, "error", { content: errorMessage });
    res.status(500).json({ error: errorMessage });
  }
});
