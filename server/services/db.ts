import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { logDbError } from "../utils/log.js";
import {
  calculateCost,
  calculateTTSCost,
  type Usage,
} from "./pricing.js";
import { DEFAULT_MODEL } from "../routes/session.js";

// Detect Fly.io environment vs local
const DB_PATH = process.env.FLY_APP_NAME
  ? "/data/guru.db"
  : path.join(process.cwd(), "data", "guru.db");

// Singleton connection
let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    // Ensure directory exists
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initSchema(db);
  }
  return db;
}

function initSchema(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      initial_prompt TEXT,
      completed_at TEXT,
      status TEXT DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS cues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      sequence_num INTEGER NOT NULL,
      text TEXT NOT NULL,
      voice TEXT NOT NULL,
      pause INTEGER DEFAULT 0,
      wait_ms INTEGER,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS thinking_traces (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sequence_num INTEGER NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      sequence_num INTEGER NOT NULL,
      source TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS silences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      sequence_num INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE TABLE IF NOT EXISTS tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      sequence_num INTEGER NOT NULL,
      tool_name TEXT NOT NULL,
      intent TEXT,
      stopwatch_id TEXT,
      stopwatch_elapsed_ms INTEGER,
      elapsed_ms INTEGER NOT NULL,
      wall_clock TEXT NOT NULL,
      result TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_cues_session ON cues(session_id, sequence_num);
    CREATE INDEX IF NOT EXISTS idx_thinking_session ON thinking_traces(session_id, sequence_num);
    CREATE INDEX IF NOT EXISTS idx_errors_session ON errors(session_id, sequence_num);
    CREATE INDEX IF NOT EXISTS idx_silences_session ON silences(session_id, sequence_num);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id, sequence_num);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sequence_num INTEGER NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cache_read_tokens INTEGER DEFAULT 0,
      cache_creation_tokens INTEGER DEFAULT 0,
      cost_usd REAL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, sequence_num);
  `);
  ensureCueWaitMsColumn(database);
  ensureResultColumns(database);
  ensureExportColumns(database);
  ensureCostColumns(database);
  ensureModelColumn(database);
  ensureMessageIdColumns(database);
  ensureSpeakingTimestampColumns(database);
}

function ensureCueWaitMsColumn(
  database: Database.Database
): void {
  const columns = database
    .prepare(`PRAGMA table_info(cues)`)
    .all() as Array<{ name: string }>;
  const hasWaitMs = columns.some(
    (column) => column.name === "wait_ms"
  );
  if (!hasWaitMs) {
    database.exec(`ALTER TABLE cues ADD COLUMN wait_ms INTEGER`);
  }
}

function ensureResultColumns(database: Database.Database): void {
  const cueColumns = database
    .prepare(`PRAGMA table_info(cues)`)
    .all() as Array<{ name: string }>;
  const cueColNames = new Set(cueColumns.map((c) => c.name));
  if (!cueColNames.has("speaking_ms")) {
    database.exec(
      `ALTER TABLE cues ADD COLUMN speaking_ms INTEGER`
    );
  }
  if (!cueColNames.has("ratio")) {
    database.exec(`ALTER TABLE cues ADD COLUMN ratio TEXT`);
  }
  if (!cueColNames.has("elapsed_ms")) {
    database.exec(
      `ALTER TABLE cues ADD COLUMN elapsed_ms INTEGER`
    );
  }
  if (!cueColNames.has("wall_clock")) {
    database.exec(`ALTER TABLE cues ADD COLUMN wall_clock TEXT`);
  }
  if (!cueColNames.has("queue_depth")) {
    database.exec(
      `ALTER TABLE cues ADD COLUMN queue_depth INTEGER`
    );
  }

  // Add queue_depth to thinking_traces
  const thinkingColumns = database
    .prepare(`PRAGMA table_info(thinking_traces)`)
    .all() as Array<{ name: string }>;
  if (!thinkingColumns.some((c) => c.name === "queue_depth")) {
    database.exec(
      `ALTER TABLE thinking_traces ADD COLUMN queue_depth INTEGER`
    );
  }

  const silenceColumns = database
    .prepare(`PRAGMA table_info(silences)`)
    .all() as Array<{ name: string }>;
  const silColNames = new Set(silenceColumns.map((c) => c.name));
  if (!silColNames.has("since_speak_ms")) {
    database.exec(
      `ALTER TABLE silences ADD COLUMN since_speak_ms INTEGER`
    );
  }
  if (!silColNames.has("ratio")) {
    database.exec(`ALTER TABLE silences ADD COLUMN ratio TEXT`);
  }
  if (!silColNames.has("elapsed_ms")) {
    database.exec(
      `ALTER TABLE silences ADD COLUMN elapsed_ms INTEGER`
    );
  }
  if (!silColNames.has("wall_clock")) {
    database.exec(
      `ALTER TABLE silences ADD COLUMN wall_clock TEXT`
    );
  }
}

function ensureExportColumns(database: Database.Database): void {
  const columns = database
    .prepare(`PRAGMA table_info(sessions)`)
    .all() as Array<{ name: string }>;
  const colNames = new Set(columns.map((c) => c.name));

  if (!colNames.has("export_status")) {
    database.exec(
      `ALTER TABLE sessions ADD COLUMN export_status TEXT`
    );
  }
  if (!colNames.has("export_url")) {
    database.exec(
      `ALTER TABLE sessions ADD COLUMN export_url TEXT`
    );
  }
  if (!colNames.has("export_started_at")) {
    database.exec(
      `ALTER TABLE sessions ADD COLUMN export_started_at TEXT`
    );
  }
  if (!colNames.has("export_error")) {
    database.exec(
      `ALTER TABLE sessions ADD COLUMN export_error TEXT`
    );
  }
  if (!colNames.has("export_progress")) {
    database.exec(
      `ALTER TABLE sessions ADD COLUMN export_progress TEXT`
    );
  }
}

function ensureCostColumns(database: Database.Database): void {
  const columns = database
    .prepare(`PRAGMA table_info(sessions)`)
    .all() as Array<{ name: string }>;
  const colNames = new Set(columns.map((c) => c.name));

  // Agent SDK costs
  if (!colNames.has("input_tokens")) {
    database.exec(
      `ALTER TABLE sessions ADD COLUMN input_tokens INTEGER DEFAULT 0`
    );
  }
  if (!colNames.has("output_tokens")) {
    database.exec(
      `ALTER TABLE sessions ADD COLUMN output_tokens INTEGER DEFAULT 0`
    );
  }
  if (!colNames.has("cache_read_tokens")) {
    database.exec(
      `ALTER TABLE sessions ADD COLUMN cache_read_tokens INTEGER DEFAULT 0`
    );
  }
  if (!colNames.has("cache_creation_tokens")) {
    database.exec(
      `ALTER TABLE sessions ADD COLUMN cache_creation_tokens INTEGER DEFAULT 0`
    );
  }
  if (!colNames.has("agent_cost_usd")) {
    database.exec(
      `ALTER TABLE sessions ADD COLUMN agent_cost_usd REAL`
    );
  }

  // TTS costs
  if (!colNames.has("tts_input_tokens")) {
    database.exec(
      `ALTER TABLE sessions ADD COLUMN tts_input_tokens INTEGER DEFAULT 0`
    );
  }
  if (!colNames.has("tts_cost_usd")) {
    database.exec(
      `ALTER TABLE sessions ADD COLUMN tts_cost_usd REAL DEFAULT 0`
    );
  }

  // Export TTS costs (separate from live session TTS)
  if (!colNames.has("export_tts_input_tokens")) {
    database.exec(
      `ALTER TABLE sessions ADD COLUMN export_tts_input_tokens INTEGER DEFAULT 0`
    );
  }
  if (!colNames.has("export_tts_cost_usd")) {
    database.exec(
      `ALTER TABLE sessions ADD COLUMN export_tts_cost_usd REAL DEFAULT 0`
    );
  }
}

function ensureModelColumn(database: Database.Database): void {
  const columns = database
    .prepare(`PRAGMA table_info(sessions)`)
    .all() as Array<{ name: string }>;
  const colNames = new Set(columns.map((c) => c.name));

  if (!colNames.has("model")) {
    database.exec(
      `ALTER TABLE sessions ADD COLUMN model TEXT DEFAULT '${DEFAULT_MODEL}'`
    );
  }
}

function ensureMessageIdColumns(
  database: Database.Database
): void {
  const tables = [
    "thinking_traces",
    "cues",
    "silences",
    "tool_calls",
    "errors",
  ];
  for (const table of tables) {
    const columns = database
      .prepare(`PRAGMA table_info(${table})`)
      .all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === "message_id")) {
      database.exec(
        `ALTER TABLE ${table} ADD COLUMN message_id TEXT REFERENCES messages(id)`
      );
    }
  }
}

function ensureSpeakingTimestampColumns(
  database: Database.Database
): void {
  const columns = database
    .prepare(`PRAGMA table_info(cues)`)
    .all() as Array<{ name: string }>;
  const colNames = new Set(columns.map((c) => c.name));

  if (!colNames.has("speaking_started_at")) {
    database.exec(
      `ALTER TABLE cues ADD COLUMN speaking_started_at INTEGER`
    );
  }
  if (!colNames.has("speaking_ended_at")) {
    database.exec(
      `ALTER TABLE cues ADD COLUMN speaking_ended_at INTEGER`
    );
  }
}

// Safe database operation wrapper - logs errors but doesn't crash
function safeDbOperation<T>(
  operation: () => T,
  operationName: string,
  fallback: T
): T {
  try {
    return operation();
  } catch (error) {
    logDbError(operationName, error);
    return fallback;
  }
}

// Prepared statements
export const dbOps = {
  createSession(
    id: string,
    createdAt: string,
    initialPrompt: string,
    model?: string
  ): void {
    safeDbOperation(
      () => {
        const database = getDb();
        database
          .prepare(
            `INSERT INTO sessions (id, created_at, initial_prompt, model) VALUES (?, ?, ?, ?)`
          )
          .run(
            id,
            createdAt,
            initialPrompt,
            model ?? DEFAULT_MODEL
          );
      },
      "createSession",
      undefined
    );
  },

  insertThinkingTrace(
    id: string,
    sessionId: string,
    seqNum: number,
    content: string,
    queueDepth: number
  ): void {
    safeDbOperation(
      () => {
        const database = getDb();
        database
          .prepare(
            `INSERT INTO thinking_traces (id, session_id, sequence_num, content, queue_depth, created_at) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            id,
            sessionId,
            seqNum,
            content,
            queueDepth,
            new Date().toISOString()
          );
      },
      "insertThinkingTrace",
      undefined
    );
  },

  insertSpeak(
    sessionId: string,
    seqNum: number,
    content: string,
    voice: string,
    speakingMs: number,
    waitMs: number | null,
    ratio: string,
    elapsedMs: number,
    wallClock: string,
    queueDepth: number
  ): void {
    safeDbOperation(
      () => {
        const database = getDb();
        database
          .prepare(
            `INSERT INTO cues (session_id, sequence_num, text, voice, speaking_ms, wait_ms, ratio, elapsed_ms, wall_clock, queue_depth, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            sessionId,
            seqNum,
            content,
            voice,
            speakingMs,
            waitMs,
            ratio,
            elapsedMs,
            wallClock,
            queueDepth,
            new Date().toISOString()
          );
      },
      "insertSpeak",
      undefined
    );
  },

  updateSpeakTimestamps(
    sessionId: string,
    seqNum: number,
    startedAt: number,
    endedAt: number
  ): void {
    safeDbOperation(
      () => {
        const database = getDb();
        database
          .prepare(
            `UPDATE cues SET speaking_started_at = ?, speaking_ended_at = ? WHERE session_id = ? AND sequence_num = ?`
          )
          .run(startedAt, endedAt, sessionId, seqNum);
      },
      "updateSpeakTimestamps",
      undefined
    );
  },

  insertSilence(
    sessionId: string,
    seqNum: number,
    durationMs: number,
    sinceSpeakMs: number | null,
    ratio: string,
    elapsedMs: number,
    wallClock: string
  ): void {
    safeDbOperation(
      () => {
        const database = getDb();
        database
          .prepare(
            `INSERT INTO silences (session_id, sequence_num, duration_ms, since_speak_ms, ratio, elapsed_ms, wall_clock, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            sessionId,
            seqNum,
            durationMs,
            sinceSpeakMs,
            ratio,
            elapsedMs,
            wallClock,
            new Date().toISOString()
          );
      },
      "insertSilence",
      undefined
    );
  },

  insertToolCall(
    sessionId: string,
    seqNum: number,
    toolName: string,
    intent: string | null,
    stopwatchId: string | null,
    stopwatchElapsedMs: number | null,
    elapsedMs: number,
    wallClock: string,
    result: string
  ): void {
    safeDbOperation(
      () => {
        const database = getDb();
        database
          .prepare(
            `INSERT INTO tool_calls (session_id, sequence_num, tool_name, intent, stopwatch_id, stopwatch_elapsed_ms, elapsed_ms, wall_clock, result, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            sessionId,
            seqNum,
            toolName,
            intent,
            stopwatchId,
            stopwatchElapsedMs,
            elapsedMs,
            wallClock,
            result,
            new Date().toISOString()
          );
      },
      "insertToolCall",
      undefined
    );
  },

  insertError(
    sessionId: string,
    seqNum: number,
    source: string,
    message: string
  ): void {
    safeDbOperation(
      () => {
        const database = getDb();
        database
          .prepare(
            `INSERT INTO errors (session_id, sequence_num, source, message, created_at) VALUES (?, ?, ?, ?, ?)`
          )
          .run(
            sessionId,
            seqNum,
            source,
            message,
            new Date().toISOString()
          );
      },
      "insertError",
      undefined
    );
  },

  completeSession(sessionId: string): void {
    safeDbOperation(
      () => {
        const database = getDb();
        database
          .prepare(
            `UPDATE sessions SET completed_at = ?, status = 'completed' WHERE id = ?`
          )
          .run(new Date().toISOString(), sessionId);
      },
      "completeSession",
      undefined
    );
  },

  closeSession(sessionId: string): void {
    safeDbOperation(
      () => {
        const database = getDb();
        // Only close if not already completed
        database
          .prepare(
            `UPDATE sessions SET completed_at = ?, status = 'closed' WHERE id = ? AND status != 'completed'`
          )
          .run(new Date().toISOString(), sessionId);
      },
      "closeSession",
      undefined
    );
  },

  getSession(sessionId: string): {
    id: string;
    created_at: string;
    initial_prompt: string | null;
    completed_at: string | null;
    status: string;
    model: string | null;
    export_status: string | null;
    export_url: string | null;
    export_started_at: string | null;
    export_error: string | null;
    export_progress: string | null;
    // Cost tracking
    input_tokens: number | null;
    output_tokens: number | null;
    cache_read_tokens: number | null;
    cache_creation_tokens: number | null;
    agent_cost_usd: number | null;
    tts_input_tokens: number | null;
    tts_cost_usd: number | null;
    export_tts_input_tokens: number | null;
    export_tts_cost_usd: number | null;
  } | null {
    return safeDbOperation(
      () => {
        const database = getDb();
        return database
          .prepare(`SELECT * FROM sessions WHERE id = ?`)
          .get(sessionId) as ReturnType<typeof dbOps.getSession>;
      },
      "getSession",
      null
    );
  },

  updateExportStatus(
    sessionId: string,
    status: "pending" | "processing" | "complete" | "error",
    url?: string | null,
    error?: string | null,
    progress?: string | null
  ): void {
    safeDbOperation(
      () => {
        const database = getDb();
        const now = new Date().toISOString();
        database
          .prepare(
            `UPDATE sessions SET
              export_status = ?,
              export_url = COALESCE(?, export_url),
              export_started_at = CASE WHEN ? = 'pending' THEN ? ELSE export_started_at END,
              export_error = ?,
              export_progress = ?
            WHERE id = ?`
          )
          .run(
            status,
            url ?? null,
            status,
            now,
            error ?? null,
            progress ?? null,
            sessionId
          );
      },
      "updateExportStatus",
      undefined
    );
  },

  getCues(sessionId: string): Array<{
    id: number;
    session_id: string;
    sequence_num: number;
    text: string;
    voice: string;
    pause: number;
    wait_ms: number | null;
    created_at: string;
  }> {
    return safeDbOperation(
      () => {
        const database = getDb();
        return database
          .prepare(
            `SELECT * FROM cues WHERE session_id = ? ORDER BY sequence_num`
          )
          .all(sessionId) as ReturnType<typeof dbOps.getCues>;
      },
      "getCues",
      []
    );
  },

  getThinkingTraces(sessionId: string): Array<{
    id: string;
    session_id: string;
    sequence_num: number;
    content: string;
    created_at: string;
  }> {
    return safeDbOperation(
      () => {
        const database = getDb();
        return database
          .prepare(
            `SELECT * FROM thinking_traces WHERE session_id = ? ORDER BY sequence_num`
          )
          .all(sessionId) as ReturnType<
          typeof dbOps.getThinkingTraces
        >;
      },
      "getThinkingTraces",
      []
    );
  },

  getErrors(sessionId: string): Array<{
    id: number;
    session_id: string;
    sequence_num: number;
    source: string;
    message: string;
    created_at: string;
  }> {
    return safeDbOperation(
      () => {
        const database = getDb();
        return database
          .prepare(
            `SELECT * FROM errors WHERE session_id = ? ORDER BY sequence_num`
          )
          .all(sessionId) as ReturnType<typeof dbOps.getErrors>;
      },
      "getErrors",
      []
    );
  },

  listSessions(limit: number = 20): Array<{
    id: string;
    created_at: string;
    initial_prompt: string | null;
    status: string;
    completed_at: string | null;
  }> {
    return safeDbOperation(
      () => {
        const database = getDb();
        return database
          .prepare(
            `SELECT id, created_at, initial_prompt, status, completed_at FROM sessions ORDER BY created_at DESC LIMIT ?`
          )
          .all(limit) as ReturnType<typeof dbOps.listSessions>;
      },
      "listSessions",
      []
    );
  },

  deleteSession(sessionId: string): boolean {
    return safeDbOperation(
      () => {
        const database = getDb();
        // Delete related records first (foreign key constraints)
        database
          .prepare(`DELETE FROM cues WHERE session_id = ?`)
          .run(sessionId);
        database
          .prepare(
            `DELETE FROM thinking_traces WHERE session_id = ?`
          )
          .run(sessionId);
        database
          .prepare(`DELETE FROM errors WHERE session_id = ?`)
          .run(sessionId);
        database
          .prepare(`DELETE FROM silences WHERE session_id = ?`)
          .run(sessionId);
        database
          .prepare(`DELETE FROM tool_calls WHERE session_id = ?`)
          .run(sessionId);
        database
          .prepare(`DELETE FROM messages WHERE session_id = ?`)
          .run(sessionId);
        const result = database
          .prepare(`DELETE FROM sessions WHERE id = ?`)
          .run(sessionId);
        return result.changes > 0;
      },
      "deleteSession",
      false
    );
  },

  getSessionEvents(sessionId: string): Array<
    | {
        type: "thinking";
        sequence_num: number;
        content: string;
        queueDepth: number | null;
        created_at: string;
      }
    | {
        type: "speak";
        sequence_num: number;
        text: string;
        voice: string;
        speakingMs: number | null;
        waitMs: number | null;
        ratio: string | null;
        elapsedMs: number | null;
        wallClock: string | null;
        queueDepth: number | null;
        speakingStartedAt: number | null;
        speakingEndedAt: number | null;
        created_at: string;
      }
    | {
        type: "silence";
        sequence_num: number;
        durationMs: number;
        sinceSpeakMs: number | null;
        ratio: string | null;
        elapsedMs: number | null;
        wallClock: string | null;
        created_at: string;
      }
    | {
        type: "error";
        sequence_num: number;
        source: string;
        message: string;
        created_at: string;
      }
    | {
        type: "tool_call";
        sequence_num: number;
        toolName: string;
        intent: string | null;
        stopwatchId: string | null;
        stopwatchElapsedMs: number | null;
        result: string;
        created_at: string;
      }
  > {
    return safeDbOperation(
      () => {
        const database = getDb();
        // Query all tables and union them, ordered by sequence_num
        const results = database
          .prepare(
            `SELECT 'thinking' as type, sequence_num, content, queue_depth, NULL as text, NULL as voice, NULL as speaking_ms, NULL as wait_ms, NULL as ratio, NULL as elapsed_ms, NULL as wall_clock, NULL as duration_ms, NULL as since_speak_ms, NULL as source, NULL as message, NULL as tool_name, NULL as intent, NULL as stopwatch_id, NULL as stopwatch_elapsed_ms, NULL as result, NULL as speaking_started_at, NULL as speaking_ended_at, created_at
             FROM thinking_traces WHERE session_id = ?
             UNION ALL
             SELECT 'speak' as type, sequence_num, NULL as content, queue_depth, text, voice, speaking_ms, wait_ms, ratio, elapsed_ms, wall_clock, NULL as duration_ms, NULL as since_speak_ms, NULL as source, NULL as message, NULL as tool_name, NULL as intent, NULL as stopwatch_id, NULL as stopwatch_elapsed_ms, NULL as result, speaking_started_at, speaking_ended_at, created_at
             FROM cues WHERE session_id = ?
             UNION ALL
             SELECT 'silence' as type, sequence_num, NULL as content, NULL as queue_depth, NULL as text, NULL as voice, NULL as speaking_ms, NULL as wait_ms, ratio, elapsed_ms, wall_clock, duration_ms, since_speak_ms, NULL as source, NULL as message, NULL as tool_name, NULL as intent, NULL as stopwatch_id, NULL as stopwatch_elapsed_ms, NULL as result, NULL as speaking_started_at, NULL as speaking_ended_at, created_at
             FROM silences WHERE session_id = ?
             UNION ALL
             SELECT 'error' as type, sequence_num, NULL as content, NULL as queue_depth, NULL as text, NULL as voice, NULL as speaking_ms, NULL as wait_ms, NULL as ratio, NULL as elapsed_ms, NULL as wall_clock, NULL as duration_ms, NULL as since_speak_ms, source, message, NULL as tool_name, NULL as intent, NULL as stopwatch_id, NULL as stopwatch_elapsed_ms, NULL as result, NULL as speaking_started_at, NULL as speaking_ended_at, created_at
             FROM errors WHERE session_id = ?
             UNION ALL
             SELECT 'tool_call' as type, sequence_num, NULL as content, NULL as queue_depth, NULL as text, NULL as voice, NULL as speaking_ms, NULL as wait_ms, NULL as ratio, NULL as elapsed_ms, NULL as wall_clock, NULL as duration_ms, NULL as since_speak_ms, NULL as source, NULL as message, tool_name, intent, stopwatch_id, stopwatch_elapsed_ms, result, NULL as speaking_started_at, NULL as speaking_ended_at, created_at
             FROM tool_calls WHERE session_id = ?
             ORDER BY sequence_num`
          )
          .all(
            sessionId,
            sessionId,
            sessionId,
            sessionId,
            sessionId
          ) as Array<{
          type: string;
          sequence_num: number;
          content: string | null;
          queue_depth: number | null;
          text: string | null;
          voice: string | null;
          speaking_ms: number | null;
          wait_ms: number | null;
          ratio: string | null;
          elapsed_ms: number | null;
          wall_clock: string | null;
          duration_ms: number | null;
          since_speak_ms: number | null;
          source: string | null;
          message: string | null;
          tool_name: string | null;
          intent: string | null;
          stopwatch_id: string | null;
          stopwatch_elapsed_ms: number | null;
          result: string | null;
          speaking_started_at: number | null;
          speaking_ended_at: number | null;
          created_at: string;
        }>;

        return results.map((row) => {
          if (row.type === "thinking") {
            return {
              type: "thinking" as const,
              sequence_num: row.sequence_num,
              content: row.content!,
              queueDepth: row.queue_depth,
              created_at: row.created_at,
            };
          } else if (row.type === "error") {
            return {
              type: "error" as const,
              sequence_num: row.sequence_num,
              source: row.source!,
              message: row.message!,
              created_at: row.created_at,
            };
          } else if (row.type === "silence") {
            return {
              type: "silence" as const,
              sequence_num: row.sequence_num,
              durationMs: row.duration_ms!,
              sinceSpeakMs: row.since_speak_ms,
              ratio: row.ratio,
              elapsedMs: row.elapsed_ms,
              wallClock: row.wall_clock,
              created_at: row.created_at,
            };
          } else if (row.type === "tool_call") {
            return {
              type: "tool_call" as const,
              sequence_num: row.sequence_num,
              toolName: row.tool_name!,
              intent: row.intent,
              stopwatchId: row.stopwatch_id,
              stopwatchElapsedMs: row.stopwatch_elapsed_ms,
              result: row.result!,
              created_at: row.created_at,
            };
          } else {
            return {
              type: "speak" as const,
              sequence_num: row.sequence_num,
              text: row.text!,
              voice: row.voice!,
              speakingMs: row.speaking_ms,
              waitMs: row.wait_ms,
              ratio: row.ratio,
              elapsedMs: row.elapsed_ms,
              wallClock: row.wall_clock,
              queueDepth: row.queue_depth,
              speakingStartedAt: row.speaking_started_at,
              speakingEndedAt: row.speaking_ended_at,
              created_at: row.created_at,
            };
          }
        });
      },
      "getSessionEvents",
      []
    );
  },

  accumulateAgentCosts(
    sessionId: string,
    usage: Usage,
    model: string
  ): void {
    safeDbOperation(
      () => {
        const database = getDb();
        const cost = calculateCost(usage, model);
        database
          .prepare(
            `UPDATE sessions SET
              input_tokens = input_tokens + ?,
              output_tokens = output_tokens + ?,
              cache_read_tokens = cache_read_tokens + ?,
              cache_creation_tokens = cache_creation_tokens + ?,
              agent_cost_usd = COALESCE(agent_cost_usd, 0) + ?
            WHERE id = ?`
          )
          .run(
            usage.input_tokens ?? 0,
            usage.output_tokens ?? 0,
            usage.cache_read_input_tokens ?? 0,
            usage.cache_creation_input_tokens ?? 0,
            cost,
            sessionId
          );
      },
      "accumulateAgentCosts",
      undefined
    );
  },

  finalizeAgentCosts(
    sessionId: string,
    totalCostUsd: number
  ): void {
    safeDbOperation(
      () => {
        const database = getDb();
        database
          .prepare(
            `UPDATE sessions SET agent_cost_usd = ? WHERE id = ?`
          )
          .run(totalCostUsd, sessionId);
      },
      "finalizeAgentCosts",
      undefined
    );
  },

  accumulateTTSCost(
    sessionId: string,
    inputTokens: number
  ): void {
    safeDbOperation(
      () => {
        const database = getDb();
        const cost = calculateTTSCost(inputTokens);
        database
          .prepare(
            `UPDATE sessions SET
              tts_input_tokens = tts_input_tokens + ?,
              tts_cost_usd = tts_cost_usd + ?
            WHERE id = ?`
          )
          .run(inputTokens, cost, sessionId);
      },
      "accumulateTTSCost",
      undefined
    );
  },

  accumulateExportTTSCost(
    sessionId: string,
    inputTokens: number
  ): void {
    safeDbOperation(
      () => {
        const database = getDb();
        const cost = calculateTTSCost(inputTokens);
        database
          .prepare(
            `UPDATE sessions SET
              export_tts_input_tokens = export_tts_input_tokens + ?,
              export_tts_cost_usd = export_tts_cost_usd + ?
            WHERE id = ?`
          )
          .run(inputTokens, cost, sessionId);
      },
      "accumulateExportTTSCost",
      undefined
    );
  },

  insertMessage(
    id: string,
    sessionId: string,
    seqNum: number,
    inputTokens: number,
    outputTokens: number,
    cacheReadTokens: number,
    cacheCreationTokens: number,
    costUsd: number
  ): void {
    safeDbOperation(
      () => {
        const database = getDb();
        database
          .prepare(
            `INSERT INTO messages (id, session_id, sequence_num, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            id,
            sessionId,
            seqNum,
            inputTokens,
            outputTokens,
            cacheReadTokens,
            cacheCreationTokens,
            costUsd,
            new Date().toISOString()
          );
      },
      "insertMessage",
      undefined
    );
  },

  linkEventsToMessage(
    sessionId: string,
    messageId: string,
    fromSeqNum: number
  ): void {
    safeDbOperation(
      () => {
        const database = getDb();
        const tables = [
          "thinking_traces",
          "cues",
          "silences",
          "tool_calls",
          "errors",
        ];
        for (const table of tables) {
          database
            .prepare(
              `UPDATE ${table} SET message_id = ? WHERE session_id = ? AND sequence_num > ? AND message_id IS NULL`
            )
            .run(messageId, sessionId, fromSeqNum);
        }
      },
      "linkEventsToMessage",
      undefined
    );
  },

  getMessages(sessionId: string): Array<{
    id: string;
    session_id: string;
    sequence_num: number;
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;
    cache_creation_tokens: number;
    cost_usd: number | null;
    created_at: string;
  }> {
    return safeDbOperation(
      () => {
        const database = getDb();
        return database
          .prepare(
            `SELECT * FROM messages WHERE session_id = ? ORDER BY sequence_num`
          )
          .all(sessionId) as ReturnType<
          typeof dbOps.getMessages
        >;
      },
      "getMessages",
      []
    );
  },
};
