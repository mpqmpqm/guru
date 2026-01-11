import { spawn, ChildProcess } from "child_process";
import OpenAI from "openai";
import { encoding_for_model } from "tiktoken";
import { dbOps } from "./db.js";
import { uploadExportStream } from "./s3.js";

const openai = new OpenAI();

// Reusable encoder for TTS token counting
const ttsEncoder = encoding_for_model("gpt-4o-mini");

const VOICE = "marin";
const SAMPLE_RATE = 24000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2; // 16-bit mono
const TTS_CONCURRENCY = 10;

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

// Fetch TTS and return buffer
async function fetchTTS(
  text: string,
  voiceInstructions: string,
  signal: AbortSignal
): Promise<Buffer> {
  if (signal.aborted) throw new Error("Export cancelled");

  const response = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: VOICE,
    input: text,
    instructions: voiceInstructions,
    response_format: "pcm",
  });

  const chunks: Buffer[] = [];
  const reader = response.body!.getReader();
  while (true) {
    if (signal.aborted) {
      await reader.cancel();
      throw new Error("Export cancelled");
    }
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

// Generate silence buffer
function generateSilence(durationMs: number): Buffer {
  const bytes = Math.floor(
    (durationMs / 1000) * BYTES_PER_SECOND
  );
  return Buffer.alloc(bytes, 0);
}

// Write buffer to writable in chunks to avoid backpressure issues
function writeBufferTo(
  buffer: Buffer,
  writable: NodeJS.WritableStream
): void {
  const chunkSize = 65536;
  for (let i = 0; i < buffer.length; i += chunkSize) {
    writable.write(buffer.subarray(i, i + chunkSize));
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

// Parallel TTS fetcher with concurrency limit
async function fetchAllTTS(
  speakEvents: Array<{
    index: number;
    text: string;
    voice: string;
  }>,
  signal: AbortSignal,
  onProgress: (completed: number) => void
): Promise<Map<number, Buffer>> {
  const results = new Map<number, Buffer>();
  let completed = 0;

  // Simple semaphore for concurrency control
  let active = 0;
  const pending: Array<() => void> = [];

  const acquire = (): Promise<void> => {
    if (active < TTS_CONCURRENCY) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => pending.push(resolve));
  };

  const release = () => {
    active--;
    const next = pending.shift();
    if (next) {
      active++;
      next();
    }
  };

  const fetchOne = async (event: {
    index: number;
    text: string;
    voice: string;
  }) => {
    await acquire();
    try {
      if (signal.aborted) throw new Error("Export cancelled");
      const buffer = await fetchTTS(event.text, event.voice, signal);
      results.set(event.index, buffer);
      completed++;
      onProgress(completed);
    } finally {
      release();
    }
  };

  await Promise.all(speakEvents.map(fetchOne));
  return results;
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

    // Identify speak events for parallel TTS fetching
    const speakEvents = audioEvents
      .map((e, index) => ({ event: e, index }))
      .filter(
        (x): x is { event: Extract<AudioEvent, { type: "speak" }>; index: number } =>
          x.event.type === "speak"
      )
      .map(({ event, index }) => ({
        index,
        text: event.text,
        voice: event.voice,
      }));

    // Track TTS cost
    for (const e of speakEvents) {
      const inputTokens = ttsEncoder.encode(e.text + e.voice).length;
      dbOps.accumulateExportTTSCost(sessionId, inputTokens);
    }

    // Fetch all TTS in parallel
    const ttsResults = await fetchAllTTS(
      speakEvents,
      signal,
      (completed) => {
        dbOps.updateExportStatus(
          sessionId,
          "processing",
          null,
          null,
          JSON.stringify({
            current: completed,
            total: speakEvents.length,
            phase: "tts",
          })
        );
      }
    );

    if (signal.aborted) throw new Error("Export cancelled");

    // Spawn ffmpeg and start S3 upload
    ffmpeg = spawnFfmpeg();
    ffmpeg.stderr?.on("data", () => {});
    runningExports.set(sessionId, { abort: abortController, ffmpeg });

    const uploadPromise = uploadExportStream(
      sessionId,
      ffmpeg.stdout!
    );

    let ffmpegError: Error | null = null;
    ffmpeg.on("error", (err) => {
      ffmpegError = err;
    });

    // Write audio to ffmpeg in order
    dbOps.updateExportStatus(
      sessionId,
      "processing",
      null,
      null,
      JSON.stringify({ phase: "encoding" })
    );

    for (let i = 0; i < audioEvents.length; i++) {
      if (signal.aborted) throw new Error("Export cancelled");

      const event = audioEvents[i];
      if (event.type === "speak") {
        const buffer = ttsResults.get(i)!;
        writeBufferTo(buffer, ffmpeg.stdin!);
      } else {
        const silence = generateSilence(event.durationMs);
        writeBufferTo(silence, ffmpeg.stdin!);
      }
    }

    ffmpeg.stdin!.end();

    dbOps.updateExportStatus(
      sessionId,
      "processing",
      null,
      null,
      JSON.stringify({ phase: "uploading" })
    );

    const url = await uploadPromise;

    if (ffmpegError) {
      throw ffmpegError;
    }

    dbOps.updateExportStatus(sessionId, "complete", url);
  } catch (error) {
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
