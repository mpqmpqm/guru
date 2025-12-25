# Voice and Timing

Patterns extracted from successful guidance sessions.

---

## The `voice` Parameter

The `voice` parameter shapes TTS delivery. Vague instructions produce flat output.

### What Doesn't Work

| Anti-pattern | Problem |
| --- | --- |
| "Speak calmly" | Too vague—how? |
| "Soothing tone" | Prescribes outcome, not delivery |
| "Gentle voice" | No physical or relational grounding |
| (no voice parameter) | TTS defaults are flat |

### What Works

Shape voice through physical, relational, or embodied descriptions:

**Physical location:**
```
As if speaking from just behind the ear.
```

**Relationship to listener:**
```
The tone of someone walking beside, not in front.
```

```
Conspiratorial. We're in this together.
```

**Body state:**
```
Speaking from the belly not the head.
```

```
Breath audible in the speaking.
```

**Emotional quality held lightly:**
```
Wonder creeping in at edges but held back, restrained.
```

```
Dry, factual, with a hint of mischief underneath.
```

**What changes during delivery:**
```
Voice quieting toward silence.
```

```
Building slightly in intensity but still contained.
```

**Specific physical instructions:**
```
The word "slow" takes twice as long as it should.
```

```
Each phrase lands with weight of a footstep.
```

### Voice Arc Within a Session

Voice should evolve as the session progresses:

- **Opening**: Low, unhurried, arriving
- **Building**: Curious, exploratory, slightly more present
- **Core/Peak**: Full, grounded, possibly urgent or intense
- **Integration**: Softening, tender, spacious
- **Closing**: Quiet, almost disappearing, releasing

---

## The `breathPhase` Parameter

One phase = one inhale or exhale (~4 seconds). The parameter includes spoken instruction AND the silence that follows.

### Range in Practice

| Context | Phases | Example cue |
| --- | --- | --- |
| Rapid transition | 1 | "Inhale, reach." |
| Two-part instruction | 2 | "Exhale, step back, lower." |
| Instruction + landing | 3-4 | "Stop walking." |
| Short hold | 4-6 | "Hold here. Three breaths." |
| Exploration prompt | 6-8 | "Notice what happens in the trying." |
| Question to sit with | 8-12 | "What are you preventing right now?" |
| Framed longer silence | 15-25 | "Walk in silence for a while." |
| Extended meditation | 30-60 | "For the next minute, meet everything." |

### One Cue Per Breath-Movement

The TTS reads quickly. This:
```
cue("Inhale reach. Exhale fold. Inhale lengthen.", breathPhase: 3)
```

...will be spoken in ~2 seconds, not the 12 seconds of breath it describes. Split it:

```
cue("Inhale, reach.", breathPhase: 1)
cue("Exhale, fold.", breathPhase: 1)
cue("Inhale, lengthen.", breathPhase: 1)
```

### Silence Framing

Silence longer than ~6 breaths (12 phases) without framing feels like system failure. Frame before or after:

**Before:**
```
"Walk in silence for a while. No voice needed."
```

**After (returning from silence):**
```
"When you walk, the world rearranges itself around you."
```

The framing can be minimal: "Stay here." "Just breathe." "Find stillness."

---

## The `time` Tool

Check every 2-4 minutes to pace toward duration targets.

### When to Check

- After opening section lands
- Before committing to a long exploration
- After extended silence
- When sensing the session should start closing

### What to Do With Results

| Situation | Action |
| --- | --- |
| Running fast | Longer pauses, add exploration prompts |
| Running slow | Tighten breathPhase, reduce silences |
| ~80% through | Begin transition to integration/closing |
| After long silence | Orient to remaining time |

---

## Session Arc

| Phase | % of time | Purpose | breathPhase tendency |
| --- | --- | --- | --- |
| Opening | 10-15% | Arrive, establish presence | Longer (4-8) |
| Building | 20-30% | Deepen attention, introduce theme | Medium (3-6) |
| Core | 30-40% | Main work, challenges, peaks | Variable (1-30) |
| Integration | 15-20% | Soften, metabolize | Longer (6-15) |
| Closing | 5-10% | Return, release | Tapering to minimal |

### Arc Markers

**Opening complete when:** Breath established, ordinary mind quieting, presence arriving.

**Building to core transition:** Theme introduced, attention deepened, ready for challenge or exploration.

**Core to integration:** Peak reached, intensity honored, time to metabolize.

**Integration to closing:** Body settling, insights landing, ready to return.

---

## Example: Complete Cue Call

```
cue(
  text: "The canal is not waiting for you. The sun is not
         warming you on purpose. This is the ordinary
         scandal: things exist without needing your
         attention.",
  voice: "Dry, factual, with a hint of mischief underneath.
          Let the provocative content land without
          dramatizing it.",
  breathPhase: 12
)
```

The text is provocative. The voice doesn't oversell it. The breathPhase (12 = 6 full breaths ≈ 48 seconds) gives it room to land.
