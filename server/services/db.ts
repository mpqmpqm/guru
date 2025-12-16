import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

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

    CREATE INDEX IF NOT EXISTS idx_cues_session ON cues(session_id, sequence_num);
    CREATE INDEX IF NOT EXISTS idx_thinking_session ON thinking_traces(session_id, sequence_num);
  `);
}

// Prepared statements
export const dbOps = {
  createSession(id: string, createdAt: string, initialPrompt: string): void {
    const database = getDb();
    database
      .prepare(
        `INSERT INTO sessions (id, created_at, initial_prompt) VALUES (?, ?, ?)`
      )
      .run(id, createdAt, initialPrompt);
  },

  insertThinkingTrace(
    id: string,
    sessionId: string,
    seqNum: number,
    content: string
  ): void {
    const database = getDb();
    database
      .prepare(
        `INSERT INTO thinking_traces (id, session_id, sequence_num, content, created_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, sessionId, seqNum, content, new Date().toISOString());
  },

  insertCue(
    sessionId: string,
    seqNum: number,
    text: string,
    voice: string,
    pause: number
  ): void {
    const database = getDb();
    database
      .prepare(
        `INSERT INTO cues (session_id, sequence_num, text, voice, pause, created_at) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(sessionId, seqNum, text, voice, pause, new Date().toISOString());
  },

  completeSession(sessionId: string): void {
    const database = getDb();
    database
      .prepare(
        `UPDATE sessions SET completed_at = ?, status = 'completed' WHERE id = ?`
      )
      .run(new Date().toISOString(), sessionId);
  },

  closeSession(sessionId: string): void {
    const database = getDb();
    // Only close if not already completed
    database
      .prepare(
        `UPDATE sessions SET completed_at = ?, status = 'closed' WHERE id = ? AND status != 'completed'`
      )
      .run(new Date().toISOString(), sessionId);
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
    const database = getDb();
    return database
      .prepare(`SELECT * FROM sessions WHERE id = ?`)
      .get(sessionId) as ReturnType<typeof dbOps.getSession>;
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
    created_at: string;
  }> {
    const database = getDb();
    return database
      .prepare(
        `SELECT * FROM cues WHERE session_id = ? ORDER BY sequence_num`
      )
      .all(sessionId) as ReturnType<typeof dbOps.getCues>;
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
    const database = getDb();
    return database
      .prepare(
        `SELECT * FROM thinking_traces WHERE session_id = ? ORDER BY sequence_num`
      )
      .all(sessionId) as ReturnType<typeof dbOps.getThinkingTraces>;
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
    const database = getDb();
    return database
      .prepare(
        `SELECT id, created_at, initial_prompt, status, completed_at FROM sessions ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit) as ReturnType<typeof dbOps.listSessions>;
  },

  deleteSession(sessionId: string): boolean {
    const database = getDb();
    // Delete related records first (foreign key constraints)
    database.prepare(`DELETE FROM cues WHERE session_id = ?`).run(sessionId);
    database
      .prepare(`DELETE FROM thinking_traces WHERE session_id = ?`)
      .run(sessionId);
    const result = database
      .prepare(`DELETE FROM sessions WHERE id = ?`)
      .run(sessionId);
    return result.changes > 0;
  },

  getSessionEvents(
    sessionId: string
  ): Array<
    | { type: "thinking"; sequence_num: number; content: string; created_at: string }
    | { type: "cue"; sequence_num: number; text: string; voice: string; pause: number; created_at: string }
  > {
    const database = getDb();
    // Query both tables and union them, ordered by sequence_num
    const results = database
      .prepare(
        `SELECT 'thinking' as type, sequence_num, content, NULL as text, NULL as voice, NULL as pause, created_at
         FROM thinking_traces WHERE session_id = ?
         UNION ALL
         SELECT 'cue' as type, sequence_num, NULL as content, text, voice, pause, created_at
         FROM cues WHERE session_id = ?
         ORDER BY sequence_num`
      )
      .all(sessionId, sessionId) as Array<{
        type: string;
        sequence_num: number;
        content: string | null;
        text: string | null;
        voice: string | null;
        pause: number | null;
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
      } else {
        return {
          type: "cue" as const,
          sequence_num: row.sequence_num,
          text: row.text!,
          voice: row.voice!,
          pause: row.pause!,
          created_at: row.created_at,
        };
      }
    });
  },
};
