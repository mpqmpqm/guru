import { execSync } from "child_process";
import "dotenv/config";
import { unlinkSync, writeFileSync } from "fs";
import OpenAI from "openai";
import { tmpdir } from "os";
import { join } from "path";

const openai = new OpenAI();

const VOICE = "alloy";
const VOICE_INSTRUCTIONS =
  "Warm, grounded yoga teacher. Measured pace with natural pauses. Clear articulation, especially Sanskrit. Calm and present—not breathy, not performative. No filler praise. Quiet confidence, unhurried but awake.";

export class AudioBridge {
  async speak(text: string): Promise<void> {
    const response = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: VOICE,
      input: text,
      instructions: VOICE_INSTRUCTIONS,
      response_format: "mp3",
    });

    // Write to temp file and play with afplay (macOS) or ffplay
    const tempFile = join(
      tmpdir(),
      `guru-tts-${Date.now()}.mp3`
    );
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(tempFile, buffer);

    try {
      // Try afplay (macOS), fall back to ffplay
      try {
        execSync(`afplay "${tempFile}"`, { stdio: "ignore" });
      } catch {
        execSync(`ffplay -nodisp -autoexit "${tempFile}"`, {
          stdio: "ignore",
        });
      }
    } finally {
      unlinkSync(tempFile);
    }
  }

  async wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
