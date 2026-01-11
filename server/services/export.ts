import { spawn, ChildProcess } from "child_process";
import OpenAI from "openai";
import { encoding_for_model } from "tiktoken";
import { dbOps } from "./db.js";
import { uploadExportStream } from "./s3.js";

const openai = new OpenAI();

// Reusable encoder for TTS token counting
const ttsEncoder = encoding_for_model("gpt-4o-mini");

const VOICE = "alloy";
const SAMPLE_RATE = 24000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2; // 16-bit mono

// Track running exports for cancellation
const runningExports = new Map<
  string,
  { abort: AbortController; ffmpeg: ChildProcess | null }
>();

export function cancelExport(sessionId: string): boolean {
  const running = runningExports.get(sessionId);
  if (!running) return false;

  running.abort.abort();
  if (running.ffmpeg && !running.ffmpeg.killed) {
    running.ffmpeg.kill();
  }
  runningExports.delete(sessionId);
  return true;
}

// Minimal audio event type for export processing
type AudioEvent =
  | {
      type: "speak";
      text: string;
      voice: string;
      sequence_num: number;
    }
  | {
      type: "silence";
      durationMs: number;
      sequence_num: number;
    };

// Stream TTS directly to a writable (ffmpeg stdin)
async function streamTTSTo(
  text: string,
  voiceInstructions: string,
  writable: NodeJS.WritableStream,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) throw new Error("Export cancelled");

  const response = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: VOICE,
    input: text,
    instructions: voiceInstructions,
    response_format: "pcm",
  });

  const reader = response.body!.getReader();
  while (true) {
    if (signal.aborted) {
      await reader.cancel();
      throw new Error("Export cancelled");
    }
    const { done, value } = await reader.read();
    if (done) break;
    writable.write(Buffer.from(value));
  }
}

// Write silence directly to a writable
function writeSilenceTo(
  durationMs: number,
  writable: NodeJS.WritableStream
): void {
  const bytes = Math.floor(
    (durationMs / 1000) * BYTES_PER_SECOND
  );
  // Write in 64KB chunks to avoid large allocations
  const chunkSize = 65536;
  const zeroChunk = Buffer.alloc(
    Math.min(chunkSize, bytes),
    0
  );
  let remaining = bytes;
  while (remaining > 0) {
    const toWrite = Math.min(remaining, chunkSize);
    if (toWrite === chunkSize) {
      writable.write(zeroChunk);
    } else {
      writable.write(Buffer.alloc(toWrite, 0));
    }
    remaining -= toWrite;
  }
}

function spawnFfmpeg(): ChildProcess {
  return spawn("ffmpeg", [
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
}

export async function processExport(
  sessionId: string
): Promise<void> {
  const abortController = new AbortController();
  const signal = abortController.signal;
  let ffmpeg: ChildProcess | null = null;

  // Register this export for cancellation
  runningExports.set(sessionId, {
    abort: abortController,
    ffmpeg: null,
  });

  try {
    dbOps.updateExportStatus(sessionId, "processing");

    const events = dbOps.getSessionEvents(sessionId);
    let audioEvents: AudioEvent[] = events
      .filter((e) => e.type === "speak" || e.type === "silence")
      .map((e) => {
        if (e.type === "speak") {
          return {
            type: "speak" as const,
            text: e.text,
            voice: e.voice,
            sequence_num: e.sequence_num,
          };
        } else {
          return {
            type: "silence" as const,
            durationMs: e.durationMs,
            sequence_num: e.sequence_num,
          };
        }
      });

    // Prior schema support: if no silences, build events from
    // cues with wait_ms
    const hasSilences = audioEvents.some(
      (e) => e.type === "silence"
    );
    if (!hasSilences) {
      const cues = dbOps.getCues(sessionId);
      audioEvents = [];
      for (const cue of cues) {
        audioEvents.push({
          type: "speak",
          text: cue.text,
          voice: cue.voice,
          sequence_num: cue.sequence_num,
        });
        if (cue.wait_ms && cue.wait_ms > 0) {
          audioEvents.push({
            type: "silence",
            durationMs: cue.wait_ms,
            sequence_num: cue.sequence_num + 0.5,
          });
        }
      }
      audioEvents.sort(
        (a, b) => a.sequence_num - b.sequence_num
      );
    }

    if (audioEvents.length === 0) {
      throw new Error("No audio events found in session");
    }

    if (signal.aborted) throw new Error("Export cancelled");

    // Spawn ffmpeg and start S3 upload in parallel
    ffmpeg = spawnFfmpeg();
    ffmpeg.stderr?.on("data", () => {});

    // Update running exports with ffmpeg reference
    runningExports.set(sessionId, { abort: abortController, ffmpeg });

    // Start S3 upload with ffmpeg stdout as the source
    const uploadPromise = uploadExportStream(
      sessionId,
      ffmpeg.stdout!
    );

    // Track ffmpeg errors
    let ffmpegError: Error | null = null;
    ffmpeg.on("error", (err) => {
      ffmpegError = err;
    });

    // Process audio events, streaming directly to ffmpeg
    let processed = 0;
    for (const event of audioEvents) {
      if (signal.aborted) throw new Error("Export cancelled");

      if (event.type === "speak") {
        await streamTTSTo(
          event.text,
          event.voice,
          ffmpeg.stdin!,
          signal
        );

        // Track export TTS cost
        const inputTokens = ttsEncoder.encode(
          event.text + event.voice
        ).length;
        dbOps.accumulateExportTTSCost(sessionId, inputTokens);
      } else if (event.type === "silence") {
        writeSilenceTo(event.durationMs, ffmpeg.stdin!);
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

    // Signal end of input to ffmpeg
    ffmpeg.stdin!.end();

    // Update status to uploading
    dbOps.updateExportStatus(
      sessionId,
      "processing",
      null,
      null,
      JSON.stringify({ phase: "uploading" })
    );

    // Wait for S3 upload to complete
    const url = await uploadPromise;

    if (ffmpegError) {
      throw ffmpegError;
    }

    dbOps.updateExportStatus(sessionId, "complete", url);
  } catch (error) {
    // Clean up ffmpeg if still running
    if (ffmpeg && !ffmpeg.killed) {
      ffmpeg.kill();
    }

    const message =
      error instanceof Error ? error.message : String(error);
    dbOps.updateExportStatus(sessionId, "error", null, message);
  } finally {
    runningExports.delete(sessionId);
  }
}
