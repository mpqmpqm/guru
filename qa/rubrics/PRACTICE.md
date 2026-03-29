# Practice Rubric

Use this rubric for the actual guidance quality of a session.

This is the least mechanical rubric. It should be applied by Codex
or a human reviewer after the hard checks, with the inspect
payload as the evidence source.

## Purpose

The practice rubric answers:

Did the session feel structurally and pedagogically right for what
the prompt asked?

This rubric is about the practice itself, not just whether the
runtime survived.

## Inputs

Primary evidence:

- `session.initial_prompt`
- `events`
- `messages`

Especially useful:

- `speak[*].text`
- `silence[*].durationMs`
- `tool_call[*].toolName`
- `tool_call[*].result`

## Review Categories

Each category should be marked as:

- `pass`
- `concern`
- `fail`
- `not_applicable`

## 1. Prompt Fulfillment

Question:

Did Guru actually do the thing the prompt asked for?

Look for:

- requested modality was respected
- requested duration was acknowledged or paced toward
- requested tone was recognizably present
- requested constraints were followed

Fail examples:

- asked for yin, delivered generic meditation
- asked for a short practice, produced a sprawling lecture
- ignored explicit prop or context constraints

## 2. Structural Rhythm

Question:

Was the pattern of speech and silence appropriate for the mode?

Look for:

- enough silence for the practice type
- enough speech to orient the listener
- silence lengths matched what was being asked
- long silences were framed in advance

Concern examples:

- too many chained speeches with no landing space
- long silences appear without framing
- cue density feels detached from movement speed

## 3. Tool Discipline

Question:

Did the model use timing tools when they materially mattered?

Look for:

- `time` near the start of bounded-duration sessions
- `stopwatch` in long holds or explicit timed phases
- sensible use of tools without pathological overuse

Fail examples:

- asks the user to stay 3 minutes in a hold with no stopwatch and
  no timing discipline
- never orients to time in a duration-sensitive session

Concern examples:

- uses stopwatch correctly but inconsistently
- uses `time` late instead of early

## 4. Cue Precision

Question:

Were the spoken cues concrete, embodied, and actionable?

Look for:

- pose or action instructions are specific enough to follow
- sensation language is concrete rather than inflated
- transitions are navigable
- cues sound like they were meant to be spoken aloud

Fail examples:

- vague abstractions substitute for physical instruction
- impossible-to-follow transitions
- giant monologues with no usable action inside them

## 5. Practice Integrity

Question:

Did the session maintain a coherent relationship between tone,
structure, and content?

Look for:

- stable voice over time
- coherent escalation and landing
- no sudden collapse into generic filler
- ending feels intentional rather than interrupted

Concern examples:

- strong opening, generic middle
- abrupt or unearned ending
- content swings between overcooked poetry and flat utility

## 6. Safety and Sanity

Question:

Did the session avoid obvious harmful or structurally reckless
guidance?

Look for:

- durations that are plausible for the mode
- transitions that are not bizarrely abrupt
- no clearly unsafe instruction hiding inside style

Fail examples:

- extreme holds with no framing
- contradictory cues during movement
- reckless certainty where uncertainty should be acknowledged

## Suggested Summary Shape

```json
{
  "rubric": "practice",
  "categories": {
    "prompt_fulfillment": "pass",
    "structural_rhythm": "concern",
    "tool_discipline": "pass",
    "cue_precision": "pass",
    "practice_integrity": "concern",
    "safety_and_sanity": "pass"
  },
  "notes": [
    "The session respected the requested modality and tone.",
    "Several long silences arrived without enough framing.",
    "Cue precision remained strong through transitions."
  ],
  "overall": "pass_with_concerns"
}
```

## Recommended Reviewer Workflow

1. Read the initial prompt.
2. Scan the event timeline for shape:
   speak count, silence count, long holds, errors, tools.
3. Read the opening speaks.
4. Read a middle segment with silence around it.
5. Read the final segment and ending.
6. Decide category outcomes with brief notes.

## What Should Trigger Retry

For ordinary QA, retry when any of these is true:

- `prompt_fulfillment` is `fail`
- `structural_rhythm` is `fail`
- `cue_precision` is `fail`
- `safety_and_sanity` is `fail`

Retry is optional when concerns are confined to:

- `tool_discipline`
- `practice_integrity`

unless the scenario is specifically targeting those qualities.
