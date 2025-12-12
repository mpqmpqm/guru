import { tool } from "@anthropic-ai/claude-agent-sdk";
import { sessionManager } from "../services/session-manager.js";

export function createTimeTool(sessionId: string) {
  return tool(
    "time",
    "Returns timing information: elapsed session time and time since this tool was last called.",
    {},
    async () => {
      const now = Date.now();
      const sessionStart =
        sessionManager.getSessionStartTime(sessionId);
      const lastCalled =
        sessionManager.getTimeToolLastCalled(sessionId);

      // Update last called timestamp
      sessionManager.setTimeToolLastCalled(sessionId, now);

      const elapsedMs = sessionStart ? now - sessionStart : 0;
      const sinceLastCallMs = lastCalled
        ? now - lastCalled
        : null;

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              elapsedSeconds: elapsedMs / 1000,
              secondsSinceLastCall:
                sinceLastCallMs !== null
                  ? sinceLastCallMs / 1000
                  : null,
            }),
          },
        ],
      };
    }
  );
}
