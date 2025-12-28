import { tool } from "@anthropic-ai/claude-agent-sdk";
import { sessionManager } from "../services/session-manager.js";

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs} seconds`;
  if (secs === 0)
    return `${mins} minute${mins !== 1 ? "s" : ""}`;
  return `${mins} minute${mins !== 1 ? "s" : ""} and ${secs} seconds`;
}

function formatWallClock(date: Date, timezone?: string): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  if (timezone) options.timeZone = timezone;
  return date.toLocaleTimeString("en-US", options);
}

/**
 * Get current session time info as a prose string.
 * Can be appended to speak/silence returns.
 */
export function getTimeInfo(sessionId: string): string {
  const timezone = sessionManager.getTimezone(sessionId);

  // Use agent synthetic clock (sum of all speak/silence durations)
  const elapsedMs =
    sessionManager.getAgentSyntheticElapsed(sessionId);

  // Wall clock: session start + synthetic elapsed
  // Agent sees time at its position on the timeline
  const sessionStartTime =
    sessionManager.getSessionStartTime(sessionId) ?? Date.now();
  const syntheticNow = new Date(sessionStartTime + elapsedMs);

  const elapsed = formatDuration(elapsedMs / 1000);
  const wallClock = formatWallClock(syntheticNow, timezone);

  return `${elapsed} into the session. The time is ${wallClock}.`;
}

export function createTimeTool(sessionId: string) {
  return tool(
    "time",
    "Returns a natural language description of session timing: elapsed time and current wall clock time.",
    {},
    async () => {
      const prose = getTimeInfo(sessionId);

      console.log(`[time] -> "${prose}"`);

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
