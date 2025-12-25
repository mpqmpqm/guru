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

export function createTimeTool(sessionId: string) {
  return tool(
    "time",
    "Returns a natural language description of session timing: elapsed time and current wall clock time.",
    {},
    async () => {
      const timezone = sessionManager.getTimezone(sessionId);

      // Use agent synthetic clock (sum of all cue durations)
      const elapsedMs =
        sessionManager.getAgentSyntheticElapsed(sessionId);

      // Wall clock: session start + synthetic elapsed
      // Agent sees time at its position on the timeline
      const sessionStartTime =
        sessionManager.getSessionStartTime(sessionId) ??
        Date.now();
      const syntheticNow = new Date(
        sessionStartTime + elapsedMs
      );

      const elapsed = formatDuration(elapsedMs / 1000);
      const wallClock = formatWallClock(syntheticNow, timezone);

      const prose = `${elapsed} into the session. The time is ${wallClock}.`;

      console.log(
        `[time] elapsedMs=${elapsedMs} sessionStart=${sessionStartTime} syntheticNow=${syntheticNow.toISOString()}`
      );
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
