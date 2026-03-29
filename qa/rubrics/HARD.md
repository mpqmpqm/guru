# Hard Rubric

Use this rubric first.

This rubric is deterministic and should be derived entirely from
the `/api/inspect/sessions/:id` payload:

- `session`
- `events`
- `messages`

## Purpose

The hard rubric answers one narrow question:

Did the session complete in a structurally acceptable way for the
scenario being reviewed?

It does not attempt to judge artistic quality or pedagogy.

## Inputs

Primary fields:

- `session.status`
- `events[*].type`
- `events[*].source`
- `messages`

Useful event counts:

- number of `speak` events
- number of `silence` events
- number of `error` events
- number of `tool_call` events

## Default Decision Rule

For an ordinary completion scenario, pass only if all of the
following are true:

1. `session.status == "completed"`
2. there is at least one `speak` event
3. there are zero `error` events
4. there is at least one `message`

If any of those conditions fail, the hard rubric fails.

## Scenario Overrides

The scenario may explicitly relax the default rule.

Examples:

- interruption scenarios may allow `session.status == "closed"`
- error-handling scenarios may allow one or more expected errors
- dry or legacy review scenarios may waive missing `messages`

These overrides must be written in the scenario, not implied after
the fact.

## Hard Failure Conditions

These should fail an ordinary run immediately.

### Active Session Leak

Fail if:

- `session.status == "active"`

Rationale:

- the run did not settle
- the evidence bundle is incomplete

### No Speech

Fail if:

- `speak` count is `0`

Rationale:

- Guru is a spoken system
- a completed non-speaking session is structurally invalid

### Unexpected Error

Fail if:

- any `error` event exists
- and the scenario did not explicitly permit it

### Empty Conversation Record

Fail if:

- `messages` is empty

Rationale:

- there is no reliable response record to review

## Legacy Telemetry Rule

Older production sessions may be missing some modern timing
fields.

That is not by itself a hard failure.

Do not fail a run only because fields such as `speakingMs`,
`queueDepth`, or `gapDriftMs` are missing.

Those gaps matter for the timing rubric, not the hard rubric.

## Expected Output

The hard rubric should emit:

- `pass`: boolean
- `reasons`: list of failing checks
- `counts`: speak, silence, error, tool, message

Example:

```json
{
  "rubric": "hard",
  "pass": false,
  "reasons": ["unexpected_error", "status_closed"],
  "counts": {
    "speak": 16,
    "silence": 16,
    "error": 1,
    "tool": 3,
    "message": 11
  }
}
```

## Notes For Real Session Review

When reviewing historical production sessions:

- treat `completed` as the normal success state
- treat `closed` as suspicious unless the prompt or context shows
  an intentional interruption
- inspect `error.source` and `error.message` before deciding
  whether the failure is runtime, user-driven, or legacy-provider
  noise
