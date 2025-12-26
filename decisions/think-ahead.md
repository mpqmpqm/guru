# Think-Ahead: Pipelined Cue Delivery

## Problem

Dead air from two stacking latencies:
1. **TTS TTFB** (~500-1500ms per cue)
2. **Agent thinking time** (variable, often 1-2s)

The original implementation blocked the agent for the entire cue duration
(TTS fetch + playback + silence), so these latencies stacked sequentially.

## Solution: Configurable Lookahead with Entry Blocking

Allow the agent to work **up to `stackSize` cues ahead** by:
1. Firing TTS immediately (before any blocking)
2. Blocking at the *start* of the next cue when the schedule is full, until
   the earliest scheduled end time elapses
3. Returning immediately after queuing (the "lie")

```
BEFORE:
Agent: ──[think]──[cue1: TTS+play+silence]──[think]──[cue2: TTS+play+silence]──
                   └─ blocked entire time ─┘

AFTER:
Agent: ──[think]──[cue1]──[think]──[WAIT]──[cue2]──[think]──[WAIT]──[cue3]──
                    │                │                │
                    │   TTS buffers  │   TTS buffers  │
                    ↓   IN PARALLEL  ↓   IN PARALLEL  ↓
Audio:        [TTS1]─[play1]─[silence]─[play2]─[silence]─[play3]─...
```

## Key Decisions

### 1. Wall-Clock Entry Blocking (not virtual time)

**Decision**: Block on `nextPlaybackAtMs - Date.now()`, a wall-clock timestamp.

**Rejected alternative**: Virtual timeline offset that gets compared against
itself.

**Rationale**: A virtual offset approach (`virtualTimeOffset`) breaks when you
try to compute wait time—after advancing the offset, the wait becomes zero.
Wall-clock timestamps are unambiguous: "block until this moment."

### 2. Synthetic Timeline for Time Tool

**Decision**: The time tool reports the agent's synthetic timeline
(`agentSyntheticElapsedMs`, sum of cue durations) and the wall clock at that
future position.

**Rationale**: Clairvoyance is intentionally opaque to the agent. Pacing should
be driven by where the agent is on the future timeline it has already queued.
Using playback position would collapse that lead and hide the agent's
committed schedule.

### 3. Eager Stream Buffering

**Decision**: Buffer the entire TTS response into memory (`chunks:
Uint8Array[]`) rather than passing through the stream.

**Rejected alternative**: Hold the ReadableStream and pass it to the audio
consumer.

**Rationale**: Holding a ReadableStream doesn't buffer ahead—data only flows
when you read. To hide TTS latency, we must actively consume the stream during
the entry block wait.

### 4. Cue Tool Owns the Playback Cursor

**Decision**: Only the cue tool sets `nextPlaybackAtMs`. The audio consumer
does NOT update it.

**Rejected alternative**: Audio consumer updates cursor to actual completion
time.

**Rationale**: If the audio consumer updates the cursor after finishing cue N,
it clobbers the value that cue N+1 already set when it queued. This breaks the
half-step limit—cue N+2 sees the stale timestamp and exits entry blocking
early, allowing the agent to queue unlimited cues.

### 5. Configurable Stack Size

**Decision**: At most `stackSize` cues scheduled at once (default 1).

**Rejected alternative**: Allow 2-3 cue lookahead for more latency hiding.

**Rationale**:
- The time tool advances on the synthetic future timeline, so larger stack
  sizes push the agent further ahead; default 1 keeps the lead small while
  still hiding TTS latency
- One cue of lookahead (~8-16s) is enough to hide typical TTS latency
  (~0.5-1.5s) and thinking time (~1-2s); higher values are opt-in
- Cue SSE events are emitted at playback start (not queue time) to keep
  visuals aligned with audio

### 6. Silence Handled by Audio Consumer

**Decision**: The audio consumer sends `cue` SSE at playback start, then
`breathe_start` SSE and waits for silence after audio finishes.

**Rejected alternative**: Handle silence in the cue tool after queueing.

**Rationale**: The cue tool returns immediately. Silence must happen in real
playback flow, timed by the audio consumer after audio completes.

### 7. Playback Timer Starts After TTS Buffering

**Decision**: `playbackStart = Date.now()` is set *after* `await
item.ttsPromise`.

**Rejected alternative**: Start timer when item is dequeued.

**Rationale**: If the timer starts before awaiting TTS, the throttle math
counts buffering latency as playback time, which makes streaming run hot and
skews the pacing of silence.

## Invariants

1. `playbackSchedule.length <= stackSize`: schedule holds wall-clock end times
2. `nextPlaybackAtMs`: Wall-clock timestamp when the most recently queued cue
   will finish (tail of the schedule, or now if empty)
3. `agentSyntheticElapsedMs`: Sum of cue durations; drives the time tool and
   synthetic wall clock
4. Cue SSE events are emitted at playback start (not queue time)

## Observable Behavior

- First cue has unavoidable TTS latency (~1s overrun)
- Subsequent cues have TTS hidden by entry blocking
- Overrun stays constant (doesn't accumulate) because entry blocking
  self-corrects
- Agent can think and prepare next cue while current cue plays
