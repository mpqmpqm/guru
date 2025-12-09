import type { AudioBridge } from "./audio-bridge.js";

// 50 BPM = 1 beat per 1.2 seconds = 1200ms per count
const MS_PER_COUNT = 1200;

export const toolDefinitions = [
  {
    name: "cue",
    description:
      "Speaks text to guide the student through a yoga class, then optionally pauses for a number of counts at 50 BPM. Use for breath cues (e.g., 'inhale', 'exhale'), position guidance, and transitions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description: "The text to speak aloud",
        },
        pause: {
          type: "number",
          description:
            "Number of counts to pause after speaking (at 50 BPM, each count is 1.2 seconds). Default is 0.",
        },
      },
      required: ["text"],
    },
  },
  {
    name: "cue_sequence",
    description:
      "Executes a sequence of cues in order, with proper timing between each. Use this to batch multiple instructions together for smooth pacing without inter-cue latency.",
    inputSchema: {
      type: "object" as const,
      properties: {
        cues: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: {
                type: "string",
                description: "The text to speak aloud",
              },
              pause: {
                type: "number",
                description:
                  "Number of counts to pause after speaking (at 50 BPM, each count is 1.2 seconds). Default is 0.",
              },
            },
            required: ["text"],
          },
          description: "Array of cues to execute in sequence",
        },
      },
      required: ["cues"],
    },
  },
];

export async function handleCue(
  bridge: AudioBridge,
  text: string,
  pause: number = 0
) {
  await bridge.speak(text);
  if (pause > 0) {
    await bridge.wait(pause * MS_PER_COUNT);
  }
  return {
    content: [
      {
        type: "text" as const,
        text:
          pause > 0
            ? `Cue complete with ${pause} count pause`
            : "Cue complete",
      },
    ],
  };
}

export async function handleCueSequence(
  bridge: AudioBridge,
  cues: Array<{ text: string; pause?: number }>
) {
  const results: string[] = [];

  for (const cue of cues) {
    await bridge.speak(cue.text);
    if (cue.pause && cue.pause > 0) {
      await bridge.wait(cue.pause * MS_PER_COUNT);
    }
    results.push(
      cue.pause && cue.pause > 0
        ? `"${cue.text.slice(0, 30)}${cue.text.length > 30 ? "..." : ""}" + ${cue.pause} counts`
        : `"${cue.text.slice(0, 30)}${cue.text.length > 30 ? "..." : ""}"`
    );
  }

  return {
    content: [
      {
        type: "text" as const,
        text: `Completed ${cues.length} cues:\n${results.join("\n")}`,
      },
    ],
  };
}
