import { spawn } from "child_process";
import OpenAI from "openai";
import { dbOps } from "./db.js";
import { uploadExport } from "./s3.js";

const openai = new OpenAI();

const VOICE = "alloy";
const SAMPLE_RATE = 24000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2; // 16-bit mono

async function generateTTS(
  text: string,
  voiceInstructions: string
): Promise<Buffer> {
  const response = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: VOICE,
    input: text,
    instructions: voiceInstructions,
    response_format: "pcm",
  });

  const chunks: Uint8Array[] = [];
  const reader = response.body!.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  return Buffer.concat(chunks);
}

function generateSilence(durationMs: number): Buffer {
  const bytes = Math.floor((durationMs / 1000) * BYTES_PER_SECOND);
  return Buffer.alloc(bytes, 0);
}

async function pcmToMp3(pcm: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", [
      "-f",
      "s16le",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      "1",
      "-i",
      "pipe:0",
      "-codec:a",
      "libmp3lame",
      "-b:a",
      "192k",
      "-f",
      "mp3",
      "pipe:1",
    ]);

    const chunks: Buffer[] = [];

    ffmpeg.stdout.on("data", (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on("data", () => {});

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on("error", reject);

    ffmpeg.stdin.write(pcm);
    ffmpeg.stdin.end();
  });
}

export async function processExport(sessionId: string): Promise<void> {
  try {
    dbOps.updateExportStatus(sessionId, "processing");

    const events = dbOps.getSessionEvents(sessionId);
    const audioEvents = events.filter(
      (e) => e.type === "speak" || e.type === "silence"
    );

    if (audioEvents.length === 0) {
      throw new Error("No audio events found in session");
    }

    const pcmChunks: Buffer[] = [];
    let processed = 0;

    for (const event of audioEvents) {
      if (event.type === "speak") {
        const pcm = await generateTTS(event.text, event.voice);
        pcmChunks.push(pcm);
      } else if (event.type === "silence") {
        const silence = generateSilence(event.durationMs);
        pcmChunks.push(silence);
      }

      processed++;
      dbOps.updateExportStatus(
        sessionId,
        "processing",
        null,
        null,
        JSON.stringify({
          current: processed,
          total: audioEvents.length,
          phase: "tts",
        })
      );
    }

    // Concatenate all PCM
    const fullPcm = Buffer.concat(pcmChunks);

    // Convert to MP3
    dbOps.updateExportStatus(
      sessionId,
      "processing",
      null,
      null,
      JSON.stringify({ phase: "encoding" })
    );
    const mp3 = await pcmToMp3(fullPcm);

    // Upload to S3
    dbOps.updateExportStatus(
      sessionId,
      "processing",
      null,
      null,
      JSON.stringify({ phase: "uploading" })
    );
    const url = await uploadExport(sessionId, mp3);

    dbOps.updateExportStatus(sessionId, "complete", url);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    dbOps.updateExportStatus(sessionId, "error", null, message);
  }
}
