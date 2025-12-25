import { tool } from "@anthropic-ai/claude-agent-sdk";
import { sessionManager } from "../services/session-manager.js";

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins === 0) return `${secs} seconds`;
  if (secs === 0) return `${mins} minute${mins !== 1 ? "s" : ""}`;
  return `${mins} minute${mins !== 1 ? "s" : ""} and ${secs} seconds`;
}

function formatWallClock(timezone?: string): string {
  const options: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  };
  if (timezone) options.timeZone = timezone;
  return new Date().toLocaleTimeString("en-US", options);
}

export function createTimeTool(sessionId: string) {
  return tool(
    "time",
    "Returns a natural language description of session timing: elapsed time, time since last check, and current wall clock time.",
    {},
    async () => {
      const now = Date.now();
      const sessionStart =
        sessionManager.getSessionStartTime(sessionId);
      const lastCalled =
        sessionManager.getTimeToolLastCalled(sessionId);
      const timezone = sessionManager.getTimezone(sessionId);

      // Update last called timestamp
      sessionManager.setTimeToolLastCalled(sessionId, now);

      const elapsedMs = sessionStart ? now - sessionStart : 0;
      const sinceLastCallMs = lastCalled ? now - lastCalled : null;

      const elapsed = formatDuration(elapsedMs / 1000);
      const sinceLast =
        sinceLastCallMs !== null
          ? formatDuration(sinceLastCallMs / 1000)
          : null;
      const wallClock = formatWallClock(timezone);

      const prose = sinceLast
        ? `${elapsed} into the session. ${sinceLast} since last check. The time is ${wallClock}.`
        : `${elapsed} into the session. First time check. The time is ${wallClock}.`;

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
