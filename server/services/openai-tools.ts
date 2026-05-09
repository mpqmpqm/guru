import { z } from "zod";
import { dbOps } from "./db.js";
import {
  loadOptionalSkill,
  loadReference,
  getSkillsCatalog,
} from "./skills.js";
import { sessionManager } from "./session-manager.js";
import {
  runSilenceTool,
  SILENCE_TOOL_DESCRIPTION,
  SILENCE_TOOL_NAME,
  silenceArgsSchema,
} from "../tools/silence.js";
import {
  runSpeakTool,
  SPEAK_TOOL_DESCRIPTION,
  SPEAK_TOOL_NAME,
  speakArgsSchema,
} from "../tools/speak.js";
import {
  runStopwatchTool,
  STOPWATCH_TOOL_DESCRIPTION,
  STOPWATCH_TOOL_NAME,
  stopwatchArgsSchema,
} from "../tools/stopwatch.js";
import {
  getTimeComponents,
  runTimeTool,
  TIME_TOOL_DESCRIPTION,
  TIME_TOOL_NAME,
  timeArgsSchema,
} from "../tools/time.js";

export interface OpenAIFunctionToolDefinition {
  description: string;
  name: string;
  parameters: Record<string, unknown>;
  strict: true;
  type: "function";
}

export interface OpenAIFunctionCall {
  arguments: string;
  call_id: string;
  name: string;
}

export interface OpenAIFunctionCallOutput {
  call_id: string;
  output: string;
  type: "function_call_output";
}

export interface OpenAIToolSideEffect {
  data: { skill: string };
  type: "skill_start";
}

export interface OpenAIToolExecutionResult {
  outputItem: OpenAIFunctionCallOutput;
  sideEffect?: OpenAIToolSideEffect;
}

interface ToolExecution {
  output: string;
  sideEffect?: OpenAIToolSideEffect;
}

export interface OpenAIToolRegistry {
  definitions: OpenAIFunctionToolDefinition[];
  execute(call: OpenAIFunctionCall): Promise<OpenAIToolExecutionResult>;
}

const JSON_STRING_SCHEMA = { type: "string" } as const;

function parseJsonArguments(raw: string): unknown {
  return raw.trim().length > 0 ? JSON.parse(raw) : {};
}

function createFunctionTool(
  name: string,
  description: string,
  parameters: Record<string, unknown>
): OpenAIFunctionToolDefinition {
  return {
    description,
    name,
    parameters,
    strict: true,
    type: "function",
  };
}

function asToolOutput(
  callId: string,
  execution: ToolExecution
): OpenAIToolExecutionResult {
  return {
    outputItem: {
      call_id: callId,
      output: execution.output,
      type: "function_call_output",
    },
    sideEffect: execution.sideEffect,
  };
}

export function createOpenAIToolRegistry(
  sessionId: string
): OpenAIToolRegistry {
  const catalog = getSkillsCatalog();
  const optionalSkillIds = catalog.optionalSkills.map(
    (skill) => skill.id
  );
  const allSkillIds = catalog.allSkills.map((skill) => skill.id);

  const loadSkillArgsSchema = z
    .object({
      skill_id: z
        .string()
        .refine((skillId) => optionalSkillIds.includes(skillId), {
          message: `skill_id must be one of: ${optionalSkillIds.join(", ")}`,
        }),
    })
    .strict();

  const loadReferenceArgsSchema = z
    .object({
      reference_id: z.string(),
      skill_id: z
        .string()
        .refine((skillId) => allSkillIds.includes(skillId), {
          message: `skill_id must be one of: ${allSkillIds.join(", ")}`,
        }),
    })
    .strict()
    .superRefine(({ skill_id, reference_id }, ctx) => {
      const skill = catalog.allSkills.find(
        (entry) => entry.id === skill_id
      );
      if (!skill) {
        return;
      }

      const hasReference = skill.references.some(
        (reference) => reference.id === reference_id
      );
      if (!hasReference) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `reference_id must be one of: ${skill.references
            .map((reference) => reference.id)
            .join(", ")}`,
          path: ["reference_id"],
        });
      }
    });

  const definitions: OpenAIFunctionToolDefinition[] = [
    createFunctionTool(SPEAK_TOOL_NAME, SPEAK_TOOL_DESCRIPTION, {
      additionalProperties: false,
      properties: {
        content: {
          ...JSON_STRING_SCHEMA,
          description: "The text to speak aloud",
        },
        voice: {
          ...JSON_STRING_SCHEMA,
          description:
            "3-5 sentences controlling vocal delivery for this cue, including emotional range, intonation, speed, tone, and whispering.",
        },
      },
      required: ["content", "voice"],
      type: "object",
    }),
    createFunctionTool(
      SILENCE_TOOL_NAME,
      SILENCE_TOOL_DESCRIPTION,
      {
        additionalProperties: false,
        properties: {
          durationMs: {
            minimum: 100,
            type: "integer",
            description: "Milliseconds of silence.",
          },
        },
        required: ["durationMs"],
        type: "object",
      }
    ),
    createFunctionTool(TIME_TOOL_NAME, TIME_TOOL_DESCRIPTION, {
      additionalProperties: false,
      properties: {},
      required: [],
      type: "object",
    }),
    createFunctionTool(
      STOPWATCH_TOOL_NAME,
      STOPWATCH_TOOL_DESCRIPTION,
      {
        additionalProperties: false,
        properties: {
          id: {
            ...JSON_STRING_SCHEMA,
            description: "Human-readable name for the timer",
          },
          intent: {
            enum: ["start", "check"],
            type: "string",
          },
        },
        required: ["id", "intent"],
        type: "object",
      }
    ),
    createFunctionTool(
      "load_skill",
      "Load the canonical instructions for an optional skill and list its available references.",
      {
        additionalProperties: false,
        properties: {
          skill_id: {
            enum: optionalSkillIds,
            type: "string",
          },
        },
        required: ["skill_id"],
        type: "object",
      }
    ),
    createFunctionTool(
      "load_reference",
      "Load a known skill reference document in full.",
      {
        additionalProperties: false,
        properties: {
          reference_id: {
            ...JSON_STRING_SCHEMA,
            description:
              "Reference ID from the selected skill's manifest.",
          },
          skill_id: {
            enum: allSkillIds,
            type: "string",
          },
        },
        required: ["skill_id", "reference_id"],
        type: "object",
      }
    ),
  ];

  const handlers = new Map<
    string,
    (args: unknown) => Promise<ToolExecution>
  >([
    [
      SPEAK_TOOL_NAME,
      async (args) => ({
        output: await runSpeakTool(
          sessionId,
          speakArgsSchema.parse(args)
        ),
      }),
    ],
    [
      SILENCE_TOOL_NAME,
      async (args) => ({
        output: await runSilenceTool(
          sessionId,
          silenceArgsSchema.parse(args)
        ),
      }),
    ],
    [
      TIME_TOOL_NAME,
      async (args) => ({
        output: await runTimeTool(
          sessionId,
          timeArgsSchema.parse(args)
        ),
      }),
    ],
    [
      STOPWATCH_TOOL_NAME,
      async (args) => ({
        output: await runStopwatchTool(
          sessionId,
          stopwatchArgsSchema.parse(args)
        ),
      }),
    ],
    [
      "load_skill",
      async (args) => {
        const { skill_id } = loadSkillArgsSchema.parse(args);
        const seqNum =
          sessionManager.incrementEventSequence(sessionId);
        const { elapsedMs, wallClock } =
          getTimeComponents(sessionId);

        dbOps.insertToolCall(
          sessionId,
          seqNum,
          "load_skill",
          null,
          null,
          null,
          elapsedMs,
          wallClock,
          `Loaded skill "${skill_id}"`
        );

        return {
          output: JSON.stringify(loadOptionalSkill(skill_id)),
          sideEffect: {
            data: { skill: skill_id },
            type: "skill_start",
          },
        };
      },
    ],
    [
      "load_reference",
      async (args) => {
        const { skill_id, reference_id } =
          loadReferenceArgsSchema.parse(args);
        return {
          output: JSON.stringify(
            loadReference(skill_id, reference_id)
          ),
        };
      },
    ],
  ]);

  return {
    definitions,
    async execute(call) {
      const handler = handlers.get(call.name);
      if (!handler) {
        throw new Error(`Unknown tool: ${call.name}`);
      }

      const execution = await handler(
        parseJsonArguments(call.arguments)
      );
      return asToolOutput(call.call_id, execution);
    },
  };
}
