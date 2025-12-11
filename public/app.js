// DOM elements
const cueDisplayEl = document.getElementById("cue-display");
const statusEl = document.getElementById("status");
const audioEl = document.getElementById("audio-player");
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const nowPlayingEl = document.getElementById("now-playing");

// State
let sessionId = null;
let eventSource = null;
let audioStarted = false;
let isProcessing = false;

// Send logs to server
function log(message, level = "info") {
  console[level === "error" ? "error" : "log"](message);
  fetch("/api/log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ level, message }),
  }).catch(() => {});
}

// Initialize session
async function init() {
  try {
    statusEl.textContent = "Connecting...";
    statusEl.className = "status disconnected";

    // Create new session
    const response = await fetch("/api/session", { method: "POST" });
    if (!response.ok) throw new Error("Failed to create session");

    const data = await response.json();
    sessionId = data.sessionId;
    console.log("Session created:", sessionId);

    // Connect audio stream
    audioEl.src = `/api/audio/${sessionId}`;

    // Connect SSE for chat events
    connectSSE();

  } catch (error) {
    console.error("Init error:", error);
    statusEl.textContent = "Error";
    statusEl.className = "status error";
    showCue("Failed to connect. Please refresh the page.");
  }
}

// Connect to Server-Sent Events
function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }

  eventSource = new EventSource(`/api/chat/events/${sessionId}`);

  eventSource.addEventListener("connected", () => {
    statusEl.textContent = "Connected";
    statusEl.className = "status connected";
  });

  eventSource.addEventListener("processing", (event) => {
    isProcessing = true;
    sendBtn.textContent = "Stop";
    sendBtn.disabled = false;
  });

  eventSource.addEventListener("text", (event) => {
    const data = JSON.parse(event.data);
    if (data.content) {
      showCue(data.content);
    }
  });

  eventSource.addEventListener("cue", (event) => {
    const data = JSON.parse(event.data);
    showCue(data.text);
  });

  eventSource.addEventListener("done", () => {
    isProcessing = false;
    sendBtn.textContent = "Begin";
    sendBtn.disabled = false;
  });

  eventSource.addEventListener("error", (event) => {
    if (event.data) {
      const data = JSON.parse(event.data);
      showCue(data.content || "An error occurred");
    }
    isProcessing = false;
    sendBtn.textContent = "Begin";
    sendBtn.disabled = false;
  });

  eventSource.onerror = () => {
    statusEl.textContent = "Disconnected";
    statusEl.className = "status disconnected";

    // Attempt reconnection after a delay
    setTimeout(() => {
      if (sessionId) {
        console.log("Attempting SSE reconnection...");
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

// Send message
async function sendMessage(message) {
  if (!message.trim() || !sessionId || isProcessing) return;

  messageInput.value = "";
  cueDisplayEl.innerHTML = "";

  // Start audio stream on first message (user has interacted)
  if (!audioStarted) {
    audioStarted = true;
    log("[audio] Starting audio stream...");
    audioEl.play().then(() => {
      log("[audio] Playing");
    }).catch((err) => {
      log("[audio] Play failed: " + err, "error");
    });
  }

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
    showCue(`Failed to send: ${error.message}`);
    isProcessing = false;
    sendBtn.disabled = false;
  }
}

// Stop the current session
function stopSession() {
  if (eventSource) {
    eventSource.close();
  }
  audioEl.pause();
  audioEl.src = "";
  isProcessing = false;
  sendBtn.textContent = "Begin";
  sendBtn.disabled = false;
  cueDisplayEl.innerHTML = "";
  connectSSE();
}

// Event listeners
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();

  if (isProcessing) {
    stopSession();
  } else {
    sendMessage(messageInput.value);
  }
});

// Debug audio element state
audioEl.addEventListener("waiting", () => log("[audio] waiting - buffer empty"));
audioEl.addEventListener("stalled", () => log("[audio] stalled - fetching data"));
audioEl.addEventListener("playing", () => log("[audio] playing"));
audioEl.addEventListener("canplay", () => log("[audio] canplay - ready to play"));

// When audio ends or pauses, reconnect for next cue
audioEl.addEventListener("pause", () => {
  log("[audio] paused - reconnecting for next cue");
  if (audioStarted && sessionId) {
    // Small delay to avoid hammering the server
    setTimeout(() => {
      audioEl.src = `/api/audio/${sessionId}`;
      audioEl.play().catch(() => {});
    }, 100);
  }
});
audioEl.addEventListener("progress", () => {
  const buffered = audioEl.buffered;
  if (buffered.length > 0) {
    log(`[audio] progress - buffered: ${buffered.end(buffered.length - 1).toFixed(1)}s, current: ${audioEl.currentTime.toFixed(1)}s`);
  }
});

// Handle audio errors - reconnect if connection lost
audioEl.addEventListener("error", () => {
  const err = audioEl.error;
  const errorMsg = err ? `code=${err.code} ${err.message || ""}` : "unknown";
  log("[audio] error: " + errorMsg, "error");
  if (audioStarted && sessionId) {
    nowPlayingEl.textContent = "Audio connection lost - reconnecting...";
    setTimeout(() => {
      if (sessionId) {
        audioEl.src = `/api/audio/${sessionId}`;
        audioEl.play().catch(() => {});
      }
    }, 2000);
  }
});

// Initialize on load
init();
