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
const reconnectOverlay = document.getElementById(
  "reconnect-overlay"
);
const reconnectButton = document.getElementById(
  "reconnect-button"
);
const reconnectMessageEl = document.getElementById(
  "reconnect-message"
);
const onboardingOverlay = document.getElementById(
  "onboarding-overlay"
);
const onboardingClose = document.getElementById(
  "onboarding-close"
);
const onboardingDismiss = document.getElementById(
  "onboarding-dismiss"
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
const MIN_BUFFER_SECONDS = 0.3;
const MIN_BUFFER_SIZE = SAMPLE_RATE * MIN_BUFFER_SECONDS;
const FRAME_HEADER_SIZE = 5;
const FRAME_TYPE_DATA = 1;
const FRAME_TYPE_FLUSH = 2;

// State
let sessionId = null;
let eventSource = null;
let isProcessing = false;
let wakeLock = null;

// Network resilience state
let isOnline = navigator.onLine;
let sseReconnectAttempts = 0;
let audioReconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 1000;
const ONBOARDING_COOKIE = "guru_onboarding_dismissed";
let lastSsePingAt = 0;
let sseHealthInterval = null;
let lastAudioFrameAt = 0;
let audioExpectTimeout = null;
let reconnectInProgress = false;

function getSelectedModel() {
  const select = document.getElementById("model-selector");
  return select ? select.value : "opus";
}

function getSelectedVoice() {
  const select = document.getElementById("voice-selector");
  return select ? select.value : "marin";
}

// Calculate exponential backoff with jitter
function getReconnectDelay(attempts) {
  const delay = Math.min(
    BASE_RECONNECT_DELAY * Math.pow(2, attempts),
    30000
  );
  const jitter = delay * 0.2 * Math.random();
  return delay + jitter;
}

function getCookie(name) {
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [key, ...rest] = cookie.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

function setCookie(name, value, maxAgeSeconds) {
  const parts = [
    `${name}=${value}`,
    `max-age=${maxAgeSeconds}`,
    "path=/",
    "samesite=lax",
  ];
  document.cookie = parts.join("; ");
}

function showOnboarding() {
  if (!onboardingOverlay) return;
  onboardingOverlay.classList.add("active");
  onboardingOverlay.setAttribute("aria-hidden", "false");
}

function hideOnboarding() {
  if (!onboardingOverlay) return;
  onboardingOverlay.classList.remove("active");
  onboardingOverlay.setAttribute("aria-hidden", "true");
}

function dismissOnboarding() {
  if (onboardingDismiss?.checked) {
    setCookie(ONBOARDING_COOKIE, "1", 365 * 24 * 60 * 60);
  }
  hideOnboarding();
}

function showReconnectOverlay(
  message = "Audio paused or connection dropped."
) {
  if (!reconnectOverlay) return;
  if (reconnectMessageEl) {
    reconnectMessageEl.textContent = message;
  }
  reconnectOverlay.classList.add("active");
  reconnectOverlay.setAttribute("aria-hidden", "false");
}

function hideReconnectOverlay() {
  if (!reconnectOverlay) return;
  reconnectOverlay.classList.remove("active");
  reconnectOverlay.setAttribute("aria-hidden", "true");
}

function startSseHealthCheck() {
  if (sseHealthInterval) return;
  sseHealthInterval = setInterval(() => {
    if (!sessionId || !eventSource || !lastSsePingAt) return;
    const age = Date.now() - lastSsePingAt;
    if (age < 45000) return;

    eventSource.close();
    eventSource = null;
    if (isOnline) {
      sseReconnectAttempts = 0;
      connectSSE();
    }
  }, 10000);
}

// Recover session when server returns 404 (session not found)
async function recoverSession() {
  console.log("Session not found, recovering...");

  // Close existing connections
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (audioFetchController) {
    audioFetchController.abort();
    audioFetchController = null;
  }

  // Reset state
  sessionId = null;
  sseReconnectAttempts = 0;
  audioReconnectAttempts = 0;

  // Create new session
  await init();
}

// Stream timer state
let streamStartTime = null;
let streamTimerInterval = null;

// Web Audio API state
let audioContext = null;
let nextStartTime = 0;
let isAudioUnlocked = false;
let audioFetchController = null;
let pcmBuffer = new Uint8Array(0); // Buffer for incomplete samples
let frameBuffer = new Uint8Array(0); // Buffer for framed audio parsing

// Initialize AudioContext (but don't unlock yet - needs user gesture)
function initAudioContext() {
  if (audioContext && audioContext.state !== "closed") return;

  audioContext = new (
    window.AudioContext || window.webkitAudioContext
  )({
    sampleRate: SAMPLE_RATE,
  });
  isAudioUnlocked = false;
  nextStartTime = 0;

  audioContext.addEventListener("statechange", () => {
    if (audioContext.state === "running") {
      hideReconnectOverlay();
      return;
    }

    if (
      audioContext.state === "suspended" &&
      document.visibilityState === "visible" &&
      isProcessing
    ) {
      showReconnectOverlay();
    }
  });
}

// Unlock AudioContext - must be called from user gesture
async function unlockAudioContext() {
  if (isAudioUnlocked && audioContext?.state === "running") {
    return true;
  }

  initAudioContext();

  try {
    if (audioContext.state === "suspended") {
      await audioContext.resume();
    }
  } catch (error) {
    showReconnectOverlay();
    return false;
  }

  // Play a tiny silent buffer to fully unlock on iOS
  try {
    const silentBuffer = audioContext.createBuffer(
      1,
      1,
      SAMPLE_RATE
    );
    const source = audioContext.createBufferSource();
    source.buffer = silentBuffer;
    source.connect(audioContext.destination);
    source.start();
  } catch (error) {
    showReconnectOverlay();
    return false;
  }

  if (audioContext.state !== "running") {
    showReconnectOverlay();
    return false;
  }

  isAudioUnlocked = true;
  nextStartTime = audioContext.currentTime;
  return true;
}

async function tryResumeAudioContext() {
  if (!audioContext || !isAudioUnlocked) return false;

  if (audioContext.state === "suspended") {
    try {
      await audioContext.resume();
    } catch (error) {
      // Resume may fail without user gesture on iOS.
    }
  }

  if (audioContext.state !== "running") {
    if (document.visibilityState === "visible" && isProcessing) {
      showReconnectOverlay();
    }
    return false;
  }

  return true;
}

function playGong(audioContext) {
  if (!audioContext) return;

  const now = audioContext.currentTime;
  const fundamental = 110;

  // Inharmonic ratios from Bessel function modes (circular plate acoustics)
  const partials = [
    { ratio: 1.0, gain: 0.7, decay: 12.0 },
    { ratio: 2.71, gain: 0.35, decay: 8.4 },
    { ratio: 5.14, gain: 0.15, decay: 5.9 },
    { ratio: 8.19, gain: 0.06, decay: 4.1 },
    { ratio: 11.87, gain: 0.02, decay: 2.9 },
  ];

  const beatFreq = 0.5;
  const beatDepth = 0.15;
  const attackTime = 0.003;
  const bloomAmount = 0.15;
  const bloomPeak = 0.4;

  // Master chain
  const filter = audioContext.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 800;
  filter.Q.value = 1.5;

  const master = audioContext.createGain();
  master.gain.value = 0.4;
  filter.connect(master);
  master.connect(audioContext.destination);

  // Strike transient
  const noiseBuffer = audioContext.createBuffer(
    1,
    audioContext.sampleRate * 0.015,
    audioContext.sampleRate
  );
  const noiseData = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) {
    noiseData[i] =
      (Math.random() * 2 - 1) *
      Math.exp(-i / (noiseData.length * 0.3));
  }
  const noiseSource = audioContext.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  const noiseGain = audioContext.createGain();
  noiseGain.gain.value = 0.06;
  const noiseFilter = audioContext.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.value = fundamental * 3;
  noiseFilter.Q.value = 2;
  noiseSource.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(filter);
  noiseSource.start(now);

  // Partials with beating
  partials.forEach(({ ratio, gain, decay }) => {
    const freq = fundamental * ratio;
    const detunes = [0, beatFreq, -beatFreq];
    const detuneGains = [
      1 - beatDepth,
      beatDepth / 2,
      beatDepth / 2,
    ];

    detunes.forEach((detune, j) => {
      const osc = audioContext.createOscillator();
      const oscGain = audioContext.createGain();

      osc.type = "sine";
      osc.frequency.value = freq + detune;

      const peakGain = gain * detuneGains[j];

      oscGain.gain.setValueAtTime(0.0001, now);
      oscGain.gain.exponentialRampToValueAtTime(
        peakGain,
        now + attackTime
      );

      // Bloom on main tone only
      if (j === 0) {
        oscGain.gain.exponentialRampToValueAtTime(
          peakGain * (1 - bloomAmount),
          now + attackTime + 0.1
        );
        oscGain.gain.exponentialRampToValueAtTime(
          peakGain,
          now + attackTime + bloomPeak
        );
      }
      oscGain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + decay
      );

      osc.connect(oscGain);
      oscGain.connect(filter);
      osc.start(now);
      osc.stop(now + decay + 0.1);
    });
  });
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
  if (audioContext.state !== "running") {
    if (document.visibilityState === "visible" && isProcessing) {
      showReconnectOverlay();
    }
    return;
  }

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

function processAudioFrames(chunk) {
  if (!chunk || chunk.length === 0) return;

  lastAudioFrameAt = Date.now();
  if (reconnectOverlay?.classList.contains("active")) {
    hideReconnectOverlay();
  }

  const newBuffer = new Uint8Array(
    frameBuffer.length + chunk.length
  );
  newBuffer.set(frameBuffer);
  newBuffer.set(chunk, frameBuffer.length);
  frameBuffer = newBuffer;

  let offset = 0;
  while (frameBuffer.length - offset >= FRAME_HEADER_SIZE) {
    const view = new DataView(
      frameBuffer.buffer,
      frameBuffer.byteOffset + offset,
      FRAME_HEADER_SIZE
    );
    const type = view.getUint8(0);
    const length = view.getUint32(1, false);
    const frameSize = FRAME_HEADER_SIZE + length;

    if (frameBuffer.length - offset < frameSize) break;

    if (type === FRAME_TYPE_DATA) {
      const payload = frameBuffer.subarray(
        offset + FRAME_HEADER_SIZE,
        offset + frameSize
      );
      if (payload.length > 0) {
        scheduleAudioBuffer(payload);
      }
    } else if (type === FRAME_TYPE_FLUSH) {
      scheduleAudioBuffer(new Uint8Array(0), true);
    } else {
      console.warn("Unknown audio frame type:", type);
    }

    offset += frameSize;
  }

  if (offset > 0) {
    frameBuffer = frameBuffer.subarray(offset);
  }
}

function scheduleAudioExpectCheck() {
  if (audioExpectTimeout) {
    clearTimeout(audioExpectTimeout);
  }
  const checkFrom = Date.now();
  audioExpectTimeout = setTimeout(() => {
    if (!isProcessing || !isOnline) return;
    if (!sessionId) return;

    if (!audioFetchController) {
      startAudioStream();
      return;
    }

    if (lastAudioFrameAt < checkFrom) {
      showReconnectOverlay();
    }
  }, 2500);
}

// Fetch and play audio for the current session
async function startAudioStream() {
  if (!sessionId || !isAudioUnlocked) return;
  const resumed = await tryResumeAudioContext();
  if (!resumed) return;

  // Cancel any existing fetch
  if (audioFetchController) {
    audioFetchController.abort();
  }

  // Reset buffers for new audio stream
  pcmBuffer = new Uint8Array(0);
  frameBuffer = new Uint8Array(0);
  lastAudioFrameAt = 0;

  const controller = new AbortController();
  audioFetchController = controller;

  try {
    const response = await fetch(`/api/audio/${sessionId}`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      if (response.status === 404) {
        recoverSession();
      }
      return;
    }

    if (!response.body) {
      showReconnectOverlay();
      return;
    }

    audioReconnectAttempts = 0; // Reset on successful connection
    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      processAudioFrames(value);
    }

    if (frameBuffer.length > 0) {
      console.warn("Dropping incomplete audio frame");
      frameBuffer = new Uint8Array(0);
    }

    // Flush any remaining buffered audio
    if (pcmBuffer.length > 0) {
      scheduleAudioBuffer(new Uint8Array(0), true);
    }
  } catch (error) {
    if (error.name === "AbortError") return;

    // Don't retry while offline
    if (!isOnline) return;

    audioReconnectAttempts++;

    if (audioReconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      console.error(
        "Audio stream unavailable after max retries"
      );
      showReconnectOverlay();
      return;
    }

    // Exponential backoff reconnection
    const delay = getReconnectDelay(audioReconnectAttempts);
    setTimeout(() => {
      if (
        sessionId &&
        isAudioUnlocked &&
        isOnline &&
        !audioFetchController
      ) {
        startAudioStream();
      }
    }, delay);
  } finally {
    if (audioFetchController === controller) {
      audioFetchController = null;
    }
  }
}

// Initialize session
async function init() {
  try {
    connectionIndicator.className =
      "connection-indicator disconnected";
    hideReconnectOverlay();
    if (audioExpectTimeout) {
      clearTimeout(audioExpectTimeout);
      audioExpectTimeout = null;
    }
    if (sseHealthInterval) {
      clearInterval(sseHealthInterval);
      sseHealthInterval = null;
    }
    lastSsePingAt = 0;

    // Reset audio state for new session
    if (audioFetchController) {
      audioFetchController.abort();
      audioFetchController = null;
    }
    isAudioUnlocked = false;
    pcmBuffer = new Uint8Array(0);
    frameBuffer = new Uint8Array(0);

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

    // Handle replay query param
    const urlParams = new URLSearchParams(
      window.location.search
    );
    const replaySessionId = urlParams.get("replay");
    if (replaySessionId) {
      try {
        const res = await fetch(
          `/api/inspect/sessions/${replaySessionId}`
        );
        if (res.ok) {
          const { session } = await res.json();
          let prompt = session.initial_prompt || "";

          // Determine living instruction state
          let hasLivingInstruction = false;
          if (session.living_instruction != null) {
            // Use stored value if available
            hasLivingInstruction =
              session.living_instruction === 1;
          } else {
            // Infer from prompt for historical sessions
            hasLivingInstruction = prompt.endsWith(
              "\n\nLiving instruction."
            );
          }

          // Strip living instruction suffix from prompt
          if (prompt.endsWith("\n\nLiving instruction.")) {
            prompt = prompt.slice(0, -21);
          }

          // Pre-fill the form
          messageInput.value = prompt;
          livingInstructionToggle.checked = hasLivingInstruction;

          // Set model selector
          const modelSelector =
            document.getElementById("model-selector");
          if (modelSelector && session.model) {
            const modelMap = {
              "claude-opus-4-5": "opus",
              "claude-sonnet-4-5": "sonnet",
              "claude-haiku-4-5": "haiku",
            };
            const selectValue =
              modelMap[session.model] || "opus";
            modelSelector.value = selectValue;
          }
        }
      } catch (e) {
        console.error("Failed to load replay session:", e);
      }
    }
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
    sseReconnectAttempts = 0; // Reset on successful connection
    lastSsePingAt = Date.now();
    startSseHealthCheck();
  });

  eventSource.addEventListener("ping", () => {
    lastSsePingAt = Date.now();
  });

  eventSource.addEventListener("processing", (event) => {
    isProcessing = true;
    sendBtn.textContent = "Stop";
    sendBtn.disabled = false;
    startStreamTimer();
    startStatus("Scaffolding");
    playGong(audioContext);
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

  eventSource.addEventListener("speak", (event) => {
    const data = JSON.parse(event.data);
    stopStatus();
    showCue(data.text);
    scheduleAudioExpectCheck();
  });

  eventSource.addEventListener("breathe_start", (event) => {
    const data = JSON.parse(event.data);
    startCountdown("Breathe", data.duration);
  });

  eventSource.addEventListener("done", () => {
    isProcessing = false;
    sendBtn.textContent = "Begin";
    sendBtn.disabled = false;
    messageInput.value = "";
    stopStreamTimer();
    stopStatus();
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
    stopStatus();
  });

  eventSource.onerror = () => {
    connectionIndicator.className =
      "connection-indicator disconnected";

    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    lastSsePingAt = 0;

    // Don't retry while offline - network listener will reconnect
    if (!isOnline) {
      return;
    }

    sseReconnectAttempts++;

    if (sseReconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      // Session may be gone, recover with a new one
      recoverSession();
      return;
    }

    // Exponential backoff reconnection
    const delay = getReconnectDelay(sseReconnectAttempts);
    setTimeout(() => {
      if (sessionId && isOnline) {
        connectSSE();
      }
    }, delay);
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

// Unified status display for thinking/breathe
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
  // Only create elements if they don't exist (preserves animation)
  let dot = pauseStatusEl.querySelector(".status-dot");
  let labelSpan = pauseStatusEl.querySelector(".status-label");
  if (!dot) {
    dot = document.createElement("span");
    dot.className = "status-dot";
    pauseStatusEl.appendChild(dot);
  }
  if (!labelSpan) {
    labelSpan = document.createElement("span");
    labelSpan.className = "status-label";
    pauseStatusEl.appendChild(labelSpan);
  }
  labelSpan.textContent = label;
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
      body: JSON.stringify({
        message,
        model: getSelectedModel(),
        voice: getSelectedVoice(),
        timezone:
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        livingInstruction: livingInstructionToggle.checked,
      }),
    });

    if (!response.ok) {
      if (response.status === 404) {
        await recoverSession();
        return;
      }
      const error = await response.json();
      throw new Error(error.error || "Failed to send message");
    }
  } catch (error) {
    showError(`Failed to send: ${error.message}`);
    isProcessing = false;
    sendBtn.disabled = false;
  }
}

async function attemptReconnect() {
  if (reconnectInProgress) return;
  reconnectInProgress = true;

  try {
    hideReconnectOverlay();

    if (!sessionId) {
      await init();
    }

    const unlocked = await unlockAudioContext();
    if (!unlocked) return;

    if (isProcessing && !wakeLock) {
      requestWakeLock();
    }

    if (
      sessionId &&
      (!eventSource ||
        eventSource.readyState === EventSource.CLOSED)
    ) {
      sseReconnectAttempts = 0;
      connectSSE();
    }

    if (sessionId) {
      audioReconnectAttempts = 0;
      startAudioStream();
    }
  } finally {
    reconnectInProgress = false;
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
  hideReconnectOverlay();
  if (audioExpectTimeout) {
    clearTimeout(audioExpectTimeout);
    audioExpectTimeout = null;
  }
  if (sseHealthInterval) {
    clearInterval(sseHealthInterval);
    sseHealthInterval = null;
  }
  init(); // Start a new session
}

// Event listeners
if (reconnectButton) {
  reconnectButton.addEventListener("click", attemptReconnect);
}
if (reconnectOverlay) {
  reconnectOverlay.addEventListener("click", (event) => {
    if (event.target === reconnectOverlay) {
      attemptReconnect();
    }
  });
}
if (onboardingClose) {
  onboardingClose.addEventListener("click", dismissOnboarding);
}
if (onboardingOverlay) {
  onboardingOverlay.addEventListener("click", (event) => {
    if (event.target === onboardingOverlay) {
      dismissOnboarding();
    }
  });
}

chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (isProcessing) {
    stopSession();
  } else {
    if (!messageInput.value.trim()) return;

    // Unlock AudioContext on user gesture (iOS requirement)
    // https://webkit.org/blog/6784/new-video-policies-for-ios/
    const unlocked = await unlockAudioContext();
    if (!unlocked) {
      return;
    }

    // Request wake lock to keep screen on during streaming
    await requestWakeLock();

    // Start audio stream if not already running
    if (!audioFetchController) {
      startAudioStream();
    }

    let message = messageInput.value;
    if (livingInstructionToggle.checked) {
      message += "\n\nLiving instruction.";
    }
    sendMessage(message);
    showCue(
      "Please wait. guru is looking ahead to ensure the session goes smoothly."
    );
  }
});

// Resume AudioContext and wake lock when page becomes visible (e.g., phone unlocked)
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState === "visible") {
    // Resume AudioContext if needed
    if (audioContext && isAudioUnlocked) {
      await tryResumeAudioContext();
    }

    // Re-acquire wake lock if stream is still active
    if (isProcessing && !wakeLock) {
      requestWakeLock();
    }

    // Check SSE connection health after becoming visible
    if (sessionId && eventSource) {
      if (eventSource.readyState === EventSource.CLOSED) {
        eventSource = null;
        sseReconnectAttempts = 0;
        connectSSE();
      }
    }

    // Restart audio stream if it died while backgrounded
    if (sessionId && isAudioUnlocked && !audioFetchController) {
      audioReconnectAttempts = 0;
      startAudioStream();
    }
  }
});

// Network change detection
window.addEventListener("online", () => {
  isOnline = true;
  connectionIndicator.className =
    "connection-indicator disconnected";

  // Reconnect SSE on network restoration
  if (sessionId && !eventSource) {
    sseReconnectAttempts = 0;
    connectSSE();
  }

  // Restart audio stream if it was active
  if (sessionId && isAudioUnlocked && !audioFetchController) {
    audioReconnectAttempts = 0;
    startAudioStream();
  }
});

window.addEventListener("offline", () => {
  isOnline = false;
  connectionIndicator.className = "connection-indicator error";

  // Proactively close stale connections
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  lastSsePingAt = 0;
  if (audioFetchController) {
    audioFetchController.abort();
    audioFetchController = null;
  }
});

// Auto-resize textarea
function autoResizeTextarea() {
  messageInput.style.height = "auto";
  messageInput.style.height = messageInput.scrollHeight + "px";
}
messageInput.addEventListener("input", autoResizeTextarea);

// Submit on Cmd+Enter
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.metaKey) {
    e.preventDefault();
    chatForm.requestSubmit();
  }
});

// Render example chiclets
async function renderExampleChiclets() {
  try {
    // Add clear button
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "chiclet chiclet-clear";
    clearBtn.addEventListener("click", () => {
      messageInput.value = "";
      autoResizeTextarea();
      messageInput.focus();
      // Clear replay param if present
      if (window.location.search) {
        window.history.replaceState({}, "", "/");
      }
    });
    exampleChicletsEl.appendChild(clearBtn);

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
  } catch (error) {
    console.error("Failed to load examples:", error);
  }
}

// Initialize on load
renderExampleChiclets();
if (!getCookie(ONBOARDING_COOKIE)) {
  showOnboarding();
}
init();
