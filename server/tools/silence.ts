import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { dbOps } from "../services/db.js";
import { sessionManager } from "../services/session-manager.js";
import { logSilence } from "../utils/log.js";
import { getTimeComponents, getTimeInfo } from "./time.js";

export function createSilenceTool(sessionId: string) {
  return tool(
    "silence",
    "Hold intentional space after speaking. Silence holds space for breath. Frame before long silences (>30s) so they feel inhabited. Skill-specific limits apply.",
    {
      durationMs: z
        .number()
        .int()
        .min(100)
        .describe("Milliseconds of silence."),
    },
    async (args) => {
      const stackSize = sessionManager.getStackSize(sessionId);

      // Persist silence to database
      const seqNum =
        sessionManager.incrementEventSequence(sessionId);

      logSilence(
        `[silence:${sessionId.slice(0, 8)}:${seqNum}]`,
        args.durationMs
      );

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
      const gapStr =
        sinceSpeakMs !== undefined
          ? ` | gap ${(sinceSpeakMs / 1000).toFixed(1)}s`
          : "";

      const ratio =
        sessionManager.getSpeakSilenceRatio(sessionId);
      const { elapsedMs, wallClock } =
        getTimeComponents(sessionId);
      const result = `silence ${(args.durationMs / 1000).toFixed(1)}s${gapStr} | ${ratio} | ${getTimeInfo(sessionId)}`;

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
