import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { dbOps } from "../services/db.js";
import { sessionManager } from "../services/session-manager.js";
import {
  formatDuration,
  getTimeComponents,
} from "./time.js";

export const STOPWATCH_TOOL_NAME = "stopwatch";
export const STOPWATCH_TOOL_DESCRIPTION =
  "Start or check a stopwatch for tracking elapsed time";
export const stopwatchArgShape = {
  id: z
    .string()
    .describe("Human-readable name for the timer"),
  intent: z.enum(["start", "check"]),
};
export const stopwatchArgsSchema = z
  .object(stopwatchArgShape)
  .strict();
export type StopwatchArgs = z.infer<typeof stopwatchArgsSchema>;

export async function runStopwatchTool(
  sessionId: string,
  { id, intent }: StopwatchArgs
): Promise<string> {
  const seqNum = sessionManager.incrementEventSequence(sessionId);
  const { elapsedMs, wallClock } = getTimeComponents(sessionId);

  if (intent === "start") {
    sessionManager.startStopwatch(sessionId);
    const result = `Stopwatch "${id}" started`;

    dbOps.insertToolCall(
      sessionId,
      seqNum,
      STOPWATCH_TOOL_NAME,
      "start",
      id,
      null,
      elapsedMs,
      wallClock,
      result
    );

    return result;
  }

  const stopwatchElapsedMs = sessionManager.checkStopwatch(
    sessionId
  );
  if (stopwatchElapsedMs === null) {
    const result = "No stopwatch running";
    console.log(
      `[stopwatch:${seqNum}] check "${id}" - not running`
    );

    dbOps.insertToolCall(
      sessionId,
      seqNum,
      STOPWATCH_TOOL_NAME,
      "check",
      id,
      null,
      elapsedMs,
      wallClock,
      result
    );

    return result;
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
    STOPWATCH_TOOL_NAME,
    "check",
    id,
    stopwatchElapsedMs,
    elapsedMs,
    wallClock,
    result
  );

  return result;
}

export function createStopwatchTool(sessionId: string) {
  return tool(
    STOPWATCH_TOOL_NAME,
    STOPWATCH_TOOL_DESCRIPTION,
    stopwatchArgShape,
    async (args) => {
      const result = await runStopwatchTool(sessionId, args);
      return {
        content: [{ type: "text" as const, text: result }],
      };
    }
  );
}
