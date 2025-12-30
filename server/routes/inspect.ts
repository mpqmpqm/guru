import { Router } from "express";
import { dbOps } from "../services/db.js";
import { isS3Configured } from "../services/s3.js";
import { processExport } from "../services/export.js";

export const inspectRouter = Router();

// List all sessions
inspectRouter.get("/sessions", (_req, res) => {
  const sessions = dbOps.listSessions(100);
  res.json(sessions);
});

// Get single session with events
inspectRouter.get("/sessions/:sessionId", (req, res) => {
  const { sessionId } = req.params;

  const session = dbOps.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  const events = dbOps.getSessionEvents(sessionId);
  const messages = dbOps.getMessages(sessionId);

  // Compute gap analysis for speak events
  const eventsWithGaps = computeGapAnalysis(events);

  res.json({ session, events: eventsWithGaps, messages });
});

type SessionEvent = ReturnType<typeof dbOps.getSessionEvents>[number];
type SpeakEvent = Extract<SessionEvent, { type: "speak" }>;
type SilenceEvent = Extract<SessionEvent, { type: "silence" }>;

interface SpeakEventWithGap extends SpeakEvent {
  promisedGapMs: number | null;
  actualGapMs: number | null;
  gapDriftMs: number | null;
}

function computeGapAnalysis(
  events: SessionEvent[]
): Array<SessionEvent | SpeakEventWithGap> {
  let prevSpeak: SpeakEvent | null = null;
  let silenceSinceLastSpeak = 0;

  return events.map((event) => {
    if (event.type === "silence") {
      silenceSinceLastSpeak += (event as SilenceEvent).durationMs;
      return event;
    }

    if (event.type === "speak") {
      const speak = event as SpeakEvent;
      let promisedGapMs: number | null = null;
      let actualGapMs: number | null = null;
      let gapDriftMs: number | null = null;

      if (prevSpeak) {
        // Promised: previous speak's pauseMs + silence calls between
        promisedGapMs =
          (prevSpeak.waitMs ?? 0) + silenceSinceLastSpeak;

        // Actual: time between previous speak end and this speak start
        // Timestamps are in ms, so no conversion needed
        if (
          prevSpeak.speakingEndedAt != null &&
          speak.speakingStartedAt != null
        ) {
          actualGapMs =
            speak.speakingStartedAt - prevSpeak.speakingEndedAt;
          gapDriftMs = actualGapMs - promisedGapMs;
        }
      }

      // Reset for next iteration
      prevSpeak = speak;
      silenceSinceLastSpeak = 0;

      return {
        ...speak,
        promisedGapMs,
        actualGapMs,
        gapDriftMs,
      } as SpeakEventWithGap;
    }

    return event;
  });
}

// Delete a session
inspectRouter.delete("/sessions/:sessionId", (req, res) => {
  const { sessionId } = req.params;

  const deleted = dbOps.deleteSession(sessionId);
  if (!deleted) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.json({ success: true });
});

// Export session to MP3
inspectRouter.post("/sessions/:sessionId/export", (req, res) => {
  const { sessionId } = req.params;

  if (!isS3Configured()) {
    return res.status(503).json({ error: "S3 not configured" });
  }

  const session = dbOps.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: "Session not found" });
  }

  if (
    session.export_status === "processing" ||
    session.export_status === "pending"
  ) {
    return res.status(409).json({
      error: "Export already in progress",
      status: session.export_status,
    });
  }

  dbOps.updateExportStatus(sessionId, "pending");

  processExport(sessionId).catch((err) => {
    console.error(`Export failed for ${sessionId}:`, err);
  });

  res.json({ status: "pending" });
});
