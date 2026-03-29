# Timing Rubric

Use this rubric after the hard rubric passes, or when you want to
measure pacing fidelity on a run that is otherwise reviewable.

This rubric depends on timing telemetry from the inspect payload.

## Purpose

The timing rubric answers:

Did Guru honor the pacing it authored?

This is primarily a fidelity rubric, not a practice-quality
rubric.

## Inputs

From `events`:

- `speak[*].promisedGapMs`
- `speak[*].actualGapMs`
- `speak[*].gapDriftMs`
- `speak[*].speakingMs`
- `speak[*].queueDepth`
- `silence[*].durationMs`

From `session`:

- `status`

## Scorability

Only score timing if the session has enough timing telemetry.

Recommended rule:

- timing is scorable if at least 80% of non-initial `speak`
  events have non-null `gapDriftMs`

If that condition is not met, emit:

- `timing_scorable: false`

Do not fail the session on timing alone when the session is not
timing-scorable.

## Core Metric

For all scorable speaks after the first one, compute:

- mean absolute gap drift
- p95 absolute gap drift
- max absolute gap drift

Definitions:

- promised gap: authored silence between one speak and the next
- actual gap: observed time between prior speak end and next speak
  start
- drift: actual gap minus promised gap

Absolute drift is used for scoring because both undershoot and
overshoot are fidelity problems.

## Initial Thresholds

These thresholds are calibrated from recent production samples and
should be treated as starting points, not eternal constants.

### Excellent

- mean absolute drift `<= 150ms`
- p95 absolute drift `<= 300ms`

### Acceptable

- mean absolute drift `<= 250ms`
- p95 absolute drift `<= 500ms`

### Failing

Fail timing if either condition is true:

- mean absolute drift `> 250ms`
- p95 absolute drift `> 500ms`

## Secondary Signals

These should not hard-fail timing by themselves, but they should
be reported.

### Maximum Queue Depth

Report the maximum observed `queueDepth` across speak events.

Interpretation:

- low queue depth suggests tighter coupling to playback
- high queue depth may be acceptable in long sessions with large
  stack sizes
- extreme queue growth is worth reviewing, but it is not yet a
  standalone failure

### Speak Duration Distribution

Report:

- mean `speakingMs`
- max `speakingMs`

Very long speaks do not mean the runtime is wrong, but they often
predict degraded practice quality.

### Silence Duration Distribution

Report:

- mean `durationMs`
- max `durationMs`

Long silences are expected in some modes and problematic in
others. This belongs in timing and practice review together.

## Timing Output

Recommended report shape:

```json
{
  "rubric": "timing",
  "timing_scorable": true,
  "grade": "excellent",
  "metrics": {
    "mean_abs_gap_drift_ms": 108,
    "p95_abs_gap_drift_ms": 115,
    "max_abs_gap_drift_ms": 124,
    "max_queue_depth": 27,
    "mean_speaking_ms": 14446,
    "max_speaking_ms": 31700,
    "mean_silence_ms": 28273,
    "max_silence_ms": 60000
  }
}
```

## When To Waive Timing

Timing should be waived, not failed, when:

- the session is from a legacy telemetry generation
- speech timestamps are missing
- gap analysis is missing for most speaks
- the scenario is explicitly about interruption rather than pacing

## What Timing Does Not Tell You

Good gap fidelity does not imply:

- good cueing
- good pedagogical structure
- good prompt fulfillment
- a satisfying session

Use [PRACTICE.md](/Users/mpq/code/guru/qa/rubrics/PRACTICE.md)
for those judgments.
