import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { dbOps } from "../services/db.js";
import { sessionManager } from "../services/session-manager.js";
import { getTimeInfo } from "./time.js";

export function createSilenceTool(sessionId: string) {
  return tool(
    "silence",
    "Insert intentional silence.",
    {
      durationMs: z
        .number()
        .int()
        .min(100)
        .describe(
          "Milliseconds of silence to insert (min 100ms)."
        ),
    },
    async (args) => {
      const stackSize = sessionManager.getStackSize(sessionId);

      // Persist silence to database
      const seqNum =
        sessionManager.incrementEventSequence(sessionId);
      const logPrefix = `[silence:${sessionId.slice(0, 8)}:${seqNum}]`;

      console.log(
        `${logPrefix} ${args.durationMs}ms`
      );
      dbOps.insertSilence(sessionId, seqNum, args.durationMs);

      // Advance synthetic clock
      sessionManager.advanceAgentSyntheticClock(
        sessionId,
        args.durationMs
      );

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

      return {
        content: [
          {
            type: "text" as const,
            text: `Silence for ${args.durationMs}ms. ${getTimeInfo(sessionId)}`,
          },
        ],
      };
    }
  );
}
