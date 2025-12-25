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

      // Use listener clock (actual playback position)
      const elapsedMs =
        sessionManager.getListenerElapsed(sessionId);

      // Synthetic wall clock: session start + listener elapsed
      // Agent sees time that moves with playback, can't detect queue backlog
      const sessionStartTime =
        sessionManager.getSessionStartTime(sessionId) ?? Date.now();
      const syntheticNow = new Date(sessionStartTime + elapsedMs);

      const elapsed = formatDuration(elapsedMs / 1000);
      const wallClock = formatWallClock(syntheticNow, timezone);

      const prose = `${elapsed} into the session. The time is ${wallClock}.`;

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
