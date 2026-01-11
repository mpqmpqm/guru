import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { dbOps } from "../services/db.js";
import { sessionManager } from "../services/session-manager.js";
import {
  formatDuration,
  getTimeComponents,
} from "./time.js";

export function createStopwatchTool(sessionId: string) {
  return tool(
    "stopwatch",
    "Start or check a stopwatch for tracking elapsed time",
    {
      id: z
        .string()
        .describe("Human-readable name for the timer"),
      intent: z.enum(["start", "check"]),
    },
    async ({ id, intent }) => {
      const seqNum =
        sessionManager.incrementEventSequence(sessionId);
      const { elapsedMs, wallClock } =
        getTimeComponents(sessionId);

      if (intent === "start") {
        sessionManager.startStopwatch(sessionId);
        const result = `Stopwatch "${id}" started`;

        dbOps.insertToolCall(
          sessionId,
          seqNum,
          "stopwatch",
          "start",
          id,
          null,
          elapsedMs,
          wallClock,
          result
        );

        return {
          content: [{ type: "text" as const, text: result }],
        };
      } else {
        const stopwatchElapsedMs =
          sessionManager.checkStopwatch(sessionId);
        if (stopwatchElapsedMs === null) {
          const result = "No stopwatch running";
          console.log(
            `[stopwatch:${seqNum}] check "${id}" - not running`
          );

          dbOps.insertToolCall(
            sessionId,
            seqNum,
            "stopwatch",
            "check",
            id,
            null,
            elapsedMs,
            wallClock,
            result
          );

          return {
            content: [{ type: "text" as const, text: result }],
          };
        }
        const stopwatchFormatted = formatDuration(
          stopwatchElapsedMs / 1000
        );
        const sessionFormatted = formatDuration(elapsedMs / 1000);
        const result = `Stopwatch "${id}": ${stopwatchFormatted} elapsed | session: ${sessionFormatted}`;
        console.log(
          `[stopwatch:${seqNum}] check "${id}" -> ${stopwatchFormatted}`
        );

        dbOps.insertToolCall(
          sessionId,
          seqNum,
          "stopwatch",
          "check",
          id,
          stopwatchElapsedMs,
          elapsedMs,
          wallClock,
          result
        );

        return {
          content: [{ type: "text" as const, text: result }],
        };
      }
    }
  );
}
