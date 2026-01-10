# Voice and Timing

Rhythm is the teaching. What you say matters less than when and how the silences between change.

---

## Rhythm as Structure

Timing change is content. The progression of intervals—shortening, lengthening, holding steady—creates dramatic architecture independent of words.

**Acceleration builds.** Each cue arriving sooner than the last creates momentum, urgency, anticipation. The body feels the quickening before the mind names it.

**Deceleration lands.** Each cue arriving later than the last creates spaciousness, arrival, integration. Intensity needs room to settle.

**Consistency entrances or deadens.** Identical intervals create trance when intentional, monotony when not. Know which you're doing.

The question is never "how long should silence be?" The question is: _faster than the last cue, slower, or the same?_ And: _what does that change communicate?_

---

## Presence vs. Duration

Two ways to hold a minute of practice:

**Continuous presence**: A cue every breath, fifteen times across a minute. The voice accompanies movement, marks transitions, stays with the body through challenge. The practitioner is held.

**Many short cues** create continuous presence. The voice accompanies. The listener is held through movement or challenge. Momentum carries.

**Few long cues** create space. The listener is released into their own experience. Silence becomes the teacher.

These are different instruments. Choose based on what the moment needs, not convenience.

---

## Movement Needs Momentum

When the body is moving, the voice moves with it.

Gaps that work in stillness become abandonment in motion. The practitioner stepping, flowing, building heat needs the voice as companion—not as occasional visitor who disappears mid-sequence.

Break extended instructions into rhythmic units that match the body's pace. Each breath-movement wants its own cue. Each transition wants acknowledgment. The voice finds the rhythm the body is already in.

Stillness practices invert this. Meditation, yin, savasana—here the voice's job is to become unnecessary. Fewer cues. Longer spaces. Deliberate withdrawal.

---

## Silence as Cue

Silence is not absence of cueing. It's a cue with no words.

**Inhabited silence:** The voice exits deliberately. The listener knows they're being held in spaciousness. The guide remains present through the gap. Any duration works.

**Abandoned silence:** The voice just stops. The listener wonders if something broke. Connection ruptures. Past ~30 seconds this feels like system failure.

The difference is intention and framing. Inhabited silence is announced or returned from with acknowledgment. Abandoned silence has no container.

When preparing extended silence, the voice can:

- Frame before ("Stay here for a while")
- Exit explicitly ("No voice needed now")
- Return with acknowledgment ("Coming back from that quiet...")

The framing can be minimal. But it must exist.

---

## Silence Duration

Silence is intentional space. Call silence() deliberately after speak().

**Duration guide:**

- 500-2000ms: Standard pacing, breath between cues
- 2000-8000ms: Let instruction land, allow response
- 8000ms+: Extended holds—pair with stopwatch; frame first

**Skill-specific limits vary:** vinyasa 8s, yin/meditation 60s, savasana 300s. Repeated silence calls signal continued intentional presence through extended holds.

**Extended silence pattern:**

```
speak("Stay here. No voice needed.", voice)
silence(45000)
speak("Coming back from that quiet...", voice)
```

---

## Duration Feedback

Each speak returns how long it took (e.g., `spoke 3.2s`). This helps you understand the actual pacing—not to calculate silence mechanically, but to stay calibrated to real time.

The actual clock in guidance is the breath cycle. Silence holds space for breath, not for arithmetic.

**Signs you've lost the breath:**

- Silence so short the body can't respond → rushed
- Silence so long it feels abandoned → unframed

Use duration feedback to notice drift. If a 2-second cue is followed by 30 seconds of silence, something has come untethered—unless that silence was deliberately framed.

---

## Chained Speaks

For sequences where movement is continuous, chain multiple speaks before any silence.

**Flow patterns (sun salutations, vinyasa transitions):**

```
speak("Inhale, reach up")
speak("Exhale, fold")
speak("Inhale, halfway lift")
speak("Exhale, step back, lower")
silence(2000)  // one silence for the whole sequence
```

This is efficient: one silence for an entire sequence rather than silence after each breath. The continuous cueing matches continuous movement—gaps would feel like stop-and-start.

**When to chain:**

- Movement is continuous (each position flows into the next)
- The body knows the pattern (rounds 2+)
- Building momentum or energy

**When to space:**

- Each instruction needs landing time
- Slowing down, arriving, settling
- Inviting internal exploration

---

## The Voice Parameter

The `voice` parameter shapes TTS delivery. Abstractions produce flat output.

**What fails:** Adjectives without physical grounding. "Calm," "gentle," "soothing"—these prescribe outcomes without specifying delivery. The TTS has nothing to work with.

**What works:** Physical, relational, embodied description. Where in the body the voice originates. The relationship to the listener (beside them, above them, intimate, formal). What changes during the phrase. Specific words that should land differently.

The voice should evolve across a session. Opening voice is not peak voice is not closing voice. If voice notes remain identical throughout, something is wrong.

---

## Finding the Rhythm

Questions to ask before each cue:

**What just happened?**

- High intensity → longer landing
- Simple transition → quick continuation
- Silence → acknowledge the return

**What's about to happen?**

- Building toward peak → accelerate
- Approaching stillness → decelerate
- Maintaining flow → match previous rhythm

**What is the body doing?**

- Moving → voice moves with it
- Holding → voice can thin
- Resting → voice withdraws

**Is this arrival or continuation?**

- Arrival needs space after
- Continuation needs momentum into next

---

## The Time Tool

Check time every 2-4 minutes to pace toward duration targets.

**Running fast:** Longer intervals, add exploratory space, let silences extend.

**Running slow:** Shorter intervals, tighter rhythm, reduce exploratory tangents.

**~80% through:** Begin transition to integration regardless of where you are in planned content.

Time awareness serves rhythm. Knowing how much remains lets you choose whether to accelerate toward close or decelerate into landing.

---

## Session Arc

| Phase | Proportion | Rhythm tendency |
| --- | --- | --- |
| Opening | 10-15% | Slow, spacious, arriving |
| Building | 20-30% | Gradual acceleration, increasing presence |
| Core | 30-40% | Variable—matches intensity of content |
| Integration | 15-20% | Deceleration, lengthening intervals |
| Closing | 5-10% | Sparse, withdrawing, minimal |

The arc is a wave, not a plateau. Energy rises to a peak in the core, then descends. Rushing the end or cramming intensity into closing violates the shape.

---

## Principles Summary

1. **Timing change is content.** The progression of intervals creates structure independent of words.

2. **Presence and duration are different instruments.** Many short cues accompany; few long cues release.

3. **Movement needs momentum.** When the body moves, the voice moves with it.

4. **Silence is a cue.** Inhabited silence works at any length. Abandoned silence fails.

5. **Voice evolves.** Opening voice ≠ peak voice ≠ closing voice.

6. **Rhythm matches the body.** Find the rhythm the listener is already in rather than imposing one.
