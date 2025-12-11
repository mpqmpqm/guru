import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { sessionRouter } from "./routes/session.js";
import { chatRouter } from "./routes/chat.js";
import { audioRouter } from "./routes/audio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "../public")));

// API routes
app.use("/api/session", sessionRouter);
app.use("/api/chat", chatRouter);
app.use("/api/audio", audioRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Yoga Guide server running on http://localhost:${PORT}`);
  console.log(`API endpoints:`);
  console.log(`  POST /api/session - Create new session`);
  console.log(`  GET  /api/chat/events/:sessionId - SSE for chat events`);
  console.log(`  POST /api/chat/:sessionId - Send message`);
  console.log(`  GET  /api/audio/:sessionId - Audio stream`);
});
