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
    "Returns session elapsed time and wall clock. Elapsed time reflects session progression.",
    {},
    async () => {
      const timezone = sessionManager.getTimezone(sessionId);

      // Use presentation time - excludes blocking, reflects agent's perceived session duration
      const elapsed = formatDuration(sessionManager.getPresentationTime(sessionId));
      const wallClock = formatWallClock(timezone);

      return {
        content: [
          {
            type: "text" as const,
            text: `${elapsed} into the session. The time is ${wallClock}.`,
          },
        ],
      };
    }
  );
}
