import "dotenv/config";
import { ElevenLabsClient, stream } from "@elevenlabs/elevenlabs-js";

const elevenlabs = new ElevenLabsClient({
  apiKey: process.env.ELEVENLABS_API_KEY,
});

// Rachel voice - calm and clear, good for yoga
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";

export class AudioBridge {
  async speak(text: string): Promise<void> {
    const audioStream = await elevenlabs.textToSpeech.stream(VOICE_ID, {
      text,
      modelId: "eleven_flash_v2_5",
      outputFormat: "mp3_44100_128",
    });
    await stream(audioStream);
  }

  async wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
