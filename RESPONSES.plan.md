# Migration Plan: Claude Agent SDK -> OpenAI Responses

## Research Agenda For The Execution Agent

Before implementing, re-walk the parts of the research path that matter to code and product behavior.

### 1. Reconfirm The Current Local Architecture

Read these files first and treat them as the current behavioral contract:

- `server/services/agent.ts`
- `server/routes/chat.ts`
- `server/services/session-manager.ts`
- `server/tools/speak.ts`
- `server/tools/silence.ts`
- `server/tools/time.ts`
- `server/tools/stopwatch.ts`
- `server/services/db.ts`
- `server/routes/session.ts`
- `public/app.js`

Specifically re-check:

- how the current stream loop emits SSE events
- how the current retry-on-no-speak guarantee works
- how disconnects trigger aborts and session closure
- how `agentSessionId` is used today
- how costs, thinking traces, and message records are persisted

### 2. Reconfirm The Relevant OpenAI API Contracts

Use current official OpenAI docs, not memory, for these points:

- Responses migration guide
- conversation state and `previous_response_id`
- whether `store: true` is required for the intended continuation flow
- function calling and strict schemas
- streaming event types
- reasoning summaries vs encrypted reasoning items
- compaction
- prompt caching
- current model recommendations and pricing

At minimum, revisit these docs:

- `https://developers.openai.com/api/docs/guides/migrate-to-responses`
- `https://developers.openai.com/api/docs/guides/conversation-state`
- `https://developers.openai.com/api/docs/guides/function-calling`
- `https://developers.openai.com/api/docs/guides/streaming-responses`
- `https://developers.openai.com/api/docs/guides/reasoning`
- `https://developers.openai.com/api/docs/guides/compaction`
- `https://developers.openai.com/api/docs/guides/prompt-caching`
- `https://developers.openai.com/api/docs/models`

### 3. Reconfirm The Skill/Reference Shape From Disk

Before finalizing tool schemas, rescan `skills/` directly:

- identify which skills are optional vs foundational
- confirm that `cue` is still special enough to inline
- list all reference files and their first `# Heading`
- confirm that whole-file `load_reference` is still reasonable for current file sizes

### 4. Reconfirm The Product Rationale For Progressive Disclosure

This plan assumes a normal Responses tool loop, not a harness. Revisit the sources that justify that architecture so implementation choices stay aligned with the reasoning:

- Anthropic context-engineering post on just-in-time retrieval
- Anthropic advanced tool use post on deferred loading
- Anthropic agent skills overview
- the practical large-files article
- the meta-tool pattern article

Treat those as architectural guidance, not API contract.

### 5. Validate Any Unverified Assumptions Before Coding Around Them

Do not silently rely on assumptions that were not fully established during planning.

In particular, verify before using:

- any cross-model continuation on a `previous_response_id` chain
- whether reasoning summaries are good enough to support a useful UI
- whether `parallel_tool_calls: false` is sufficient for the sequencing guarantees we need
- the exact SDK streaming shapes you will parse in the server loop

If any of those turn out differently in the latest docs or SDK, update this plan before implementation.

## Goal

Move the session runtime from the Anthropic Claude Agent SDK to plain OpenAI `Responses`, while keeping the existing user-facing audio/SSE behavior intact for the first migration slice.

The target is not a Codex-style harness and not `@openai/agents`. The runtime should be a normal server-owned tool loop built on:

- `responses.create(...)`
- conversation state via OpenAI response IDs
- local function dispatch for tools
- generated skill metadata in instructions
- explicit skill/reference loading tools

Decisions already made for this plan:

- no feature-flag or transition strategy is needed
- skill metadata is built at server startup
- reference loading returns whole reference files for now
- conversation continuation IDs should be persisted
- reference records should not include generated descriptions

## Non-goals

- Redesign the web client or audio transport in the first pass.
- Introduce a generic filesystem tool for the model.
- Preserve Claude-specific raw thinking traces as-is.
- Solve every prompt-quality issue before the provider swap lands.

## Current Architecture

The current app uses Claude as a stateful tool-calling runtime, not as a coding harness.

- [server/services/agent.ts](./server/services/agent.ts): runs `query(...)`, wires Claude session resume, partial thinking, and tool use.
- [server/tools/speak.ts](./server/tools/speak.ts): local tool that calls OpenAI TTS and queues audio.
- [server/tools/silence.ts](./server/tools/silence.ts): local silence tool.
- [server/tools/time.ts](./server/tools/time.ts): synthetic timeline tool.
- [server/tools/stopwatch.ts](./server/tools/stopwatch.ts): hold-timing tool.
- [server/services/session-manager.ts](./server/services/session-manager.ts): owns in-memory session state, SSE, audio queue, synthetic time, and aborts.
- [server/routes/chat.ts](./server/routes/chat.ts): POST turn endpoint and SSE endpoint.
- [skills/](./skills): repo-local skill docs, currently loaded through Claude-specific skill behavior.

The important constraint is that the client already speaks a custom protocol:

- `processing`
- `thinking_start` / `thinking` / `thinking_end`
- `skill_start`
- `text`
- `speak`
- `breathe_start`
- `done`
- `error`

The migration should preserve this protocol where practical, even if the source of those events changes.

## Target Architecture

### Runtime Model

Replace the single Claude `query(...)` stream with an explicit Responses turn loop:

1. Build instructions and tool definitions for the turn.
2. Call `responses.create(...)` with streaming enabled.
3. Stream assistant text and tool-call events into existing SSE events.
4. When the model emits function calls, execute them locally.
5. Send tool results back as `function_call_output`.
6. Continue until the model finishes with no pending tool calls.
7. Persist the final OpenAI response ID for conversation continuation.

This preserves the same overall behavior as the current server-owned loop, but the orchestration is now explicit in application code.

### Skills Model

Do not expose a generic `read(path)` tool as the first design.

Instead:

- Inline the full `cue` skill into the base instructions.
- Build a compact catalog for the remaining optional skills from `skills/*/SKILL.md`.
- Include only metadata for optional skills in instructions.
- Expose `load_skill(skill_id)` for optional skills only.
- Expose `load_reference(skill_id, reference_id)`.

This keeps the three layers separate:

- cue orientation inline in prompt
- optional-skill metadata in prompt
- instructions via `load_skill`
- resources via `load_reference`

### Conversation State

Use OpenAI response IDs as the continuation handle.

Each in-memory session should store at least:

- selected model
- last OpenAI response ID
- current tool/audiovisual state
- voice/timezone/living-instruction flags

On each turn:

- the first request starts a new conversation
- later turns pass the previous response ID so the model can continue from prior state

The response ID should be persisted, not kept in memory only.

Explicit API requirement:

- use `store: true` on Responses requests so continuation IDs are durable and retrievable
- this means response objects are stored by OpenAI unless we later move to a different state strategy

### Streaming Model

Preserve the existing SSE contract, but map it to Responses events:

- `text`: sourced from streamed output text deltas
- `skill_start`: emitted locally when `load_skill` is called
- `speak`: unchanged, emitted when audio playback starts
- `breathe_start`: unchanged, emitted when silence playback starts
- `thinking_*`: likely replaced or degraded

The likely outcome is:

- remove raw token-by-token thinking traces
- optionally emit a simpler `thinking_start` / `thinking_end` around server-side waiting or model work
- optionally store reasoning summaries later if worth exposing

Current OpenAI constraint:

- raw reasoning tokens are not exposed via the API
- reasoning summaries are available if explicitly requested
- encrypted reasoning items can be carried across turns, but they are not UI-readable traces

## Proposed Tools

### `load_skill`

Purpose: load the canonical instruction body for a skill and return its reference manifest.

Suggested schema:

```json
{
  "type": "function",
  "name": "load_skill",
  "description": "Load the instructions for a named skill and list its available references.",
  "strict": true,
  "parameters": {
    "type": "object",
    "properties": {
      "skill_id": {
        "type": "string",
        "enum": [
          "breathwork",
          "hatha",
          "jhana",
          "vinyasa",
          "yin"
        ]
      }
    },
    "required": ["skill_id"],
    "additionalProperties": false
  }
}
```

Suggested output shape:

```json
{
  "skill_id": "yin",
  "instructions": "...contents of SKILL.md...",
  "references": [
    {
      "id": "poses-and-sequencing",
      "title": "Poses and Sequencing"
    }
  ]
}
```

### `load_reference`

Purpose: load a known skill reference file in full.

Suggested schema:

```json
{
  "type": "function",
  "name": "load_reference",
  "description": "Load a known skill reference document.",
  "strict": true,
  "parameters": {
    "type": "object",
    "properties": {
      "skill_id": {
        "type": "string",
        "enum": [
          "breathwork",
          "hatha",
          "jhana",
          "vinyasa",
          "yin",
          "cue"
        ]
      },
      "reference_id": {
        "type": "string"
      }
    },
    "required": ["skill_id", "reference_id"],
    "additionalProperties": false
  }
}
```

Suggested output shape:

```json
{
  "skill_id": "yin",
  "reference_id": "poses-and-sequencing",
  "title": "Poses and Sequencing",
  "content": "..."
}
```

### Existing Guidance Tools

These remain local application-owned functions:

- `speak`
- `silence`
- `time`
- `stopwatch`

They should be redefined as OpenAI function tools, but their internal business logic can stay close to the current implementation.

## Instruction Strategy

The system/developer instructions should no longer say "Load the cue skill now" in a provider-specific way.

Instead:

1. Inline the full `cue` instructions into the stable prompt prefix.
2. Generate an optional-skills section from the filesystem at server startup.
3. Include for each optional skill:
   - `skill_id`
   - name
   - concise description
   - short trigger guidance
   - available reference IDs and titles
4. Add explicit rules such as:
   - use `load_skill` before relying on a skill's detailed workflow
   - use `load_reference` only when the skill instructions indicate a reference is needed
   - keep heavy references out of context unless necessary

This gives us Codex-like progressive disclosure without a harness.

Reference-title strategy:

- do not generate descriptions
- surface the first markdown heading from each reference file as its `title`
- keep filesystem paths server-side only

## Suggested File Changes

### New Files

- `server/services/responses-agent.ts`
  - provider-specific Responses turn loop
- `server/services/skills.ts`
  - scan `skills/`, parse skill metadata, build the startup catalog, load skill bodies and references
- `server/services/openai-tools.ts`
  - tool schemas and dispatch registry
- `server/services/openai-pricing.ts`
  - provider-specific usage/cost calculation if we keep per-turn accounting

### Existing Files To Change

- `server/routes/chat.ts`
  - call the new Responses runtime instead of `streamChat` from Claude service
- `server/routes/session.ts`
  - replace Claude model shorthands with OpenAI model shorthands
- `server/services/session-manager.ts`
  - replace `agentSessionId` with `previousResponseId`
  - keep SSE/audio/synthetic-time state
- `server/services/db.ts`
  - make session/message storage provider-neutral or OpenAI-specific
  - store response IDs and revised usage fields
- `server/services/pricing.ts`
  - replace Anthropic token pricing assumptions
- `README.md`
  - remove Anthropic requirement and update architecture description
- `server/index.ts`
  - remove Claude status check or make provider checks configurable

### Existing Files Likely To Stay Mostly Intact

- `server/tools/speak.ts`
- `server/tools/silence.ts`
- `server/tools/time.ts`
- `server/tools/stopwatch.ts`
- `server/services/session-manager.ts` audio queue parts
- `server/routes/audio.ts`
- `public/app.js`

## Data Model Changes

### Session State

Replace:

- `agentSessionId`

With:

- `previousResponseId`

Potential additions:

- `activeSkillIds` for telemetry only
- `provider`

### Database

The current schema is Claude-shaped in a few places:

- `model` defaults to a Claude model
- usage fields assume Anthropic token buckets
- costs are accumulated with Anthropic pricing
- thinking traces are first-class

Recommended migration:

1. Keep existing tables if possible for continuity.
2. Add neutral or OpenAI-specific columns rather than rewriting history.
3. Stop treating raw thinking traces as required data.

Likely additions:

- `provider`
- `response_id`
- `previous_response_id`
- possibly `reasoning_summary`

Likely behavior changes:

- `messages` becomes "model responses/tool rounds" rather than Anthropic assistant message records
- cost accounting becomes best-effort until fully retuned

## Turn Loop Design

Suggested server loop:

```ts
const toolRegistry = createToolRegistry(sessionId);
const abortController = new AbortController();
sessionManager.setAbortController(sessionId, abortController);

let previousResponseId = session.previousResponseId;
let pendingInput = [{ role: "user", content: userMessage }];
let isRetry = false;

while (true) {
  sessionManager.resetCueCallCount(sessionId);
  let pendingFunctionCalls = [];

  const stream = await client.responses.create({
    model,
    store: true,
    previous_response_id: previousResponseId,
    instructions,
    input: pendingInput,
    tools: toolRegistry.definitions,
    parallel_tool_calls: false,
    stream: true,
    signal: abortController.signal,
  });

  for await (const event of stream) {
    switch (event.type) {
      case "response.output_text.delta":
        sessionManager.sendSSE(sessionId, "text", {
          content: event.delta,
        });
        break;
      case "response.output_item.added":
        if (event.item.type === "function_call") {
          pendingFunctionCalls.push(event.item);
        }
        break;
      case "response.completed":
        previousResponseId = event.response.id;
        break;
    }
  }

  if (
    pendingFunctionCalls.length === 0 &&
    sessionManager.getCueCallCount(sessionId) === 0 &&
    !isRetry
  ) {
    pendingInput = [
      {
        role: "user",
        content:
          "You must speak aloud to guide the listener. Move the session forward by calling speak.",
      },
    ];
    isRetry = true;
    continue;
  }

  if (pendingFunctionCalls.length === 0) {
    session.previousResponseId = previousResponseId;
    break;
  }

  pendingInput = await executeToolCallsAndBuildOutputs(
    pendingFunctionCalls,
    toolRegistry
  );
  isRetry = false;
}
```

Implementation detail:

- if the SDK requires reasoning items to be replayed with tool outputs for some models, preserve them inside the loop rather than discarding them
- tool calls must be collected while streaming, not in a second pass after the stream is consumed
- client disconnects should abort the in-flight Responses request through the shared `AbortController`
- aborting a turn should not imply tearing down the whole conversational session; the session can survive while the current HTTP request is cancelled
- the "must call speak at least once" retry guarantee should live in this runtime loop, not in prompt text alone
- keep the dispatch layer isolated so the rest of the app does not know or care about OpenAI wire format

## Model Strategy

Initial recommendation:

- default: `gpt-5.4-mini`
- quality candidate: `gpt-5.4`

Avoid codex-branded models for the end-user guidance path unless later evaluation proves a benefit.

Model config should include:

- OpenAI model ID
- stack size
- possibly reasoning effort if exposed in this runtime

## Responses-Specific Opportunities

The migration should not be a provider swap only. Plain Responses gives us a few levers that can improve product behavior if we use them intentionally.

### 1. Phase-Adaptive Inference Profiles

The strongest immediate opportunity is to stop treating every turn the same.

Suggested profile split:

- first turn in a session:
  - higher reasoning effort
  - slightly higher temperature if we want more generative session design
- mid-session follow-up turns:
  - lower reasoning effort
  - lower temperature for steadier continuation
- correction or recovery turns:
  - temporarily raise reasoning again if the model needs to re-plan

Rationale:

- OpenAI exposes per-request reasoning effort on current reasoning models
- GPT-5.4 supports `none`, `low`, `medium`, `high`, and `xhigh`

V1 recommendation:

- pick one model for the initial migration
- vary reasoning effort and temperature by turn shape
- revisit cross-model routing only after the base runtime works

### 2. Summary-Based Planning UI

OpenAI does not expose raw reasoning tokens, but it does expose reasoning summaries if explicitly requested.

Opportunity:

- keep the existing "thinking" area in the UI
- repurpose it as a planning/summary panel rather than a raw chain-of-thought panel

Potential uses:

- first-turn planning summary
- "why I loaded this skill/reference" summary
- high-level session-progress summaries in long practices

This will not replicate Claude traces, but it could still be product-useful.

### 3. Automatic Long-Session Context Management

Responses supports compaction for long-running conversations.

Opportunity:

- enable server-side compaction for long sessions
- avoid manually replaying or pruning huge session histories
- keep multi-turn practices viable without gradual latency/cost blowups

This is especially relevant if a session becomes a real conversation rather than a single long generated arc.

### 4. Prompt Caching As A First-Class Design Constraint

Prompt caching works automatically on long exact-prefix matches and can materially reduce cost and latency.

Opportunity:

- keep the generated skill catalog deterministic
- keep tool schemas stable across turns where possible
- place stable instructions and examples at the beginning of the prompt
- put volatile user/session content later
- consider setting `prompt_cache_key` deliberately once we understand traffic patterns

This creates pressure toward a stable prompt prefix and away from unnecessary per-turn prompt churn.

### 5. Better Tool-Call Determinism

Responses exposes `parallel_tool_calls`.

Opportunity:

- keep `parallel_tool_calls: false` in v1 for sequencing-sensitive guidance turns
- preserve strict ordering of `speak`, `silence`, `time`, and `stopwatch`
- optionally revisit parallelism later for read-only retrieval patterns

This gives us a cleaner control surface than relying on the model to behave serially.

### 6. Skill/Reference Retrieval As Product Logic

With explicit `load_skill` and `load_reference`, we can make retrieval policy smarter over time.

Opportunities:

- first turn can require skill load before planning
- later turns can avoid reloading already-loaded skills unless the model explicitly needs them
- references can be loaded in bounded slices, which prevents context blowups
- we can add telemetry around which skills and references actually matter

This is better than treating the filesystem as the interface.

### 7. Better Crash Recovery And Resume

Because Responses uses persistent response IDs and stored response state, we can make interruption and restart behavior better than today.

Opportunities:

- persist response IDs from the first slice
- resume a session after server restart
- distinguish "same session continuation" from "new session with copied prompt"
- potentially recover better from client disconnects

### 8. Cleaner Abort And Disconnect Semantics

The current server has a fair amount of logic shaped around aborting a long-lived agent process when the SSE client disconnects.

Opportunity:

- treat each model turn as a normal request with a scoped `AbortController`
- abort only the in-flight Responses request on disconnect
- keep the broader session state alive unless we explicitly want to close it
- separate "stop generating now" from "destroy this session"

This should make disconnect behavior simpler and more graceful than the current process-oriented model.

### 9. Smarter Cost/Latency Routing

After v1 works, we can revisit routing requests by task shape instead of one static profile.

Candidate dimensions:

- first turn vs follow-up turn
- short continuation vs big re-plan
- reference-heavy research turn vs pure cue continuation
- user-selected "quality" vs "speed" mode

This should stay post-v1 until the base runtime is stable.

## Migration Phases

### Phase 1: Skills/References Layer

Goal: build the progressive-disclosure content system before the model swap.

Steps:

1. Create a skill scanner for `skills/*/SKILL.md`.
2. Parse references under `skills/*/references/`.
3. Generate a compact catalog string for instructions.
4. Implement `load_skill`.
5. Implement `load_reference`.
6. Add tests for path safety and manifest generation.

This phase can land without changing the current client protocol.

### Phase 2: Responses Runtime

Goal: land a working OpenAI turn loop.

Steps:

1. Implement `server/services/responses-agent.ts`.
2. Define OpenAI function-tool schemas for `speak`, `silence`, `time`, `stopwatch`, `load_skill`, and `load_reference`.
3. Build the loop for tool execution and `function_call_output`.
4. Map streamed text into existing SSE events.
5. Persist response IDs in session state and DB.

### Phase 3: Persistence and Pricing

Goal: make stored records coherent after the provider swap.

Steps:

1. Add provider-neutral/OpenAI response identifiers to DB.
2. Update model defaults and session creation fields.
3. Replace Anthropic pricing logic.
4. Decide whether to keep, degrade, or remove thinking trace storage.

### Phase 4: Prompt Retuning

Goal: recover behavior quality after the runtime swap.

Steps:

1. Rewrite the base system/developer instructions for Responses.
2. Replace Claude-specific "load the cue skill now" phrasing with explicit tool guidance.
3. Add tool-use examples for `speak`/`silence`.
4. Evaluate whether `livingInstruction` should become an explicit instruction block rather than a prompt suffix.

### Phase 5: Cleanup

Goal: remove dead provider code.

Steps:

1. Remove `@anthropic-ai/claude-agent-sdk` and `@anthropic-ai/sdk`.
2. Remove Claude model config and health checks.
3. Update docs and env examples.

## Risks

### 1. Loss of Raw Thinking Trace

The current UI exposes Claude thinking blocks directly. Plain Responses should not be expected to preserve that behavior.

Mitigation:

- treat this as a product decision, not an implementation bug
- plan around reasoning summaries rather than raw traces
- keep encrypted reasoning items only for continuation, not UI display

### 2. Prompt-Behavior Regressions

The existing prompts are tuned for Claude behavior.

Mitigation:

- separate runtime migration from prompt retuning
- test representative sessions across yin, vinyasa, cue-heavy, and meditation flows

### 3. Tool Loop Bugs

A server-owned tool loop can accidentally double-submit tool results, lose continuation IDs, or mis-handle multi-call turns.

Mitigation:

- write deterministic tests for:
  - single tool call
  - multiple tool calls in one response
  - tool error propagation
  - resumed turn with previous response ID

### 4. Skill Context Bloat Returns

If `load_skill` or `load_reference` returns too much data, the migration will recreate the original context problem.

Mitigation:

- keep the catalog minimal
- cap reference reads
- prefer reference slices over whole files when documents are large

## Open Questions

1. Should the first migration keep the current `thinking trace` UI visible but summary-based, or hide it until summaries are useful?
2. Do we want `load_skill` to return only instructions plus reference IDs, or also include full reference paths for easier telemetry/debugging?
3. How exactly do we want to map persisted response IDs onto the existing session schema and restore path?

## Validation Plan

Minimum acceptance criteria:

1. A session can start, stream speech, and complete without Anthropic dependencies.
2. The model can call `load_skill("cue")` and use the returned instructions.
3. The model can call `load_reference(...)` for at least one skill reference.
4. Existing SSE-driven UI still shows:
   - processing
   - text/cue updates
   - aligned `speak`
   - `breathe_start`
   - done/error
5. Costs and usage do not crash the session even if pricing is initially approximate.

Manual test set:

1. Short cue-heavy flow.
2. Long silence/stopwatch flow.
3. Flow that needs a reference doc after skill load.
4. Interrupted session during playback.
5. Multi-turn resumed session.
6. Server restart followed by resumed session using a persisted response ID.

## Recommended First Slice

The first implementation slice should be:

1. Add skill catalog generation plus `load_skill` and `load_reference`.
2. Inline `cue` into the base prompt and treat `load_skill` as optional-skill loading only.
3. Implement the Responses turn loop directly.
4. Keep `speak` / `silence` / `time` / `stopwatch` logic as close to current code as possible.
5. Preserve the client/audio protocol.
6. Persist response IDs from the start.
7. Ignore deep DB cleanup until the runtime is proven.

This keeps the migration narrow: replace the provider runtime first, not the whole product architecture.
