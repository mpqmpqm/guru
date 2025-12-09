# Yoga MCP Server - Guide for Teachers

This guide explains how to use the yoga tool effectively to lead
a class.

## Available Tool

| Tool  | Arguments                        | Behavior                          |
| ----- | -------------------------------- | --------------------------------- |
| `cue` | `text: string`, `pause?: number` | Speaks the text, optionally waits |

## Understanding Blocking Calls

**Tool calls are blocking.** When you call `cue`, your next
instruction won't execute until the current one completes. This
includes both the speech and any pause you specify.

This blocking behavior is intentional - it ensures proper pacing
and prevents instructions from overlapping.

## Timing Reference

The tempo is fixed at **50 BPM** (beats per minute):

- 1 count = 1.2 seconds
- 4 counts = 4.8 seconds
- 8 counts = 9.6 seconds

## Cueing for Breath

Use `cue` with appropriate pauses to guide breathing:

```
cue("breathe in", pause=4)   // 4 counts for the inhale
cue("breathe out", pause=4)  // 4 counts for the exhale
```

You can vary the timing based on the moment:

```
cue("inhale deeply", pause=6)           // longer breath
cue("exhale completely", pause=6)       // match the inhale
cue("sip in a little more air", pause=2) // quick top-up breath
```

For a simple breathing sequence:

```
cue("breathe in", pause=4)
cue("breathe out", pause=4)
cue("breathe in", pause=4)
cue("breathe out", pause=4)
```

## Cueing for Position

Use `cue` to guide students into poses. Consider breaking complex
movements into steps:

```
cue("come to standing at the top of your mat", pause=2)
cue("feet hip width apart", pause=1)
cue("arms by your sides", pause=1)
```

For transitions, give the instruction and a pause for movement:

```
cue("step your right foot back into a lunge", pause=3)
cue("lower your back knee to the mat", pause=2)
```

## Using Pauses Effectively

The `pause` parameter is the number of counts (at 50 BPM) to wait
after speaking.

| Pause | Duration | Good for                              |
| ----- | -------- | ------------------------------------- |
| 0     | none     | Quick instructions, flowing speech    |
| 1-2   | 1.2-2.4s | Minor adjustments, brief transitions  |
| 3-4   | 3.6-4.8s | Standard breath, moderate transitions |
| 6-8   | 7.2-9.6s | Holding poses, longer breath cycles   |

**No pause** - use for instructions that flow into the next:

```
cue("as you exhale")  // no pause, flows into next cue
cue("fold forward", pause=4)
```

**Short pause** (1-2 counts) - for small adjustments:

```
cue("relax your shoulders", pause=1)
cue("soften your jaw", pause=1)
```

**Standard pause** (3-4 counts) - for breath-length holds:

```
cue("hold here", pause=4)
```

**Long pause** (6+ counts) - for sustained holds:

```
cue("stay in this pose, breathing naturally", pause=8)
```

## Example Sequences

### Simple Breath Awareness

```
cue("find a comfortable seated position", pause=4)
cue("close your eyes", pause=2)
cue("begin to notice your breath", pause=4)
cue("breathe in", pause=4)
cue("breathe out", pause=4)
cue("breathe in", pause=4)
cue("breathe out", pause=4)
cue("let your breath return to normal", pause=2)
```

### Sun Salutation Opening

```
cue("stand at the top of your mat in mountain pose", pause=3)
cue("inhale, reach your arms overhead", pause=4)
cue("exhale, fold forward", pause=4)
cue("inhale, halfway lift, flat back", pause=4)
cue("exhale, fold", pause=4)
```

### Holding a Pose

```
cue("come into warrior two", pause=4)
cue("front knee over ankle", pause=1)
cue("arms extend long", pause=1)
cue("gaze over your front fingertips", pause=2)
cue("hold here", pause=8)
cue("breathe", pause=4)
```

### Asymmetric Breathing (Longer Exhale)

```
cue("breathe in", pause=4)
cue("slowly breathe out", pause=6)
cue("breathe in", pause=4)
cue("slowly breathe out", pause=6)
```

## Tips

1. **Let the tool do the timing.** Don't worry about counting -
   the pauses handle it.

2. **Layer instructions.** Break complex poses into digestible
   pieces with short pauses.

3. **Vary your breath cues.** Instead of always saying "breathe in",
   try "inhale deeply", "sip in more air", or "fill your lungs".

4. **Match pause to movement complexity.** Bigger transitions
   need longer pauses.

5. **Silence is okay.** A `cue("hold", pause=8)` gives students
   space without constant talking.

6. **Flow vs. structure.** Use zero-pause cues for flowing
   sequences, longer pauses for restorative work.

7. **Combine breath and movement.** You can cue both in one:
   `cue("inhale, reach your arms up", pause=4)` is often more
   natural than separate breath and movement cues.
