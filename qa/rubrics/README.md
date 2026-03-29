# Rubrics

These rubrics define how Codex should review real Guru sessions
using the `/api/inspect` payload from production or QA runs.

The split is intentional:

- [HARD.md](/Users/mpq/code/guru/qa/rubrics/HARD.md):
  deterministic pass/fail checks
- [TIMING.md](/Users/mpq/code/guru/qa/rubrics/TIMING.md):
  playback and pacing fidelity
- [PRACTICE.md](/Users/mpq/code/guru/qa/rubrics/PRACTICE.md):
  session-quality review of the actual guidance

Recommended review order:

1. Apply the hard rubric.
2. If timing fields are present, apply the timing rubric.
3. Apply the practice rubric to the transcript and event trace.

The hard rubric can gate a run by itself.

The timing rubric is gateable only when the session has enough
timing telemetry.

The practice rubric is qualitative. It should inform retry
decisions and scenario notes, but it should not silently override
hard failures.
