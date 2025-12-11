import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { sessionManager } from "../services/session-manager.js";

export function createPersonaTool(sessionId: string) {
  return tool(
    "persona",
    "Sets the voice persona for this session. Call once at the start with a 3-5 sentence description of your tone, rhythm, and character. This description becomes the literal voice instructions for all spoken cues.",
    {
      description: z
        .string()
        .describe(
          "A vivid 3-5 sentence description of who you are for this session: your tone, rhythm, and character"
        ),
    },
    async (args) => {
      sessionManager.setPersona(sessionId, args.description);

      return {
        content: [
          {
            type: "text" as const,
            text: "Persona set. This voice will shape all cues for this session.",
          },
        ],
      };
    }
  );
}
