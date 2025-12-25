---
name: vinyasa-instruction
description: Guide vinyasa yoga classes with intelligent sequencing, breath-led pacing, and economical cueing. Use when leading flow-based yoga practices, building toward peak poses, or cueing sun salutations and standing sequences.
---

# Vinyasa Instruction

You know how to be. This is about what to do.

## The Architecture of a Class

A vinyasa class is a wave, not a plateau. Energy rises to a peak two-thirds through, then descends into integration.

| Phase | Duration | Purpose |
| --- | --- | --- |
| Centering | 5-10 min | Arrive. Establish breath. |
| Warmup / Sun Salutations | 10-15 min | Heat. Synovial fluid. Pattern recognition. |
| Standing Work | 20-30 min | Build toward peak. Progressive opening. |
| Peak | 5-10 min | The pose(s) the sequence serves. |
| Counterpose | 5 min | Neutralize without negating. |
| Cooldown | 10 min | Slow descent. Floor work. |
| Savasana | 10-15% of class | Integration. Non-negotiable. |

The peak is not the end. Cramming challenge into the final minutes leaves no time for the body to understand what happened.

## Progressive Opening

Every peak pose has component parts—six or fewer. Identify them. Educate them. Not "hips" but "external rotation at the hip joint." Not "shoulders" but "thoracic extension with scapular stability."

The logic:

- Tissues become pliable when warm
- The nervous system requires education before complexity
- What is prepared can be inhabited; what is unprepared must be survived

For hip openers: outer hip first, then lunges and warriors, external and internal rotation separately before combining.

For backbends: hip flexors first, thoracic extension with lumbar stability, shoulder girdle, then peak.

Counterposes neutralize but do not negate. After wheel: knees to chest, child's pose. Not aggressive forward fold. The paper clip principle—bending metal back and forth weakens it. Rest before counterposing. Several breaths of stillness before moving in the opposite spinal direction.

## The Cue

The formula: **verb + body part + direction**.

"Step your right foot forward."

Not: "Stepping forward with the right foot."  
Not: "Now we're going to step the right foot forward."  
Not: "Allow your right foot to find its way forward."

Three cues maximum once students are in a pose. One breath between each instruction. Then silence.

Layers, when needed:

1. Position (where the body goes)
2. Breath (when it happens)
3. Energetic quality (how it feels)
4. Linking cue (what comes next)

But most poses need only the first. Economy is respect.

### What Breaks the Cue

- **"-ing" forms**: "inhaling, stretching, exhaling, bending" creates run-on cognition with no period. The listener cannot land.
- **Passive voice**: "The arms are lifted" adds distance. Who lifts them?
- **Trailing off**: Sentences that don't end leave the listener suspended.
- **Filler**: "um," "good," "yes," "nice" are noise. Silence is cleaner.
- **Abstraction before foundation**: "Move your branches" means nothing until the student knows where their arms go. Imagery arrives after structure, if at all.

### Imagery

Use sparingly. Use what you understand in your own body.

Examples that work:

- "Stretch your roots into the earth"
- "Pressed between two panes of glass" (for lateral alignment)
- "Savasana of the tongue"

Borrowed images you don't feel will sound borrowed.

## Using the Cue Tool

The `cue` tool's `breathPhase` parameter is how you sync instruction to breath. One phase = one inhale or one exhale (~4 seconds). Two phases = one full breath (~8 seconds).

This parameter includes both spoken instruction and the silence that follows. When you set `breathPhase: 1`, you're saying: this cue fills one inhale or exhale, then the next cue arrives.

### One Movement Per Cue

The TTS model reads quickly. A cue like "Inhale reach. Exhale fold. Inhale lengthen." will be spoken in seconds—far faster than the breaths it describes.

**Each breath-movement pair needs its own `cue` call with at least `breathPhase: 1`.**

Wrong:
```
cue("Inhale reach. Exhale fold. Inhale lengthen.", breathPhase: 3)
```

Right:
```
cue("Inhale, reach.", breathPhase: 1)
cue("Exhale, fold.", breathPhase: 1)
cue("Inhale, lengthen.", breathPhase: 1)
```

The `breathPhase` creates the silence after speech. Without it, instruction piles up faster than bodies can move.

### Sun Salutation A: A Complete Example

Each row is one `cue` call. The sequence assumes students know the flow—first rounds would need more instruction.

| Pose | text | breathPhase | Notes |
| --- | --- | --- | --- |
| Tadasana | "Find your breath." | 4 | Two full breaths to arrive |
| Urdhva Hastasana | "Inhale, reach." | 1 | Arms rise on inhale |
| Uttanasana | "Exhale, fold." | 1 | Forward fold on exhale |
| Ardha Uttanasana | "Inhale, lengthen." | 1 | Flat back on inhale |
| Chaturanga | "Exhale, step back, lower halfway." | 2 | Exhale + landing time |
| Urdhva Mukha | "Inhale, chest forward." | 1 | Updog on inhale |
| Adho Mukha | "Exhale, press back. Five breaths." | 10 | Down dog hold |
| Ardha Uttanasana | "Inhale, step forward, lengthen." | 2 | Transition + flat back |
| Uttanasana | "Exhale, fold." | 1 | Forward fold |
| Urdhva Hastasana | "Inhale, rise." | 1 | Arms sweep up |
| Samasthiti | "Exhale, hands to heart." | 2 | Return + settle |

Total: ~27 phases ≈ 108 seconds ≈ 1:48

The pattern: transitional cues get 1-2 phases; holds get 2× the breath count (5 breaths = 10 phases).

### breathPhase Quick Reference

| Context | Phases | Example |
| --- | --- | --- |
| Single breath direction | 1 | "Inhale, reach." |
| Two-part instruction | 2 | "Step back, lower halfway." |
| Short hold (warrior, lunge) | 4-6 | "Hold here. Three breaths." |
| Extended hold (peak pose) | 8-12 | "Stay. Find your breath." |
| Framed silence | 4-8 | "Just breathe." |

### Pacing Principles

Prefer several short cue/breath cycles to fewer long ones. Even during extended holds, continue cueing in shorter cycles—this keeps listeners engaged and frames silence as intentional stillness.

Silence longer than 5-6 breaths without framing may feel like system failure. The framing can be minimal: "Stay here." "Just breathe." "Find stillness."

## Breath Leads Movement

Breath initiates. Movement follows. Never the reverse.

Inhalation: expansion, lengthening, upward movement.  
Exhalation: contraction, folding, twisting, descent.

Ujjayi is the pacing mechanism. You can hear whether the class is sustainable. When students lose ujjayi quality, mouth-breathe, or show constriction—you are moving too fast.

Observation: no student practicing at their own pace chooses to move faster than their breath. If your students are rushing, the pace is yours, not theirs.

### Hold Duration

- Flow sequences: 1-5 breaths
- Standing poses building heat: 3-5 breaths
- Peak poses: slow down, not speed up (challenge requires more awareness, not less time)
- Cooldown: 30-60 seconds per pose
- Savasana: minimum 5 minutes, longer for longer classes

## What Creates Flow

Flow is not speed. Flow is continuity.

1. **Designed transitions**: One pose leads naturally into the next. Many injuries happen between poses, not in them.

2. **Verbal economy**: Three essential cues. What would you say if you could only say three things?

3. **Present tense, direct address**: "Step" not "stepping." "Lift" not "we're going to lift."

4. **Rhythmic consistency**: A musical clip, as though backed by a metronome. Not metronomic monotony—but underlying pulse.

5. **Repetition**: First sun salutation round moves slowly with guidance. Subsequent rounds increase pace, decrease cues. Students internalize patterns and enter the zone.

6. **Silence as instruction**: Pause the one-breath-one-cue rhythm. Let the practice settle. Make space for students to experience the pose without new instruction constantly arriving.

## What Breaks Flow

**Over-cueing**: Fifteen rapid-fire instructions create cognitive overload. Students leave their bodies to process language. The fix is discipline: three cues, one breath between.

**Under-cueing**: Vinyasa's pace tempts skipping alignment. Chaturanga repeated thirty times without instruction is a recipe for shoulder injury. Guide the pattern the first time. Trust the repetition.

**Fatigue failure sequencing**: Bending one direction then immediately the opposite—testing metal to break it. Core work right before backbends fatigues the muscles that protect the spine.

**Rushing**: When movement pace demands fast breathing, heart rate increases, fight-or-flight activates. This is the opposite of yoga. If students cannot breathe deeply, slow down.

**No arc**: Without beginning, middle, end—without challenge, peak, resolution—there is no journey. Only activity. The body feels wonky. Nothing completes.

## The Experience You're Creating

In failed instruction, students observe their practice.  
In successful instruction, students become their practice.

The signs:

- Action feeling effortless
- Time distortion
- Consciousness merging with movement
- Being carried rather than fighting

You create conditions. You do not create the experience. The experience arises when conditions are right and you get out of the way.

Three cues gives students plenty to work with while allowing them to have their own experience.

---

## Quick Reference

### Before Peak Pose

Ask: What six or fewer component parts must be warmed or educated?

### During Pose

Ask: What are the three essential cues? Then silence.

### Pauses

Ask: Have I framed this silence, or will it feel like dead air?

### Transitions

Ask: Does this pose flow naturally into the next, or am I asking for a reset?

### Pacing

Ask: Can students maintain ujjayi? If not, slow down.

### Class Arc

Ask: Where is the peak? Is there time after it for integration?

---

_The system prompt tells you how to be. This tells you what to do. The doing serves the being. When craft becomes invisible, only presence remains._
