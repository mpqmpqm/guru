import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { dbOps } from "../services/db.js";
import { sessionManager } from "../services/session-manager.js";
import { getTimeComponents, getTimeInfo } from "./time.js";

export function createSilenceTool(sessionId: string) {
  return tool(
    "silence",
    "Hold intentional space after speaking. Silence lets instruction land and experience unfold. Duration: 500-2000ms for pacing, 2000-5000ms to land, invoke repeatedly for extended holds. Frame before long silences (>30s) so they feel inhabited, not abandoned.",
    {
      durationMs: z
        .number()
        .int()
        .min(100)
        .max(5000)
        .describe(
          "Milliseconds of silence. Invoke again to extend beyond 5s."
        ),
    },
    async (args) => {
      const stackSize = sessionManager.getStackSize(sessionId);

      // Persist silence to database
      const seqNum =
        sessionManager.incrementEventSequence(sessionId);
      const logPrefix = `[silence:${sessionId.slice(0, 8)}:${seqNum}]`;

      console.log(`${logPrefix} ${args.durationMs}ms`);

      // Advance synthetic clock
      sessionManager.advanceAgentSyntheticClock(
        sessionId,
        args.durationMs
      );

      // Track cumulative silence time for ratio
      sessionManager.addSilenceTime(sessionId, args.durationMs);

      // === BLOCK IF QUEUE IS FULL ===
      await sessionManager.waitForQueueRoom(
        sessionId,
        stackSize
      );

      // === QUEUE FOR PLAYBACK ===
      sessionManager.queueSilence(sessionId, {
        durationMs: args.durationMs,
        sequenceNum: seqNum,
      });

      const sinceSpeakMs =
        sessionManager.getTimeSinceLastSpeak(sessionId);
      const sinceSpeakStr =
        sinceSpeakMs !== undefined
          ? ` (${(sinceSpeakMs / 1000).toFixed(1)}s since last speak)`
          : "";

      const ratio = sessionManager.getSpeakSilenceRatio(sessionId);
      const { elapsedMs, wallClock } = getTimeComponents(sessionId);
      const result = `Silence for ${args.durationMs}ms${sinceSpeakStr}. ${ratio}. ${getTimeInfo(sessionId)}`;

      // Persist silence to database (after we have all data)
      dbOps.insertSilence(
        sessionId,
        seqNum,
        args.durationMs,
        sinceSpeakMs ?? null,
        ratio,
        elapsedMs,
        wallClock
      );

      return {
        content: [
          {
            type: "text" as const,
            text: result,
          },
        ],
      };
    }
  );
}
