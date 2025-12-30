# Clairvoyance: Configurable Think-Ahead Stack Size

## Goals

- Make max lookahead cues configurable, defaulting to 1.
- Keep cue visuals aligned with spoken audio by emitting cue SSE at playback start.
- Preserve wall-clock entry blocking to avoid indefinite stalls when audio is slow.

## Non-goals

- Change the audio format or streaming protocol.
- Redesign the UI or client playback pipeline.

## Proposed Design

### Configuration

- Add a stack size config source order: session override, env var, fallback to 1.
- Validate and clamp to an integer >= 1.
- Expose it on session creation or a settings endpoint if per-session is needed.

### Scheduling Model

- Replace `hasPendingCue` with a wall-clock schedule queue.
- Track `playbackSchedule: number[]` per session, each entry is a promised end time.
- Before queueing a new cue, prune schedule entries `<= Date.now()` to free slots.
- If schedule length >= stack size, block until `playbackSchedule[0] - Date.now()` is <= 0, then prune and continue.
- Compute new end time as `Math.max(Date.now(), lastScheduledEnd) + promisedMs`.
- Set `nextPlaybackAtMs` to the new end time for logging and invariant checks.

### Cue and Audio Flow

- Keep SSE `cue` emission inside the audio consumer at playback start.
- Keep `breathe_start` SSE after audio finishes, as today.
- Include cue `text` and `breathPhase` on queued audio items so playback can emit aligned visuals.

### Time Tool and Safety

- Time tool should follow the synthetic future timeline (sum of queued cue durations), not listener playback.
- Keep playback position opaque to the agent.
- Consider emitting a warning log when schedule length approaches stack size.

### Observability

- Add logs for schedule length, blocking waits, and computed end times.
- Optionally surface stack size and schedule depth in `inspect` UI.

## Implementation Steps

1. Add configuration parsing for stack size in server startup or session creation.
2. Extend session state with `playbackSchedule` and stack size settings.
3. Update cue tool to use schedule-based wall-clock entry blocking.
4. Keep `nextPlaybackAtMs` updated based on schedule tail, not `Date.now()` only.
5. Ensure cue SSE is emitted at playback start in the audio consumer.
6. Update `decisions/think-ahead.md` to document the new stack-size model.
7. Add tests for schedule gating with stack size 1 and >1.
8. Validate manually with a long sequence to confirm no UI lead and no dead air.

## Risks and Mitigations

- Higher stack sizes increase agent lead and memory usage from buffered TTS.
- Use a default of 1, and document tradeoffs near the config.
