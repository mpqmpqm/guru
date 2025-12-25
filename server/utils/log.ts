// Server startup
export function logServerStart(
  port: string | number,
  noop = true
): void {
  if (noop) return;
  console.log(
    `Yoga Guide server running on http://localhost:${port}`
  );
  console.log(`API endpoints:`);
  console.log(`  POST /api/session - Create new session`);
  console.log(
    `  GET  /api/chat/events/:sessionId - SSE for chat events`
  );
  console.log(`  POST /api/chat/:sessionId - Send message`);
  console.log(`  GET  /api/audio/:sessionId - Audio stream`);
}

// Database
export function logDbError(
  operationName: string,
  error: unknown,
  noop = true
): void {
  if (noop) return;
  console.error(
    `[db] ${operationName} failed:`,
    error instanceof Error ? error.message : String(error)
  );
}

// Agent
export function logAgentResult(
  message: unknown,
  noop = true
): void {
  if (noop) return;
  console.dir(message);
}

export function logAgentError(
  error: unknown,
  noop = true
): void {
  if (noop) return;
  console.error(
    "Agent error:",
    JSON.stringify(error, Object.getOwnPropertyNames(error), 2)
  );
}

// Audio playback (session-manager)
export function logAudioTtsSkip(
  logPrefix: string,
  error: string,
  advancedBy: number,
  listenerElapsed: number,
  noop = true
): void {
  if (noop) return;
  console.error(
    `${logPrefix} TTS_SKIP error="${error}" advancedBy=${advancedBy}ms listenerElapsed=${listenerElapsed}ms`
  );
}

export function logAudioPlayStart(
  logPrefix: string,
  ttsWaitMs: number,
  bytes: number,
  expectedSpeakingMs: number,
  waitMs: number,
  queueDepth: number,
  noop = true
): void {
  if (noop) return;
  console.log(
    `${logPrefix} PLAY_START ttsWaitMs=${ttsWaitMs} bytes=${bytes} expectedSpeakingMs=${Math.round(expectedSpeakingMs)} waitMs=${waitMs} queueDepth=${queueDepth}`
  );
}

export function logAudioPlayEnd(
  logPrefix: string,
  speakingMs: number,
  silenceMs: number,
  totalMs: number,
  noop = true
): void {
  if (noop) return;
  console.log(
    `${logPrefix} PLAY_END speakingMs=${Math.round(speakingMs)} silenceMs=${Math.round(silenceMs)} totalMs=${totalMs}`
  );
}

// Cue tool
export function logCueReceived(
  logPrefix: string,
  waitMs: number,
  wordCount: number,
  noop = true
): void {
  if (noop) return;
  console.log(
    `${logPrefix} RECEIVED waitMs=${waitMs} words=${wordCount}`
  );
}

export function logCueText(
  logPrefix: string,
  text: string,
  noop = true
): void {
  if (noop) return;
  console.log(`${logPrefix} TEXT: "${text}"`);
}

export function logCueTtsError(
  logPrefix: string,
  elapsedMs: number,
  error: string,
  noop = true
): void {
  if (noop) return;
  console.error(
    `${logPrefix} TTS_ERROR after ${elapsedMs}ms: ${error}`
  );
}

export function logCueTtsReady(
  logPrefix: string,
  elapsedMs: number,
  bytes: number,
  noop = true
): void {
  if (noop) return;
  console.log(
    `${logPrefix} TTS_READY ${elapsedMs}ms bytes=${bytes}`
  );
}

export function logCueSseSend(
  logPrefix: string,
  sinceReceived: number,
  listenerElapsed: number,
  promisedMs: number,
  noop = true
): void {
  if (noop) return;
  console.log(
    `${logPrefix} SSE_SEND sinceReceived=${sinceReceived}ms listenerElapsed=${listenerElapsed}ms promisedMs=${promisedMs}`
  );
}

export function logCueTargetSet(
  logPrefix: string,
  listenerElapsed: number,
  newTarget: number,
  noop = true
): void {
  if (noop) return;
  console.log(
    `${logPrefix} TARGET_SET listenerElapsed=${listenerElapsed}ms newTarget=${newTarget}ms`
  );
}

export function logCueQueued(
  logPrefix: string,
  queueDepthBefore: number,
  waitMs: number,
  _unused: number,
  stackSize: number,
  noop = true
): void {
  if (noop) return;
  console.log(
    `${logPrefix} QUEUED queueDepth=${queueDepthBefore}->${queueDepthBefore + 1} waitMs=${waitMs} stackSize=${stackSize}`
  );
}

// Chat route
export function logChatError(
  errorMessage: string,
  noop = true
): void {
  if (noop) return;
  console.error(`[chat] error:`, errorMessage);
}

// Audio route
export function logAudioStreamError(
  sessionId: string,
  errorMessage: string,
  noop = true
): void {
  if (noop) return;
  console.error(
    `Audio stream error for session ${sessionId}:`,
    errorMessage
  );
}
