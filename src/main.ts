import "./style.css";

const WS_URL = "ws://localhost:8080";

interface AudioStartMessage {
  type: "audio-start";
  text: string;
  id: string;
}

interface AudioEndMessage {
  type: "audio-end";
  id: string;
}

type ServerMessage = AudioStartMessage | AudioEndMessage;

// Track if audio has been unlocked by user interaction
// Persist in sessionStorage to survive tab discard/reload
let audioUnlocked = sessionStorage.getItem("audioUnlocked") === "true";

// MediaSource streaming state
let mediaSource: MediaSource | null = null;
let sourceBuffer: SourceBuffer | null = null;
let audioElement: HTMLAudioElement | null = null;
let pendingChunks: ArrayBuffer[] = [];
let currentId: string | null = null;
let ws: WebSocket | null = null;

// DOM elements
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div class="yoga-container">
    <h1>Yoga Class</h1>
    <div id="status" class="status disconnected">Disconnected</div>
    <button id="start-btn" class="start-btn">Start Class</button>
    <div id="instruction" class="instruction"></div>
  </div>
`;

const statusEl = document.querySelector<HTMLDivElement>("#status")!;
const instructionEl = document.querySelector<HTMLDivElement>("#instruction")!;
const startBtn = document.querySelector<HTMLButtonElement>("#start-btn")!;

// Unlock audio on user interaction
async function unlockAudio() {
  const ctx = new AudioContext();
  const buffer = ctx.createBuffer(1, 1, 22050);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(ctx.destination);
  source.start();

  audioUnlocked = true;
  sessionStorage.setItem("audioUnlocked", "true");
  startBtn.style.display = "none";
  instructionEl.textContent = "Ready for instructions...";
}

startBtn.addEventListener("click", unlockAudio);

// If already unlocked from previous session, hide button but re-unlock audio context
if (audioUnlocked) {
  startBtn.style.display = "none";
  instructionEl.textContent = "Reconnecting...";
  // Re-unlock audio context (required per page load)
  document.addEventListener("click", () => unlockAudio(), { once: true });
}

// MediaSource streaming functions
function initMediaSource(): Promise<void> {
  return new Promise((resolve, reject) => {
    cleanup();

    mediaSource = new MediaSource();
    audioElement = new Audio();
    audioElement.src = URL.createObjectURL(mediaSource);

    mediaSource.addEventListener("sourceopen", () => {
      try {
        sourceBuffer = mediaSource!.addSourceBuffer("audio/mpeg");
        sourceBuffer.addEventListener("updateend", appendNextChunk);
        resolve();
      } catch (e) {
        reject(e);
      }
    });

    mediaSource.addEventListener("error", (e) => {
      console.error("MediaSource error:", e);
      reject(e);
    });
  });
}

function appendNextChunk() {
  if (!sourceBuffer || sourceBuffer.updating) return;

  if (pendingChunks.length > 0) {
    const chunk = pendingChunks.shift()!;
    try {
      sourceBuffer.appendBuffer(chunk);
    } catch (e) {
      console.error("Error appending chunk:", e);
    }
  }
}

function appendAudioChunk(chunk: ArrayBuffer) {
  pendingChunks.push(chunk);
  appendNextChunk();
}

async function startPlayback() {
  if (!audioElement || !audioUnlocked) return;
  try {
    await audioElement.play();
  } catch (e) {
    console.error("Playback failed:", e);
  }
}

function endPlayback(): Promise<void> {
  return new Promise((resolve) => {
    if (!audioElement || !mediaSource) {
      resolve();
      return;
    }

    let resolved = false;
    let timeout: ReturnType<typeof setTimeout>;

    const done = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeout);
      cleanup();
      resolve();
    };

    // Timeout fallback - if nothing works after 30s, just resolve
    timeout = setTimeout(() => {
      if (!resolved) {
        console.warn("Audio playback timeout - forcing completion");
        done();
      }
    }, 30000);

    // Set up ended handler to avoid race condition
    audioElement.onended = done;

    // Also poll for ended state as backup (onended can be unreliable)
    const pollEnded = () => {
      if (resolved) return;
      if (audioElement?.ended) {
        done();
        return;
      }
      setTimeout(pollEnded, 100);
    };

    // Wait for all chunks to be appended, then end stream
    const waitForChunks = () => {
      if (pendingChunks.length === 0 && !sourceBuffer?.updating) {
        if (mediaSource?.readyState === "open") {
          try {
            mediaSource.endOfStream();
          } catch (e) {
            console.error("Error ending stream:", e);
          }
        }

        // Check if already ended
        if (audioElement?.ended) {
          done();
          return;
        }

        // Start polling as backup
        pollEnded();
      } else {
        setTimeout(waitForChunks, 50);
      }
    };
    waitForChunks();
  });
}

function cleanup() {
  if (audioElement) {
    audioElement.pause();
    audioElement.onended = null;
    if (audioElement.src) {
      URL.revokeObjectURL(audioElement.src);
    }
  }
  mediaSource = null;
  sourceBuffer = null;
  audioElement = null;
  pendingChunks = [];
}

// WebSocket connection
let pingInterval: ReturnType<typeof setInterval> | null = null;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    statusEl.textContent = "Connected";
    statusEl.className = "status connected";
    if (audioUnlocked) {
      instructionEl.textContent = "Ready for instructions...";
    }

    // Keep connection alive with pings every 30s
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);
  };

  ws.onclose = () => {
    statusEl.textContent = "Disconnected";
    statusEl.className = "status disconnected";
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    // Reconnect after 2 seconds
    setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    statusEl.textContent = "Connection error";
    statusEl.className = "status disconnected";
  };

  ws.onmessage = async (event) => {
    // Handle binary audio chunks
    if (event.data instanceof Blob) {
      const buffer = await event.data.arrayBuffer();
      appendAudioChunk(buffer);
      return;
    }

    // Handle JSON messages
    try {
      const msg: ServerMessage = JSON.parse(event.data);

      if (msg.type === "audio-start") {
        currentId = msg.id;
        instructionEl.textContent = msg.text;
        instructionEl.classList.add("speaking");

        await initMediaSource();
        // Start playback when we have enough data (not timer-based)
        if (audioElement) {
          audioElement.oncanplay = () => {
            startPlayback();
            if (audioElement) audioElement.oncanplay = null;
          };
        }
      }

      if (msg.type === "audio-end") {
        await endPlayback();
        instructionEl.classList.remove("speaking");

        // Send completion acknowledgment
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "complete", id: currentId }));
        }
        currentId = null;
      }
    } catch (error) {
      console.error("Message parse error:", error);
    }
  };
}

// Reconnect faster when tab becomes visible
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    // If disconnected, reconnect immediately
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connect();
    }
  }
});

// Start connection
connect();
