import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { AudioBridge } from "./audio-bridge.js";
import { toolDefinitions, handleCue, handleCueSequence } from "./tools.js";

// Initialize the audio bridge
const bridge = new AudioBridge();

// Initialize the MCP server
const server = new Server(
  {
    name: "yoga",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: toolDefinitions };
});

// Handle tool calls
server.setRequestHandler(
  CallToolRequestSchema,
  async (request) => {
    const { name, arguments: args } = request.params;

    try {
      if (name === "cue") {
        const { text, pause } = args as {
          text: string;
          pause?: number;
        };
        if (!text) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: text is required",
              },
            ],
            isError: true,
          };
        }
        return await handleCue(bridge, text, pause);
      }

      if (name === "cue_sequence") {
        const { cues } = args as {
          cues: Array<{ text: string; pause?: number }>;
        };
        if (!cues || !Array.isArray(cues) || cues.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: cues array is required and must not be empty",
              },
            ],
            isError: true,
          };
        }
        return await handleCueSequence(bridge, cues);
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Unknown tool: ${name}`,
          },
        ],
        isError: true,
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      return {
        content: [
          { type: "text" as const, text: `Error: ${message}` },
        ],
        isError: true,
      };
    }
  }
);

// Cleanup handler
async function cleanup() {
  process.stderr.write("[Yoga MCP] Shutting down...\n");
  try {
    await bridge.close();
    await server.close();
  } catch (error) {
    process.stderr.write(`[Yoga MCP] Cleanup error: ${error}\n`);
  }
  process.exit(0);
}

// Register cleanup handlers
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
process.on("SIGHUP", cleanup);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write("[Yoga MCP] Server started. Audio plays via MPV.\n");
}

main().catch((error) => {
  process.stderr.write(`[Yoga MCP] Fatal error: ${error}\n`);
  bridge.close().finally(() => process.exit(1));
});
