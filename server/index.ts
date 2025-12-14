import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { sessionRouter } from "./routes/session.js";
import { chatRouter } from "./routes/chat.js";
import { audioRouter } from "./routes/audio.js";
import versionInfo from "./version.json" with { type: "json" };

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Serve index.html with dynamic OG image URL
const indexHtmlPath = path.join(__dirname, "../public/index.html");
const indexHtmlTemplate = fs.readFileSync(indexHtmlPath, "utf-8");

app.get("/", (req, res) => {
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const baseUrl = `${protocol}://${host}`;
  const ogImageUrl = `${baseUrl}/og-image.png`;

  const html = indexHtmlTemplate.replace(/__OG_IMAGE_URL__/g, ogImageUrl);
  res.type("html").send(html);
});

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

// Version info
app.get("/version", (_req, res) => {
  res.json(versionInfo);
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
