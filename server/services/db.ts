import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { logDbError } from "../utils/log.js";

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
      breath_phase REAL,
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

    CREATE INDEX IF NOT EXISTS idx_cues_session ON cues(session_id, sequence_num);
    CREATE INDEX IF NOT EXISTS idx_thinking_session ON thinking_traces(session_id, sequence_num);
    CREATE INDEX IF NOT EXISTS idx_errors_session ON errors(session_id, sequence_num);
  `);
  ensureCueBreathPhaseColumn(database);
}

function ensureCueBreathPhaseColumn(database: Database.Database): void {
  const columns = database
    .prepare(`PRAGMA table_info(cues)`)
    .all() as Array<{ name: string }>;
  const hasBreathPhase = columns.some(
    (column) => column.name === "breath_phase"
  );
  if (!hasBreathPhase) {
    database.exec(`ALTER TABLE cues ADD COLUMN breath_phase REAL`);
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
  createSession(id: string, createdAt: string, initialPrompt: string): void {
    safeDbOperation(
      () => {
        const database = getDb();
        database
          .prepare(
            `INSERT INTO sessions (id, created_at, initial_prompt) VALUES (?, ?, ?)`
          )
          .run(id, createdAt, initialPrompt);
      },
      "createSession",
      undefined
    );
  },

  insertThinkingTrace(
    id: string,
    sessionId: string,
    seqNum: number,
    content: string
  ): void {
    safeDbOperation(
      () => {
        const database = getDb();
        database
          .prepare(
            `INSERT INTO thinking_traces (id, session_id, sequence_num, content, created_at) VALUES (?, ?, ?, ?, ?)`
          )
          .run(id, sessionId, seqNum, content, new Date().toISOString());
      },
      "insertThinkingTrace",
      undefined
    );
  },

  insertCue(
    sessionId: string,
    seqNum: number,
    text: string,
    voice: string,
    breathPhase: number
  ): void {
    safeDbOperation(
      () => {
        const database = getDb();
        database
          .prepare(
            `INSERT INTO cues (session_id, sequence_num, text, voice, breath_phase, created_at) VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            sessionId,
            seqNum,
            text,
            voice,
            breathPhase,
            new Date().toISOString()
          );
      },
      "insertCue",
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
          .run(sessionId, seqNum, source, message, new Date().toISOString());
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

  getSession(
    sessionId: string
  ): {
    id: string;
    created_at: string;
    initial_prompt: string | null;
    completed_at: string | null;
    status: string;
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

  getCues(
    sessionId: string
  ): Array<{
    id: number;
    session_id: string;
    sequence_num: number;
    text: string;
    voice: string;
    pause: number;
    breath_phase: number | null;
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

  getThinkingTraces(
    sessionId: string
  ): Array<{
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
          .all(sessionId) as ReturnType<typeof dbOps.getThinkingTraces>;
      },
      "getThinkingTraces",
      []
    );
  },

  getErrors(
    sessionId: string
  ): Array<{
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

  listSessions(
    limit: number = 20
  ): Array<{
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
        database.prepare(`DELETE FROM cues WHERE session_id = ?`).run(sessionId);
        database
          .prepare(`DELETE FROM thinking_traces WHERE session_id = ?`)
          .run(sessionId);
        database
          .prepare(`DELETE FROM errors WHERE session_id = ?`)
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

  getSessionEvents(
    sessionId: string
  ): Array<
    | { type: "thinking"; sequence_num: number; content: string; created_at: string }
    | {
        type: "cue";
        sequence_num: number;
        text: string;
        voice: string;
        pause: number;
        breathPhase: number | null;
        created_at: string;
      }
    | { type: "error"; sequence_num: number; source: string; message: string; created_at: string }
  > {
    return safeDbOperation(
      () => {
        const database = getDb();
        // Query all tables and union them, ordered by sequence_num
        const results = database
          .prepare(
            `SELECT 'thinking' as type, sequence_num, content, NULL as text, NULL as voice, NULL as pause, NULL as breath_phase, NULL as source, NULL as message, created_at
             FROM thinking_traces WHERE session_id = ?
             UNION ALL
             SELECT 'cue' as type, sequence_num, NULL as content, text, voice, pause, breath_phase, NULL as source, NULL as message, created_at
             FROM cues WHERE session_id = ?
             UNION ALL
             SELECT 'error' as type, sequence_num, NULL as content, NULL as text, NULL as voice, NULL as pause, NULL as breath_phase, source, message, created_at
             FROM errors WHERE session_id = ?
             ORDER BY sequence_num`
          )
          .all(sessionId, sessionId, sessionId) as Array<{
            type: string;
            sequence_num: number;
            content: string | null;
            text: string | null;
            voice: string | null;
            pause: number | null;
            breath_phase: number | null;
            source: string | null;
            message: string | null;
            created_at: string;
          }>;

        return results.map((row) => {
          if (row.type === "thinking") {
            return {
              type: "thinking" as const,
              sequence_num: row.sequence_num,
              content: row.content!,
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
          } else {
            return {
              type: "cue" as const,
              sequence_num: row.sequence_num,
              text: row.text!,
              voice: row.voice!,
              pause: row.pause!,
              breathPhase: row.breath_phase,
              created_at: row.created_at,
            };
          }
        });
      },
      "getSessionEvents",
      []
    );
  },
};
