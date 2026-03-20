import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import type {
  EasyInputMessage,
  Response,
  ResponseFunctionToolCall,
  ResponseOutputItemDoneEvent,
  ResponseReasoningItem,
  ResponseStreamEvent,
  ResponseUsage,
} from "openai/resources/responses/responses";
import { createOpenAIToolRegistry } from "./openai-tools.js";
import { dbOps } from "./db.js";
import { calculateCost } from "./pricing.js";
import {
  getSkillsCatalog,
  loadReference,
  loadSkill,
} from "./skills.js";
import { sessionManager } from "./session-manager.js";
import { logAgentError } from "../utils/log.js";

const openai = new OpenAI();

const MUST_SPEAK_RETRY_MESSAGE =
  "You must speak aloud to guide the listener. Move the session forward by calling speak.";

type ToolOutputItem = {
  call_id: string;
  output: string;
  type: "function_call_output";
};

type PendingInputItem = EasyInputMessage | ToolOutputItem;

interface ChatEvent {
  type:
    | "text"
    | "done"
    | "error"
    | "thinking_start"
    | "thinking_end"
    | "thinking"
    | "skill_start";
  content?: string;
  sessionId?: string;
  skill?: string;
}

function buildInstructions(
  sessionId: string,
  livingInstruction: boolean
): string {
  const catalog = getSkillsCatalog();
  const cueSkill = loadSkill("cue").instructions;
  const timezone = sessionManager.getTimezone(sessionId);
  const voice = sessionManager.getVoice(sessionId);
  const livingInstructionText = livingInstruction
    ? loadReference("cue", "living-instruction").content
    : null;

  return [
    "You are Guru, a voice-guided yoga and meditation instructor. Guide the listener through spoken cues and intentional silence.",
    timezone
      ? `Listener timezone: ${timezone}.`
      : "Listener timezone is unknown.",
    `Selected TTS voice: ${voice}.`,
    "Use speak() and silence() to move the practice forward. Every completed turn must include at least one speak() call.",
    "Use time() at the start of a session and whenever pacing becomes uncertain. Use stopwatch() for holds or any duration that needs explicit verification.",
    "Cue is foundational and already loaded below. Optional skills must be loaded with load_skill() before relying on their detailed workflow. Only load references when the skill instructions indicate they are needed.",
    "Keep references out of context unless they materially improve the current turn. Prefer one skill or reference at a time over broad loading.",
    "Tool sequencing examples:",
    '- If the listener asks to begin a practice, first orient yourself with time() if useful, then call speak() with the opening cue, then call silence() when space is needed.',
    "- If you need a skill-specific pattern, call load_skill() before applying it. If that skill points to a reference, call load_reference() only for the exact document you need.",
    "- Break long guidance into multiple speak() calls separated by silence() rather than one oversized monologue.",
    "- Before a long silence, use speak() to frame what the listener should do in that space.",
    "Foundational cue skill:\n\n" + cueSkill,
    livingInstructionText
      ? "Living instruction is enabled for this session. Apply it as an additional constraint when it helps keep language alive:\n\n" +
        livingInstructionText
      : null,
    "Optional skills:\n\n" + catalog.optionalCatalogText,
  ]
    .filter((section): section is string => Boolean(section))
    .join("\n\n");
}

function createUserInput(content: string): PendingInputItem[] {
  return [{ role: "user", content }];
}

function getReasoningEffort(
  previousResponseId: string | null,
  retryingForSpeak: boolean
): "low" | "medium" {
  if (retryingForSpeak) {
    return "medium";
  }
  return previousResponseId ? "low" : "medium";
}

function getReasoningSummaryFromResponse(
  response: Response
): string | null {
  const summaries = response.output
    .filter(
      (item): item is ResponseReasoningItem =>
        item.type === "reasoning"
    )
    .flatMap((item) =>
      item.summary
        .filter((summary) => summary.type === "summary_text")
        .map((summary) => summary.text)
    )
    .filter((text) => text.trim().length > 0);

  if (summaries.length === 0) {
    return null;
  }

  return summaries.join("\n");
}

function toUsage(usage: ResponseUsage | undefined) {
  return {
    cached_input_tokens:
      usage?.input_tokens_details.cached_tokens ?? 0,
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    reasoning_tokens:
      usage?.output_tokens_details.reasoning_tokens ?? 0,
  };
}

function recordThinkingSummary(
  sessionId: string
): string | null {
  sessionManager.completeThinkingBlock(sessionId);
  const content =
    sessionManager.consumePendingThinking(sessionId).trim();
  if (!content) {
    return null;
  }

  const seqNum = sessionManager.incrementEventSequence(sessionId);
  dbOps.insertThinkingTrace(
    uuidv4(),
    sessionId,
    seqNum,
    content,
    sessionManager.getAudioQueueDepth(sessionId)
  );
  return content;
}

function isFunctionCallDoneEvent(
  event: ResponseStreamEvent
): event is ResponseOutputItemDoneEvent {
  return event.type === "response.output_item.done";
}

export async function* streamResponsesChat(
  sessionId: string,
  userMessage: string,
  options: { livingInstruction?: boolean } = {}
): AsyncGenerator<ChatEvent> {
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    yield { type: "error", content: "Session not found" };
    return;
  }

  const abortController = new AbortController();
  sessionManager.setAbortController(sessionId, abortController);

  const heldTextParts: string[] = [];
  let pendingInput: PendingInputItem[] = createUserInput(userMessage);
  let previousResponseId =
    sessionManager.getPreviousResponseId(sessionId) ?? null;
  let retryingForSpeak = false;
  let responseIdToLink: string | null = null;
  let turnStartSeqToLink =
    sessionManager.getTurnStartSeqNum(sessionId);

  sessionManager.resetCueCallCount(sessionId);
  sessionManager.resetProducerState(sessionId);
  sessionManager.markTurnStart(sessionId);

  try {
    while (true) {
      const requestPreviousResponseId = previousResponseId;
      turnStartSeqToLink =
        sessionManager.getTurnStartSeqNum(sessionId);
      responseIdToLink = null;

      const toolRegistry = createOpenAIToolRegistry(sessionId);
      const pendingFunctionCalls: ResponseFunctionToolCall[] = [];
      let completedResponse: Response | null = null;
      let streamedText = "";

      if (!sessionManager.getSessionStartTime(sessionId)) {
        sessionManager.setSessionStartTime(sessionId, Date.now());
      }

      sessionManager.clearPendingThinking(sessionId);
      sessionManager.setThinkingStartTime(sessionId, Date.now());
      yield { type: "thinking_start" };

      const stream = await openai.responses.create(
        {
          instructions: buildInstructions(
            sessionId,
            options.livingInstruction ?? false
          ),
          input: pendingInput,
          model: sessionManager.getModel(sessionId),
          parallel_tool_calls: false,
          previous_response_id: requestPreviousResponseId,
          reasoning: {
            effort: getReasoningEffort(
              requestPreviousResponseId,
              retryingForSpeak
            ),
            summary: "concise",
          },
          store: true,
          stream: true,
          tools: toolRegistry.definitions,
          truncation: "auto",
        },
        { signal: abortController.signal }
      );

      for await (const event of stream) {
        if (event.type === "response.reasoning_summary_text.delta") {
          sessionManager.appendPendingThinking(
            sessionId,
            event.delta
          );
          yield { type: "thinking", content: event.delta };
          continue;
        }

        if (event.type === "response.output_text.delta") {
          streamedText += event.delta;
          if (sessionManager.getCueCallCount(sessionId) > 0) {
            heldTextParts.length = 0;
            heldTextParts.push(streamedText);
          } else {
            yield { type: "text", content: streamedText };
          }
          continue;
        }

        if (isFunctionCallDoneEvent(event)) {
          if (event.item.type === "function_call") {
            pendingFunctionCalls.push(event.item);
          }
          continue;
        }

        if (event.type === "response.completed") {
          completedResponse = event.response;
          responseIdToLink = event.response.id;
          previousResponseId = event.response.id;
          sessionManager.setPreviousResponseId(
            sessionId,
            event.response.id
          );
          dbOps.updateSessionResponseState(
            sessionId,
            event.response.id,
            requestPreviousResponseId,
            "openai"
          );
          continue;
        }

        if (event.type === "error") {
          throw new Error(event.message);
        }
      }

      const reasoningSummary =
        recordThinkingSummary(sessionId) ??
        (completedResponse
          ? getReasoningSummaryFromResponse(completedResponse)
          : null);
      yield { type: "thinking_end" };

      if (!completedResponse) {
        throw new Error(
          "Responses stream ended without a completed response"
        );
      }

      const usage = toUsage(completedResponse.usage);
      const model = sessionManager.getModel(sessionId);
      const msgSeqNum =
        sessionManager.incrementEventSequence(sessionId);
      dbOps.insertMessage(
        completedResponse.id,
        sessionId,
        msgSeqNum,
        usage.input_tokens,
        usage.output_tokens,
        usage.cached_input_tokens,
        0,
        calculateCost(usage, model),
        {
          previousResponseId: requestPreviousResponseId,
          provider: "openai",
          reasoningSummary,
          responseId: completedResponse.id,
        }
      );
      dbOps.accumulateAgentCosts(sessionId, usage, model);

      if (
        pendingFunctionCalls.length === 0 &&
        sessionManager.getCueCallCount(sessionId) === 0 &&
        !retryingForSpeak
      ) {
        const seqNum =
          sessionManager.incrementEventSequence(sessionId);
        dbOps.insertError(
          sessionId,
          seqNum,
          "agent",
          "No speak called, retrying"
        );
        dbOps.linkEventsToMessage(
          sessionId,
          completedResponse.id,
          turnStartSeqToLink
        );
        sessionManager.markTurnStart(sessionId);
        pendingInput = createUserInput(MUST_SPEAK_RETRY_MESSAGE);
        retryingForSpeak = true;
        continue;
      }

      if (pendingFunctionCalls.length > 0) {
        const toolOutputs: ToolOutputItem[] = [];

        for (const call of pendingFunctionCalls) {
          const result = await toolRegistry.execute({
            arguments: call.arguments,
            call_id: call.call_id,
            name: call.name,
          });

          if (result.sideEffect?.type === "skill_start") {
            yield {
              type: "skill_start",
              skill: result.sideEffect.data.skill,
            };
          }

          toolOutputs.push(result.outputItem);
        }

        dbOps.linkEventsToMessage(
          sessionId,
          completedResponse.id,
          turnStartSeqToLink
        );
        sessionManager.markTurnStart(sessionId);

        pendingInput = toolOutputs;
        retryingForSpeak = false;
        continue;
      }

      dbOps.linkEventsToMessage(
        sessionId,
        completedResponse.id,
        turnStartSeqToLink
      );

      await sessionManager.signalProducerDone(sessionId);

      if (heldTextParts.length > 0) {
        yield {
          type: "text",
          content: heldTextParts[heldTextParts.length - 1],
        };
      }

      dbOps.completeSession(sessionId);
      yield { type: "done", sessionId: completedResponse.id };
      return;
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return;
    }

    const errorMessage =
      error instanceof Error ? error.message : String(error);
    logAgentError(error);
    const seqNum =
      sessionManager.incrementEventSequence(sessionId);
    dbOps.insertError(sessionId, seqNum, "agent", errorMessage);

    if (responseIdToLink) {
      dbOps.linkEventsToMessage(
        sessionId,
        responseIdToLink,
        turnStartSeqToLink
      );
    }

    if (heldTextParts.length > 0) {
      await sessionManager.signalProducerDone(sessionId);
      yield {
        type: "text",
        content: heldTextParts[heldTextParts.length - 1],
      };
    }

    yield { type: "error", content: errorMessage };
  } finally {
    sessionManager.setAbortController(sessionId, null);
    sessionManager.signalProducerDone(sessionId);
  }
}
