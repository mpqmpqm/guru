import "./style.css";

const WS_URL = "ws://localhost:8080";

interface SpeakMessage {
  type: "speak";
  text: string;
  id: string;
}

type ServerMessage = SpeakMessage;

// Track if audio has been unlocked by user interaction
let audioUnlocked = false;

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

const statusEl =
  document.querySelector<HTMLDivElement>("#status")!;
const instructionEl =
  document.querySelector<HTMLDivElement>("#instruction")!;
const startBtn =
  document.querySelector<HTMLButtonElement>("#start-btn")!;

// Unlock audio on user interaction
startBtn.addEventListener("click", () => {
  // Speak a silent utterance to unlock the API
  const utterance = new SpeechSynthesisUtterance("");
  speechSynthesis.speak(utterance);
  audioUnlocked = true;
  startBtn.style.display = "none";
  instructionEl.textContent = "Ready for instructions...";
});

// Speech synthesis
function speak(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!audioUnlocked) {
      console.warn("Audio not unlocked - click Start Class button");
      resolve(); // Don't block, just skip
      return;
    }

    // Cancel any pending speech
    speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.9;
    utterance.onend = () => resolve();
    utterance.onerror = (event) => {
      // "interrupted" is not a real error, just means new speech started
      if (event.error === "interrupted") {
        resolve();
      } else {
        reject(new Error(event.error));
      }
    };
    speechSynthesis.speak(utterance);
  });
}

// WebSocket connection
function connect() {
  const ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    statusEl.textContent = "Connected";
    statusEl.className = "status connected";
    if (audioUnlocked) {
      instructionEl.textContent = "Ready for instructions...";
    }
  };

  ws.onclose = () => {
    statusEl.textContent = "Disconnected";
    statusEl.className = "status disconnected";
    instructionEl.textContent = "";
    // Reconnect after 2 seconds
    setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    statusEl.textContent = "Connection error";
    statusEl.className = "status disconnected";
  };

  ws.onmessage = async (event) => {
    try {
      const msg: ServerMessage = JSON.parse(event.data);

      if (msg.type === "speak") {
        instructionEl.textContent = msg.text;
        instructionEl.classList.add("speaking");

        try {
          await speak(msg.text);
        } catch (error) {
          console.error("Speech error:", error);
        }

        instructionEl.classList.remove("speaking");

        // Send completion acknowledgment
        ws.send(
          JSON.stringify({ type: "complete", id: msg.id })
        );
      }
    } catch (error) {
      console.error("Message parse error:", error);
    }
  };
}

// Start connection
connect();
