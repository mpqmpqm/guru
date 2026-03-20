import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { dbOps } from "../services/db.js";
import { sessionManager } from "../services/session-manager.js";

export const TIME_TOOL_NAME = "time";
export const TIME_TOOL_DESCRIPTION =
  "Returns a natural language description of session timing: elapsed time and current wall clock time.";
export const timeArgShape = {};
export const timeArgsSchema = z.object(timeArgShape).strict();
export type TimeArgs = z.infer<typeof timeArgsSchema>;

export function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs}s`;
  if (secs === 0) return `${mins}m`;
  return `${mins}m${secs}s`;
}

function formatWallClock(date: Date, timezone?: string): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  };
  if (timezone) options.timeZone = timezone;
  return date.toLocaleTimeString("en-US", options);
}

/**
 * Get raw time components for database storage.
 */
export function getTimeComponents(sessionId: string): {
  elapsedMs: number;
  wallClock: string;
} {
  const timezone = sessionManager.getTimezone(sessionId);
  const elapsedMs =
    sessionManager.getAgentSyntheticElapsed(sessionId);
  const sessionStartTime =
    sessionManager.getSessionStartTime(sessionId) ?? Date.now();
  const syntheticNow = new Date(sessionStartTime + elapsedMs);
  const wallClock = formatWallClock(syntheticNow, timezone);

  return { elapsedMs, wallClock };
}

/**
 * Get current session time info as a prose string.
 * Can be appended to speak/silence returns.
 */
export function getTimeInfo(sessionId: string): string {
  const { elapsedMs, wallClock } = getTimeComponents(sessionId);
  const elapsed = formatDuration(elapsedMs / 1000);
  return `elapsed ${elapsed} | clock ${wallClock}`;
}

export async function runTimeTool(
  sessionId: string,
  _args: TimeArgs = {}
): Promise<string> {
  const seqNum = sessionManager.incrementEventSequence(sessionId);
  const { elapsedMs, wallClock } = getTimeComponents(sessionId);
  const prose = getTimeInfo(sessionId);

  dbOps.insertToolCall(
    sessionId,
    seqNum,
    TIME_TOOL_NAME,
    null,
    null,
    null,
    elapsedMs,
    wallClock,
    prose
  );

  return prose;
}

export function createTimeTool(sessionId: string) {
  return tool(
    TIME_TOOL_NAME,
    TIME_TOOL_DESCRIPTION,
    timeArgShape,
    async (args) => {
      const prose = await runTimeTool(sessionId, args);
      return {
        content: [
          {
            type: "text" as const,
            text: prose,
          },
        ],
      };
    }
  );
}
