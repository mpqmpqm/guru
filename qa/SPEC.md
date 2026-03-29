# QA Spec

Status: draft

## Purpose

`qa/` defines an agentic quality-assurance harness for Guru.

The core idea is:

- Guru remains the system under test.
- Codex acts as the QA orchestrator and judge.
- QA runs operate against real Guru sessions, not a fake loop.

In practice, Codex should be able to:

- create and terminate Guru sessions
- send one or more user turns
- wait for a run to settle
- inspect the resulting trace
- adjust allowed run parameters
- repeat until a scenario passes or the attempt budget is spent

This spec defines the shape of `qa/`, the contracts it relies on,
and the timing model required for a QA run to be meaningful.

## Non-Goals

This spec does not define:

- browser-driven end-to-end UI automation
- snapshot testing for `public/`
- arbitrary code-edit loops where QA agents rewrite app code to
  "make the test pass"
- a replacement for ordinary unit or integration tests

The goal is behavioral QA for the live Guru runtime.

## Why This Exists

Guru is not a standard request-response app. The behavior we care
about lives in the loop between:

- the model
- local tool calls
- TTS generation
- queue backpressure
- timed silence
- playback drain
- persisted traces

Ordinary "call endpoint, assert JSON" tests miss too much.

QA therefore needs to observe the same circuit the user
experiences, while still being able to run faster than literal
real-time when appropriate.

## Runtime Constraints

The current runtime implies several hard constraints that QA must
respect.

### 1. TTS duration is part of the circuit

`speak()` already fetches TTS before returning and derives
`speakingMs` from the audio payload.

That means:

- speech duration is not a cosmetic afterthought
- the runtime already treats speech length as meaningful state

### 2. Playback drain is where backpressure becomes real

The audio queue is drained by the session manager. Queue room is
released after playback completes.

That means:

- merely calling `/api/chat` is not enough
- a QA run must attach some form of consumer
- otherwise the run does not reflect real pacing behavior

### 3. Silence should remain observable even if skipped

Silence is not just delay. It is part of the authored guidance
structure and part of the evidence.

That means:

- `silence()` calls must still be persisted
- `breathe_start`-style events should still be representable
- skipping silence for speed must happen in the consumer layer,
  not by deleting silence from the event model

### 4. Inspection data is the canonical evidence surface

The inspection API and persisted session events should be treated
as the source of truth for QA scoring.

QA should prefer persisted evidence over ad hoc logs.

## Design Principles

### Test the real loop

QA should exercise the existing Guru runtime, not a separate mock
runtime built only for tests.

### Separate orchestrator from system under test

Codex controls Guru sessions from outside. The Guru model should
not receive session-management tools such as "create new session"
or "delete session."

### Fast by default, faithful on demand

Not every scenario must run in literal real-time. The system
should support multiple playback policies with explicit tradeoffs.

### Record once, judge many times

A run should produce an evidence bundle that deterministic checks
and Codex review can both consume.

### Mutation must be explicit

If Codex retries a scenario, the allowed mutation surface must be
declared. QA should not silently drift into arbitrary repo edits.

## Boundary of `qa/`

`qa/` owns:

- scenario definitions
- rubrics
- runner behavior
- report generation
- run artifacts
- the spec itself

`qa/` does not own the control plane transport.

The expected transport for Codex control is MCP. The MCP server
should live in `mcp/`, not inside `qa/`, because it is an
integration surface for the whole repo rather than a QA artifact.

## Directory Layout

The recommended shape is:

```text
qa/
  SPEC.md
  README.md
  scenarios/
  rubrics/
  runners/
  reporters/
  schemas/
  artifacts/
```

### `qa/README.md`

Human entry point. It should explain:

- what QA is for
- how to run a scenario
- where artifacts land
- what the playback modes mean

### `qa/scenarios/`

Declarative scenario definitions. Each scenario describes a QA
case without embedding runner logic.

Examples:

- short cue-heavy session
- long hold with stopwatch
- multi-turn continuation
- interrupted playback
- skill-load path

### `qa/rubrics/`

Review criteria used by Codex when judging a run.

Rubrics should describe how to read the evidence bundle, what
counts as a failure, and what mutations are allowed on retry.

### `qa/runners/`

Code or scripts that:

- load a scenario
- create a Guru session
- attach a playback consumer
- run turns
- collect evidence
- invoke scoring
- optionally retry with bounded mutation

### `qa/reporters/`

Normalization and scoring helpers that turn raw session output
into stable QA reports.

This layer should reconstruct timing, summarize event flow, and
compute pass/fail results.

### `qa/schemas/`

Machine-readable definitions for scenario files and report files.
If YAML is used for scenarios, this directory should contain the
corresponding JSON Schema or Zod source of truth.

### `qa/artifacts/`

Output directory for run evidence.

This directory should be gitignored except for deliberate checked-
in examples.

Recommended artifact layout:

```text
qa/artifacts/<run-id>/
  scenario.json
  config.json
  session.json
  inspect.json
  transcript.md
  report.json
  judge.md
```

## Control Plane Contract

The QA harness expects an MCP surface that lets Codex operate Guru
from the outside.

Recommended minimum tool set:

- `qa_create_session`
- `qa_attach_consumer`
- `qa_send_turn`
- `qa_await_idle`
- `qa_inspect_session`
- `qa_abort_session`
- `qa_delete_session`

These tools belong in `mcp/`, but `qa/` depends on them.

### `qa_create_session`

Creates a Guru session and returns a session id plus any relevant
defaults.

### `qa_attach_consumer`

Attaches a headless playback consumer to the session with a named
playback policy.

Without this step, QA risks testing a degraded path where queued
audio is never meaningfully consumed.

### `qa_send_turn`

Sends a user message into an existing session along with run
configuration such as model, voice, and timezone.

### `qa_await_idle`

Waits until:

- the model turn has finished
- queued playback has drained according to the active policy
- the session is ready for inspection

### `qa_inspect_session`

Returns the canonical evidence for a completed or partially
completed run.

This should be based on the same persisted session data exposed by
the inspect routes.

### `qa_abort_session`

Stops in-flight generation or playback without deleting evidence.

### `qa_delete_session`

Deletes the session and related persisted records when cleanup is
explicitly desired.

## Headless Consumer

QA requires a headless consumer that drains the session queue
without needing a browser audio client.

The consumer must:

- consume queued audio and silence items
- preserve event ordering
- honor the selected playback policy
- resolve drain promises correctly
- leave behind enough evidence for inspection and scoring

The consumer is part of the runtime surface, not just a test
helper. It makes QA runs truthful.

## Timing Model

QA needs three distinct notions of time.

### 1. Agent synthetic time

This is Guru's internal notion of elapsed session time, driven by
tool outputs and synthetic clock updates.

This should remain unchanged across production and QA modes.

### 2. Virtual playback time

This is the timeline implied by the authored session:

- spoken duration derived from TTS or estimates
- silence duration derived from `silence()`

Virtual playback time is the correct clock for judging pacing when
some waits are skipped for speed.

### 3. Wall time

This is actual elapsed QA runtime as measured by the process.

Wall time matters for throughput and budget, but it is not the
same thing as session pacing once fast-forwarding is introduced.

## Playback Policies

QA must support explicit playback policies. A run report must
record which policy was used.

### `full`

- TTS required
- speech played in real time
- silence played in real time

Use this for final acceptance or high-confidence audits.

### `faithful`

- TTS required
- speech played in real time
- silence advanced virtually

This is the recommended default QA mode.

It preserves spoken-duration backpressure while tightening the
loop substantially by skipping literal silence waits.

### `tight`

- TTS required
- speech advanced virtually from audio duration
- silence advanced virtually

Use this for rapid prompt iteration and exploratory QA.

This mode is fast, but it intentionally relaxes queue-pressure
fidelity.

### `dry`

- TTS optional or estimated
- speech duration estimated from text
- silence advanced virtually

This mode is diagnostic only. It must not be used for gating or
acceptance.

## Key Rule About Silence

Skipping silence is allowed.

Deleting silence from the model of the run is not allowed.

The authoritative event stream must still include silence as part
of the authored session. The optimization is "do not wait in wall
time," not "pretend silence did not happen."

## Scenario Format

Scenarios should be declarative and serializable.

Recommended fields:

```yaml
id: cue-short
description: Short cue-led practice with ordinary pacing.
playback: faithful
defaults:
  model: gpt-5-mini
  voice: marin
  timezone: America/New_York
turns:
  - message: Start a short grounding practice for about 2 minutes.
assertions:
  - kind: completed
  - kind: no_errors
  - kind: min_speak_count
    value: 3
judge:
  rubric: default
  max_attempts: 2
  allow_mutation:
    - model
    - voice
    - scenario_prompt_patch
```

### Required Scenario Concepts

- stable id
- human-readable description
- playback policy
- default runtime config
- one or more user turns
- deterministic assertions
- judge configuration

### Allowed Mutation Surface

A scenario may optionally define what Codex can change between
attempts.

Allowed examples:

- model
- voice
- scenario prompt patch
- system-side QA note for the runner

Disallowed by default:

- editing application code
- changing the scenario id
- deleting assertions
- changing playback mode without the scenario allowing it

## Assertions

Assertions should be simple, deterministic, and machine-checkable
before any LLM judging begins.

Recommended initial assertion kinds:

- `completed`
- `no_errors`
- `min_speak_count`
- `max_error_count`
- `requires_tool`
- `max_wall_runtime_ms`
- `continuation_has_previous_response`

Later additions may include:

- `max_virtual_gap_drift_ms`
- `max_consecutive_silence_ms`
- `min_stopwatch_checks`
- `requires_skill_load`

## Evidence Bundle

Every run should produce a bundle that a human or Codex can review
without replaying the whole session live.

Minimum contents:

- scenario definition used
- effective runtime config
- session metadata
- normalized event trace
- raw inspect payload
- derived timing summary
- assertion results
- judge notes

## Reporting

The reporter layer should compute:

- speak count
- silence count
- tool usage summary
- error summary
- wall runtime
- virtual playback runtime
- agent synthetic runtime
- continuation metadata
- pass/fail by assertion

If the playback policy skips wall waits, the report must say so
explicitly.

## Judging

Codex judging happens after deterministic assertions.

Recommended review order:

1. Validate deterministic assertions.
2. Read the normalized report.
3. Read the transcript and timing summary.
4. Apply the named rubric.
5. Decide pass, fail, or retry.

The judge should operate on the evidence bundle, not on vague
memory of what happened during the run.

## Retry Loop

Retries are allowed when the scenario permits them.

A retry loop should:

1. preserve the original scenario id
2. write a new artifact bundle for each attempt
3. record what changed between attempts
4. stop after `max_attempts`

Retries must never silently overwrite the first attempt's
evidence.

## First-Phase Scenarios

The first useful scenario set should include:

- short cue-heavy flow
- long silence or stopwatch flow
- multi-turn continuation
- interrupted session during playback
- skill load plus reference use

These mirror the runtime behaviors most likely to regress.

## Implementation Phases

### Phase 1: Spec and artifacts

- create `qa/SPEC.md`
- create `qa/README.md`
- define scenario and report schemas
- decide artifact layout

### Phase 2: Control plane

- implement MCP session control tools
- add headless consumer attachment
- expose inspection data to the runner

### Phase 3: Runner and reporting

- implement scenario runner
- implement artifact writer
- implement deterministic assertions
- implement normalized report generation

### Phase 4: Codex judging

- add rubric-driven pass/fail review
- add bounded mutation and retry support
- add summary output for humans

### Phase 5: Acceptance use

- define required scenarios for release confidence
- choose which playback policy gates merges
- track historical run results

## Recommended Defaults

For the first usable version:

- transport: MCP
- default playback: `faithful`
- scenario format: YAML
- report format: JSON plus a short Markdown summary
- artifact retention: keep all failed attempts by default

## Open Questions

These should be resolved as implementation begins:

- Should the first runner be a TypeScript script, a Codex-only
  workflow, or both?
- Should the headless consumer live beside the session manager or
  as an adapter layered above it?
- Do we want a checked-in corpus of "golden" artifact bundles for
  documentation and debugging?
- How much mutation should Codex be allowed before a retry becomes
  a different scenario?
- Which playback mode, if any, is strict enough to gate merges?

## Bottom Line

`qa/` should not be a miscellaneous folder for tests.

It should be the contract for agentic QA:

- Codex drives Guru from outside
- Guru runs real sessions
- a headless consumer preserves the loop
- playback policies trade speed for fidelity explicitly
- every run leaves behind evidence
- retries are bounded and auditable
