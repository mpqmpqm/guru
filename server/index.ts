import "dotenv/config";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { audioRouter } from "./routes/audio.js";
import { chatRouter } from "./routes/chat.js";
import { inspectRouter } from "./routes/inspect.js";
import { sessionRouter } from "./routes/session.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// Serve index.html with dynamic OG image URL
const indexHtmlPath = path.join(
  __dirname,
  "../public/index.html"
);
const indexHtmlTemplate = fs.readFileSync(
  indexHtmlPath,
  "utf-8"
);

app.get("/", (req, res) => {
  const protocol =
    req.headers["x-forwarded-proto"] || req.protocol;
  const host =
    req.headers["x-forwarded-host"] || req.headers.host;
  const baseUrl = `${protocol}://${host}`;
  const ogImageUrl = `${baseUrl}/og-image.png`;

  const html = indexHtmlTemplate.replace(
    /__OG_IMAGE_URL__/g,
    ogImageUrl
  );
  res.type("html").send(html);
});

// Serve inspect pages
app.get("/inspect", (_req, res) => {
  res.sendFile(path.join(__dirname, "../public/inspect.html"));
});

app.get("/inspect/:sessionId", (_req, res) => {
  res.sendFile(
    path.join(__dirname, "../public/inspect-session.html")
  );
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, "../public")));

// API routes
app.use("/api/session", sessionRouter);
app.use("/api/chat", chatRouter);
app.use("/api/audio", audioRouter);
app.use("/api/inspect", inspectRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Version info
app.get("/version", async (req, res) => {
  res.json(
    await fs.promises
      .readFile(path.join(__dirname, "../version.json"), "utf-8")
      .catch(() => '{"version":"unknown"}')
  );
});

// Start server
app.listen(PORT, () => {
  console.log(
    `Yoga Guide server running on http://localhost:${PORT}`
  );
  console.log(`API endpoints:`);
  console.log(`  POST /api/session - Create new session`);
  console.log(
    `  GET  /api/chat/events/:sessionId - SSE for chat events`
  );
  console.log(`  POST /api/chat/:sessionId - Send message`);
  console.log(`  GET  /api/audio/:sessionId - Audio stream`);
});
