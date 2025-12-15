// DOM elements
const cueDisplayEl = document.getElementById("cue-display");
const connectionIndicator = document.getElementById(
  "connection-indicator"
);
const streamTimerEl = document.getElementById("stream-timer");
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const exampleChicletsEl = document.getElementById(
  "example-chiclets"
);
const livingInstructionToggle = document.getElementById(
  "living-instructions-toggle"
);
const thinkingTraceEl =
  document.getElementById("thinking-trace");
const thinkingContentEl = document.getElementById(
  "thinking-content"
);

// Track if user is following the thinking trace (auto-scroll)
let thinkingFollowing = true;
thinkingContentEl.addEventListener("scroll", () => {
  const atBottom =
    thinkingContentEl.scrollHeight -
      thinkingContentEl.scrollTop <=
    thinkingContentEl.clientHeight + 10;
  thinkingFollowing = atBottom;
});

// Audio constants - OpenAI PCM is 24kHz, 16-bit signed, little-endian, mono
const SAMPLE_RATE = 24000;
const MIN_BUFFER_SIZE = SAMPLE_RATE * 0.35;

// State
let sessionId = null;
let eventSource = null;
let isProcessing = false;
let wakeLock = null;

// Stream timer state
let streamStartTime = null;
let streamTimerInterval = null;

// Web Audio API state
let audioContext = null;
let nextStartTime = 0;
let isAudioUnlocked = false;
let audioFetchController = null;
let pcmBuffer = new Uint8Array(0); // Buffer for incomplete samples

// Initialize AudioContext (but don't unlock yet - needs user gesture)
function initAudioContext() {
  if (!audioContext) {
    audioContext = new (
      window.AudioContext || window.webkitAudioContext
    )({
      sampleRate: SAMPLE_RATE,
    });
  }
}

// Unlock AudioContext - must be called from user gesture
async function unlockAudioContext() {
  if (isAudioUnlocked) return;

  initAudioContext();

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  // Play a tiny silent buffer to fully unlock on iOS
  const silentBuffer = audioContext.createBuffer(
    1,
    1,
    SAMPLE_RATE
  );
  const source = audioContext.createBufferSource();
  source.buffer = silentBuffer;
  source.connect(audioContext.destination);
  source.start();

  isAudioUnlocked = true;
  nextStartTime = audioContext.currentTime;
}

// Format duration as mm:ss
function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// Start stream timer
function startStreamTimer() {
  streamStartTime = Date.now();
  streamTimerEl.textContent = "0:00";
  streamTimerEl.classList.add("active");

  streamTimerInterval = setInterval(() => {
    const elapsed = Date.now() - streamStartTime;
    streamTimerEl.textContent = formatDuration(elapsed);
  }, 1000);
}

// Stop stream timer
function stopStreamTimer() {
  if (streamTimerInterval) {
    clearInterval(streamTimerInterval);
    streamTimerInterval = null;
  }
  streamTimerEl.classList.remove("active");
  streamStartTime = null;
}

// Request wake lock to prevent screen from sleeping during audio playback
async function requestWakeLock() {
  if (wakeLock || !("wakeLock" in navigator)) return;

  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch (err) {
    // Wake lock request failed (e.g., low battery, unsupported)
    wakeLock = null;
  }
}

// Release wake lock when stream stops
async function releaseWakeLock() {
  if (wakeLock) {
    try {
      await wakeLock.release();
    } catch (err) {
      // Ignore release errors
    }
    wakeLock = null;
  }
}

// Convert Int16 PCM to Float32 for Web Audio API
function int16ToFloat32(int16Array) {
  const float32Array = new Float32Array(int16Array.length);
  for (let i = 0; i < int16Array.length; i++) {
    float32Array[i] = int16Array[i] / 32768;
  }
  return float32Array;
}

// Schedule PCM audio buffer for playback
// flush=true forces scheduling even if buffer is small (used at end of stream)
function scheduleAudioBuffer(pcmData, flush = false) {
  if (!audioContext || !isAudioUnlocked) return;

  // Append new data to buffer
  const newBuffer = new Uint8Array(
    pcmBuffer.length + pcmData.length
  );
  newBuffer.set(pcmBuffer);
  newBuffer.set(pcmData, pcmBuffer.length);

  // Only process complete samples (2 bytes each for 16-bit PCM)
  const completeSamples = Math.floor(newBuffer.length / 2);
  if (completeSamples === 0) {
    pcmBuffer = newBuffer;
    return;
  }

  // Wait for minimum buffer size unless flushing
  if (!flush && completeSamples < MIN_BUFFER_SIZE) {
    pcmBuffer = newBuffer;
    return;
  }

  const bytesToProcess = completeSamples * 2;
  const dataToProcess = newBuffer.slice(0, bytesToProcess);

  // Keep any remaining odd byte for next chunk
  pcmBuffer = newBuffer.slice(bytesToProcess);

  // Convert to Int16Array - need to copy to aligned buffer
  const alignedBuffer = new ArrayBuffer(dataToProcess.length);
  new Uint8Array(alignedBuffer).set(dataToProcess);
  const int16Data = new Int16Array(alignedBuffer);
  const float32Data = int16ToFloat32(int16Data);

  // Create audio buffer
  const audioBuffer = audioContext.createBuffer(
    1,
    float32Data.length,
    SAMPLE_RATE
  );
  audioBuffer.getChannelData(0).set(float32Data);

  // Schedule playback
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(audioContext.destination);

  // Ensure we don't schedule in the past
  const startTime = Math.max(
    nextStartTime,
    audioContext.currentTime
  );
  source.start(startTime);

  // Update next start time for seamless playback
  nextStartTime = startTime + audioBuffer.duration;
}

// Fetch and play audio for the current session
async function startAudioStream() {
  if (!sessionId || !isAudioUnlocked) return;

  // Cancel any existing fetch
  if (audioFetchController) {
    audioFetchController.abort();
  }

  // Reset buffer for new audio stream
  pcmBuffer = new Uint8Array(0);

  audioFetchController = new AbortController();

  try {
    const response = await fetch(`/api/audio/${sessionId}`, {
      signal: audioFetchController.signal,
    });

    if (!response.ok) return;

    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Schedule this chunk for playback
      if (value && value.length > 0) {
        scheduleAudioBuffer(value);
      }
    }

    // Flush any remaining buffered audio
    if (pcmBuffer.length > 0) {
      scheduleAudioBuffer(new Uint8Array(0), true);
    }

    // Audio stream ended, start a new one for the next cue
    // Small delay to avoid hammering the server
    setTimeout(() => {
      if (sessionId && isAudioUnlocked) {
        startAudioStream();
      }
    }, 100);
  } catch (error) {
    if (error.name === "AbortError") return;

    // Reconnect on error
    setTimeout(() => {
      if (sessionId && isAudioUnlocked) {
        startAudioStream();
      }
    }, 2000);
  }
}

// Initialize session
async function init() {
  try {
    connectionIndicator.className =
      "connection-indicator disconnected";

    // Create new session
    const response = await fetch("/api/session", {
      method: "POST",
    });
    if (!response.ok)
      throw new Error("Failed to create session");

    const data = await response.json();
    sessionId = data.sessionId;

    // Connect SSE for chat events
    connectSSE();
  } catch (error) {
    console.error("Init error:", error);
    connectionIndicator.className = "connection-indicator error";
    showError("Failed to connect. Please refresh the page.");
  }
}

// Connect to Server-Sent Events
function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`/api/chat/events/${sessionId}`);

  eventSource.addEventListener("connected", () => {
    connectionIndicator.className =
      "connection-indicator connected";
  });

  eventSource.addEventListener("processing", (event) => {
    isProcessing = true;
    sendBtn.textContent = "Stop";
    sendBtn.disabled = false;
    startStreamTimer();
  });

  eventSource.addEventListener("thinking_start", () => {
    if (thinkingContentEl.textContent) {
      thinkingContentEl.textContent += "\n\n";
    }
    thinkingTraceEl.classList.add("active");
    startStatus("Thinking");
  });

  eventSource.addEventListener("thinking", (event) => {
    const data = JSON.parse(event.data);
    if (data.content) {
      thinkingContentEl.textContent += data.content;

      // Auto-scroll if following and details is open
      if (thinkingFollowing && thinkingTraceEl.open) {
        thinkingContentEl.scrollTop =
          thinkingContentEl.scrollHeight;
      }
    }
  });

  eventSource.addEventListener("thinking_end", () => {
    // Keep content, just add separator for next block
    stopStatus();
  });

  eventSource.addEventListener("skill_start", (event) => {
    const data = JSON.parse(event.data);
    startStatus(`Skill: ${data.skill}`);
  });

  eventSource.addEventListener("text", (event) => {
    const data = JSON.parse(event.data);
    if (data.content) {
      stopStatus();
      showCue(data.content);
    }
  });

  eventSource.addEventListener("cue", (event) => {
    const data = JSON.parse(event.data);
    stopStatus();
    showCue(data.text);
  });

  eventSource.addEventListener("pause_start", (event) => {
    const data = JSON.parse(event.data);
    startCountdown("Pause", data.duration);
  });

  eventSource.addEventListener("done", () => {
    isProcessing = false;
    sendBtn.textContent = "Begin";
    sendBtn.disabled = false;
    messageInput.value = "";
    stopStreamTimer();
    init(); // Start a new session
  });

  eventSource.addEventListener("error", (event) => {
    if (event.data) {
      const data = JSON.parse(event.data);
      const msg = data.content || "An error occurred";
      // Don't show abort as error - it's expected when user stops
      if (!msg.toLowerCase().includes("aborted")) {
        showError(msg);
      }
    }
    isProcessing = false;
    sendBtn.textContent = "Begin";
    sendBtn.disabled = false;
    stopStreamTimer();
  });

  eventSource.onerror = () => {
    connectionIndicator.className =
      "connection-indicator disconnected";

    // Attempt reconnection after a delay
    setTimeout(() => {
      if (sessionId) {
        connectSSE();
      }
    }, 3000);
  };
}

// Display cue in center
function showCue(content) {
  const div = document.createElement("div");
  div.className = "cue";
  div.textContent = content;
  cueDisplayEl.innerHTML = "";
  cueDisplayEl.appendChild(div);
}

// Unified status display for thinking/pause
const pauseStatusEl = document.getElementById("pause-status");
let statusStartTime = null;
let statusInterval = null;
let statusDuration = null; // For countdown mode

// Start elapsed timer (counts up from 0)
function startStatus(label) {
  stopStatus();
  statusStartTime = Date.now();
  statusDuration = null;
  updateStatusDisplay(label);
  statusInterval = setInterval(
    () => updateStatusDisplay(label),
    1000
  );
  pauseStatusEl.classList.add("active");
}

// Start countdown timer (counts down from duration)
function startCountdown(label, duration) {
  stopStatus();
  statusStartTime = Date.now();
  statusDuration = duration;
  updateStatusDisplay(label);
  statusInterval = setInterval(
    () => updateStatusDisplay(label),
    1000
  );
  pauseStatusEl.classList.add("active");
}

function stopStatus() {
  if (statusInterval) {
    clearInterval(statusInterval);
    statusInterval = null;
  }
  statusStartTime = null;
  statusDuration = null;
  pauseStatusEl.innerHTML = "";
  pauseStatusEl.classList.remove("active");
}

function updateStatusDisplay(label) {
  const elapsed = Math.floor(
    (Date.now() - statusStartTime) / 1000
  );
  const display = statusDuration
    ? Math.max(0, statusDuration - elapsed)
    : elapsed;
  // pauseStatusEl.innerHTML = `<span class="status-dot"></span>${label} ${display}s`;
  pauseStatusEl.innerHTML = `<span class="status-dot"></span>${label}`;
}

// Display error in collapsible details
function showError(message) {
  const details = document.createElement("details");
  details.className = "error-details";
  const summary = document.createElement("summary");
  summary.textContent = "Something went wrong";
  const content = document.createElement("p");
  content.textContent = message;
  details.appendChild(summary);
  details.appendChild(content);
  cueDisplayEl.innerHTML = "";
  cueDisplayEl.appendChild(details);
}

// Send message
async function sendMessage(message) {
  if (!message.trim() || !sessionId || isProcessing) return;

  cueDisplayEl.innerHTML = "";
  thinkingContentEl.textContent = "";
  thinkingTraceEl.classList.remove("active");
  thinkingFollowing = true;

  try {
    const response = await fetch(`/api/chat/${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to send message");
    }
  } catch (error) {
    showError(`Failed to send: ${error.message}`);
    isProcessing = false;
    sendBtn.disabled = false;
  }
}

// Stop the current session
function stopSession() {
  if (eventSource) {
    eventSource.close();
  }
  if (audioFetchController) {
    audioFetchController.abort();
    audioFetchController = null;
  }
  releaseWakeLock();
  stopStreamTimer();
  isProcessing = false;
  sendBtn.textContent = "Begin";
  sendBtn.disabled = false;
  cueDisplayEl.innerHTML = "";
  thinkingContentEl.textContent = "";
  thinkingTraceEl.classList.remove("active");
  thinkingFollowing = true;
  stopStatus();
  init(); // Start a new session
}

// Event listeners
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (isProcessing) {
    stopSession();
  } else {
    // Unlock AudioContext on user gesture (iOS requirement)
    // https://webkit.org/blog/6784/new-video-policies-for-ios/
    await unlockAudioContext();

    // Request wake lock to keep screen on during streaming
    await requestWakeLock();

    // Start audio stream if not already running
    if (!audioFetchController) {
      startAudioStream();
    }

    let message = messageInput.value;
    if (livingInstructionToggle.checked) {
      message += "\n\nCue with living instruction.";
    }
    sendMessage(message);
  }
});

// Resume AudioContext and wake lock when page becomes visible (e.g., phone unlocked)
document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    audioContext &&
    isAudioUnlocked
  ) {
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }
    // Re-acquire wake lock if stream is still active
    if (isProcessing && !wakeLock) {
      requestWakeLock();
    }
  }
});

// Auto-resize textarea
function autoResizeTextarea() {
  messageInput.style.height = "auto";
  messageInput.style.height = messageInput.scrollHeight + "px";
}
messageInput.addEventListener("input", autoResizeTextarea);

// Render example chiclets
async function renderExampleChiclets() {
  try {
    const module = await import("./examples.js");
    const examples = module.default;

    examples.forEach((example) => {
      const chiclet = document.createElement("button");
      chiclet.type = "button";
      chiclet.className = "chiclet";
      chiclet.textContent = example.shortName;
      chiclet.addEventListener("click", () => {
        messageInput.value = example.content;
        livingInstructionToggle.checked =
          example.livingInstruction;
        autoResizeTextarea();
        messageInput.focus();
        messageInput.setSelectionRange(0, 0);
      });
      exampleChicletsEl.appendChild(chiclet);
    });

    // Add clear button
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "chiclet chiclet-clear";
    clearBtn.textContent = "✕";
    clearBtn.addEventListener("click", () => {
      messageInput.value = "";
      autoResizeTextarea();
      messageInput.focus();
    });
    exampleChicletsEl.appendChild(clearBtn);
  } catch (error) {
    console.error("Failed to load examples:", error);
  }
}

// Initialize on load
renderExampleChiclets();
init();
