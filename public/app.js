// DOM elements
const messagesEl = document.getElementById("messages");
const statusEl = document.getElementById("status");
const audioEl = document.getElementById("audio-player");
const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");
const playBtn = document.getElementById("play-btn");
const playText = playBtn.querySelector(".play-text");
const nowPlayingEl = document.getElementById("now-playing");

// State
let sessionId = null;
let eventSource = null;
let isPlaying = false;
let isProcessing = false;

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

    // Enable play button
    playBtn.disabled = false;

  } catch (error) {
    console.error("Init error:", error);
    statusEl.textContent = "Error";
    statusEl.className = "status error";
    appendMessage("error", "Failed to connect. Please refresh the page.");
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
    sendBtn.disabled = true;
  });

  eventSource.addEventListener("text", (event) => {
    const data = JSON.parse(event.data);
    if (data.content) {
      appendMessage("assistant", data.content);
    }
  });

  eventSource.addEventListener("cue", (event) => {
    const data = JSON.parse(event.data);
    const pauseInfo = data.pause ? ` (${data.pause}s pause)` : "";
    nowPlayingEl.textContent = `"${data.text}"${pauseInfo}`;

    // Clear after the cue duration + speech time estimate
    const clearDelay = (data.pause || 0) * 1000 + data.text.length * 50 + 2000;
    setTimeout(() => {
      if (nowPlayingEl.textContent.includes(data.text)) {
        nowPlayingEl.textContent = "";
      }
    }, clearDelay);
  });

  eventSource.addEventListener("done", () => {
    isProcessing = false;
    sendBtn.disabled = false;
  });

  eventSource.addEventListener("error", (event) => {
    if (event.data) {
      const data = JSON.parse(event.data);
      appendMessage("error", data.content || "An error occurred");
    }
    isProcessing = false;
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

// Append message to chat
function appendMessage(role, content) {
  const div = document.createElement("div");
  div.className = `message ${role}`;
  div.textContent = content;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// Send message
async function sendMessage(message) {
  if (!message.trim() || !sessionId || isProcessing) return;

  // Show user message
  appendMessage("user", message);
  messageInput.value = "";

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
    appendMessage("error", `Failed to send: ${error.message}`);
    isProcessing = false;
    sendBtn.disabled = false;
  }
}

// Handle play button
function toggleAudio() {
  if (isPlaying) {
    audioEl.pause();
    isPlaying = false;
    playBtn.classList.remove("playing");
    playText.textContent = "Tap to resume audio";
  } else {
    // Start playing the audio stream
    audioEl.play()
      .then(() => {
        isPlaying = true;
        playBtn.classList.add("playing");
        playText.textContent = "Audio playing";
      })
      .catch((err) => {
        console.error("Audio play failed:", err);
        appendMessage("system", "Tap the play button to hear audio guidance");
      });
  }
}

// Event listeners
chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(messageInput.value);
});

playBtn.addEventListener("click", toggleAudio);

// Handle audio events
audioEl.addEventListener("playing", () => {
  isPlaying = true;
  playBtn.classList.add("playing");
  playText.textContent = "Audio playing";
});

audioEl.addEventListener("pause", () => {
  isPlaying = false;
  playBtn.classList.remove("playing");
  playText.textContent = "Tap to resume audio";
});

audioEl.addEventListener("error", (e) => {
  console.error("Audio error:", e);
  // Don't show error for initial load - it's expected
  if (audioEl.currentTime > 0) {
    nowPlayingEl.textContent = "Audio connection lost - reconnecting...";
    setTimeout(() => {
      if (sessionId) {
        audioEl.src = `/api/audio/${sessionId}`;
        if (isPlaying) {
          audioEl.play().catch(() => {});
        }
      }
    }, 2000);
  }
});

// Initialize on load
init();
