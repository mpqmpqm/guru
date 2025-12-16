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

// Health check with dependency validation
app.get("/health", async (_req, res) => {
  const checks: Record<
    string,
    { status: string; latency?: number; error?: string }
  > = {};
  let overallStatus = "ok";

  // Check SQLite database
  const dbStart = Date.now();
  try {
    const { dbOps } = await import("./services/db.js");
    dbOps.listSessions(1);
    checks.database = {
      status: "ok",
      latency: Date.now() - dbStart,
    };
  } catch (error) {
    checks.database = {
      status: "error",
      error:
        error instanceof Error ? error.message : String(error),
    };
    overallStatus = "degraded";
  }

  // Check OpenAI status
  const openaiStart = Date.now();
  try {
    const openaiRes = await fetch(
      "https://status.openai.com/api/v2/status.json",
      { signal: AbortSignal.timeout(5000) }
    );
    const openaiData = (await openaiRes.json()) as {
      status: { indicator: string; description: string };
    };
    const indicator = openaiData.status.indicator;
    checks.openai = {
      status: indicator === "none" ? "ok" : indicator,
      latency: Date.now() - openaiStart,
    };
    if (indicator !== "none") overallStatus = "degraded";
  } catch (error) {
    checks.openai = {
      status: "error",
      error:
        error instanceof Error ? error.message : String(error),
    };
    overallStatus = "degraded";
  }

  // Check Anthropic/Claude status
  const anthropicStart = Date.now();
  try {
    const anthropicRes = await fetch(
      "https://status.claude.com/api/v2/status.json",
      { signal: AbortSignal.timeout(5000) }
    );
    const anthropicData = (await anthropicRes.json()) as {
      status: { indicator: string; description: string };
    };
    const indicator = anthropicData.status.indicator;
    checks.anthropic = {
      status: indicator === "none" ? "ok" : indicator,
      latency: Date.now() - anthropicStart,
    };
    if (indicator !== "none") overallStatus = "degraded";
  } catch (error) {
    checks.anthropic = {
      status: "error",
      error:
        error instanceof Error ? error.message : String(error),
    };
    overallStatus = "degraded";
  }

  const statusCode = overallStatus === "ok" ? 200 : 503;
  res.status(statusCode).send(
    `<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1">
  </head>
  <body style="background-color: black; color: white;">
    <pre>
${JSON.stringify(
  {
    status: overallStatus,
    checks,
    timestamp: new Date().toISOString(),
  },
  null,
  2
)}
    </pre>
  </body>
</html>`
  );
});

// Simple liveness probe
app.get("/healthz", (_req, res) => {
  res.status(200).send("OK");
});

// Version info
app.get("/version", async (_req, res) => {
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
