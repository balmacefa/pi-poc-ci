/**
 * Memory DB layer — tiered long-term memory for pi.
 * =============================================================================
 * Storage root:  <agent-dir>/memory/
 *   memory.db        SQLite (node:sqlite, FTS5)  -> source of truth for search
 *   L3-profile.md    Stable identity (hand-curated, injected every session)
 *   L2-core.md       Human-readable mirror of durable facts (backup)
 *   bus/             reserved for future file transports
 *
 * Levels:
 *   L0 Archive   -> raw session JSONL (on disk, untouched) + msg_fts index
 *   L1 Episodic  -> one `sessions` row per session (title/summary/files/tools)
 *   L2 Semantic  -> `facts` table (durable, deduped, scoped)
 *   L3 Profile   -> L3-profile.md
 *
 * Designed to last years: open formats, append-only L0, schema `user_version`
 * with forward migrations, everything under one backup-able folder.
 */
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, existsSync, readFileSync } from "node:fs";

export const SCHEMA_VERSION = 1;

export function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}
export function sessionsRoot(): string {
  return process.env.PI_CODING_AGENT_SESSION_DIR || join(agentDir(), "sessions");
}
export function memoryRoot(): string {
  const root = join(agentDir(), "memory");
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, "bus"), { recursive: true });
  return root;
}
export function dbPath(): string {
  return join(memoryRoot(), "memory.db");
}
export function profilePath(): string {
  return join(memoryRoot(), "L3-profile.md");
}
export function coreMirrorPath(): string {
  return join(memoryRoot(), "L2-core.md");
}

/** Resolve the logical name of this agent (for the comms bus). */
export function agentName(): string {
  if (process.env.PI_AGENT_NAME) return process.env.PI_AGENT_NAME;
  let host = "local";
  try {
    host = require("node:os").hostname();
  } catch {}
  return `pi@${host}`;
}

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;
  const db = new DatabaseSync(dbPath());
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA busy_timeout=5000;");
  migrate(db);
  _db = db;
  return db;
}

export function closeDb(): void {
  try {
    _db?.close();
  } catch {}
  _db = null;
}

function userVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return row?.user_version ?? 0;
}

function migrate(db: DatabaseSync): void {
  let v = userVersion(db);
  if (v < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta(
        key TEXT PRIMARY KEY, value TEXT
      );

      -- L1 episodic: one row per session file
      CREATE TABLE IF NOT EXISTS sessions(
        session_id    TEXT PRIMARY KEY,
        file_path     TEXT UNIQUE,
        cwd           TEXT,
        started_at    TEXT,
        ended_at      TEXT,
        model         TEXT,
        msg_count     INTEGER DEFAULT 0,
        user_msg_count INTEGER DEFAULT 0,
        title         TEXT,
        summary       TEXT,
        files_touched TEXT,   -- JSON array
        tools_used    TEXT,   -- JSON object {tool: count}
        file_size     INTEGER DEFAULT 0,
        file_mtime    REAL DEFAULT 0,
        indexed_at    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd);

      -- L0 searchable message index
      CREATE VIRTUAL TABLE IF NOT EXISTS msg_fts USING fts5(
        session_id UNINDEXED, role UNINDEXED, ts UNINDEXED, body
      );

      -- L2 semantic/core durable facts
      CREATE TABLE IF NOT EXISTS facts(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope      TEXT NOT NULL DEFAULT 'global',
        category   TEXT NOT NULL DEFAULT 'note',
        key        TEXT NOT NULL,
        content    TEXT NOT NULL,
        source     TEXT,
        weight     INTEGER DEFAULT 1,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE(scope, key)
      );
      CREATE INDEX IF NOT EXISTS idx_facts_scope ON facts(scope);
      CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
        content, scope UNINDEXED, category UNINDEXED, fact_id UNINDEXED
      );

      -- Agent-to-agent comms bus (persistent mailbox)
      CREATE TABLE IF NOT EXISTS bus(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel    TEXT NOT NULL DEFAULT 'general',
        from_agent TEXT,
        to_agent   TEXT,            -- NULL = broadcast
        session_id TEXT,
        body       TEXT NOT NULL,
        created_at TEXT,
        read_at    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_bus_channel ON bus(channel);
      CREATE INDEX IF NOT EXISTS idx_bus_to ON bus(to_agent);
    `);
    db.exec(`PRAGMA user_version=1;`);
    v = 1;
  }
  // future: if (v < 2) { ... ; db.exec("PRAGMA user_version=2"); }
}

export function readProfile(): string | null {
  const p = profilePath();
  if (!existsSync(p)) return null;
  try {
    const t = readFileSync(p, "utf8").trim();
    return t.length ? t : null;
  } catch {
    return null;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
