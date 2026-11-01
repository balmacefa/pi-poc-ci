/**
 * Query/write helpers over the memory DB: search (L0), recall (L0/L1),
 * facts (L2), and the agent-to-agent comms bus.
 */
import { getDb, nowIso, coreMirrorPath } from "./db.ts";
import { writeFileSync } from "node:fs";

// ---------- helpers ----------
function ftsQuote(q: string): string {
  // FTS5-safe: quote each bare term, keep it forgiving.
  const terms = q.match(/[\p{L}\p{N}_]+/gu) || [];
  if (!terms.length) return '""';
  return terms.map((t) => `"${t}"`).join(" OR ");
}

// ---------- L0 search ----------
export interface SearchHit {
  session_id: string;
  role: string;
  ts: string;
  snippet: string;
  title: string;
  cwd: string;
  started_at: string;
}
export function searchMessages(query: string, limit = 12): SearchHit[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT m.session_id, m.role, m.ts,
              snippet(msg_fts, 3, '«', '»', ' … ', 12) AS snippet,
              s.title, s.cwd, s.started_at
       FROM msg_fts m LEFT JOIN sessions s ON s.session_id = m.session_id
       WHERE msg_fts MATCH ?
       ORDER BY rank LIMIT ?`,
    )
    .all(ftsQuote(query), limit) as SearchHit[];
  return rows;
}

// ---------- L1 sessions ----------
export interface SessionRow {
  session_id: string;
  file_path: string;
  cwd: string;
  started_at: string;
  ended_at: string;
  model: string;
  msg_count: number;
  user_msg_count: number;
  title: string;
  summary: string;
  files_touched: string;
  tools_used: string;
}
export function recallSession(idOrPrefix: string): SessionRow | null {
  const db = getDb();
  let row = db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(idOrPrefix) as SessionRow | undefined;
  if (!row) row = db.prepare("SELECT * FROM sessions WHERE session_id LIKE ? LIMIT 1").get(idOrPrefix + "%") as SessionRow | undefined;
  return row ?? null;
}
export function setSessionSummary(sessionId: string, summary: string, title?: string): void {
  const db = getDb();
  if (title)
    db.prepare("UPDATE sessions SET summary=?, title=COALESCE(NULLIF(?,''),title) WHERE session_id=?").run(
      summary,
      title,
      sessionId,
    );
  else db.prepare("UPDATE sessions SET summary=? WHERE session_id=?").run(summary, sessionId);
}
export function recentSessions(limit = 10, cwd?: string): SessionRow[] {
  const db = getDb();
  if (cwd)
    return db
      .prepare("SELECT * FROM sessions WHERE cwd = ? ORDER BY started_at DESC LIMIT ?")
      .all(cwd, limit) as SessionRow[];
  return db.prepare("SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?").all(limit) as SessionRow[];
}

// ---------- L2 facts ----------
export interface Fact {
  id: number;
  scope: string;
  category: string;
  key: string;
  content: string;
  source: string;
  weight: number;
  created_at: string;
  updated_at: string;
}
export function writeFact(opts: {
  content: string;
  key?: string;
  scope?: string;
  category?: string;
  source?: string;
}): { id: number; action: "created" | "updated" } {
  const db = getDb();
  const scope = opts.scope || "global";
  const category = opts.category || "note";
  const key = (opts.key || opts.content).replace(/\s+/g, " ").trim().slice(0, 80).toLowerCase();
  const existing = db.prepare("SELECT id FROM facts WHERE scope = ? AND key = ?").get(scope, key) as
    | { id: number }
    | undefined;
  const now = nowIso();
  if (existing) {
    db.prepare("UPDATE facts SET content=?, category=?, source=?, updated_at=?, weight=weight+1 WHERE id=?").run(
      opts.content,
      category,
      opts.source || "",
      now,
      existing.id,
    );
    db.prepare("DELETE FROM facts_fts WHERE fact_id = ?").run(existing.id);
    db.prepare("INSERT INTO facts_fts(content,scope,category,fact_id) VALUES(?,?,?,?)").run(
      opts.content,
      scope,
      category,
      existing.id,
    );
    syncMirror();
    return { id: existing.id, action: "updated" };
  }
  const res = db
    .prepare(
      "INSERT INTO facts(scope,category,key,content,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    )
    .run(scope, category, key, opts.content, opts.source || "", now, now);
  const id = Number(res.lastInsertRowid);
  db.prepare("INSERT INTO facts_fts(content,scope,category,fact_id) VALUES(?,?,?,?)").run(
    opts.content,
    scope,
    category,
    id,
  );
  syncMirror();
  return { id, action: "created" };
}
export function searchFacts(query: string, scope?: string, limit = 20): Fact[] {
  const db = getDb();
  const ids = db
    .prepare("SELECT fact_id FROM facts_fts WHERE facts_fts MATCH ? LIMIT ?")
    .all(ftsQuote(query), limit) as { fact_id: number }[];
  if (!ids.length) return [];
  const list = ids.map((r) => r.fact_id);
  const placeholders = list.map(() => "?").join(",");
  let rows = db.prepare(`SELECT * FROM facts WHERE id IN (${placeholders})`).all(...list) as Fact[];
  if (scope) rows = rows.filter((f) => f.scope === "global" || f.scope === scope);
  return rows;
}
export function factsForContext(scope: string, limit = 25): Fact[] {
  const db = getDb();
  return db
    .prepare(
      "SELECT * FROM facts WHERE scope = 'global' OR scope = ? ORDER BY weight DESC, updated_at DESC LIMIT ?",
    )
    .all(scope, limit) as Fact[];
}
function syncMirror(): void {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM facts ORDER BY scope, category, updated_at DESC").all() as Fact[];
    const lines = ["# L2 Core Memory (mirror — source of truth is memory.db)", ""];
    let curScope = "";
    for (const f of rows) {
      if (f.scope !== curScope) {
        curScope = f.scope;
        lines.push(`\n## scope: ${curScope}\n`);
      }
      lines.push(`- **[${f.category}]** ${f.content}  _(x${f.weight}, ${f.updated_at.slice(0, 10)})_`);
    }
    writeFileSync(coreMirrorPath(), lines.join("\n") + "\n");
  } catch {}
}

// ---------- comms bus ----------
export interface BusMsg {
  id: number;
  channel: string;
  from_agent: string;
  to_agent: string | null;
  session_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}
export function busSend(opts: {
  body: string;
  from: string;
  to?: string;
  channel?: string;
  sessionId?: string;
}): number {
  const db = getDb();
  const res = db
    .prepare(
      "INSERT INTO bus(channel,from_agent,to_agent,session_id,body,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(opts.channel || "general", opts.from, opts.to || null, opts.sessionId || "", opts.body, nowIso());
  return Number(res.lastInsertRowid);
}
export function busInbox(agent: string, opts?: { unreadOnly?: boolean; channel?: string; limit?: number }): BusMsg[] {
  const db = getDb();
  const limit = opts?.limit ?? 25;
  const where = ["(to_agent = ? OR to_agent IS NULL)"];
  const args: any[] = [agent];
  if (opts?.unreadOnly) where.push("read_at IS NULL");
  if (opts?.channel) {
    where.push("channel = ?");
    args.push(opts.channel);
  }
  where.push("from_agent != ?");
  args.push(agent);
  args.push(limit);
  return db
    .prepare(`SELECT * FROM bus WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`)
    .all(...args) as BusMsg[];
}
export function busMarkRead(agent: string, ids?: number[]): number {
  const db = getDb();
  if (ids && ids.length) {
    const ph = ids.map(() => "?").join(",");
    const res = db
      .prepare(`UPDATE bus SET read_at=? WHERE read_at IS NULL AND (to_agent = ? OR to_agent IS NULL) AND id IN (${ph})`)
      .run(nowIso(), agent, ...ids);
    return Number(res.changes);
  }
  const res = db
    .prepare("UPDATE bus SET read_at=? WHERE read_at IS NULL AND (to_agent = ? OR to_agent IS NULL) AND from_agent != ?")
    .run(nowIso(), agent, agent);
  return Number(res.changes);
}
export function busUnreadCount(agent: string): number {
  const db = getDb();
  const r = db
    .prepare("SELECT COUNT(*) c FROM bus WHERE read_at IS NULL AND (to_agent = ? OR to_agent IS NULL) AND from_agent != ?")
    .get(agent, agent) as { c: number };
  return r.c;
}

// ---------- stats ----------
export function stats(): Record<string, any> {
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get() as any) || {};
  return {
    sessions: one("SELECT COUNT(*) n FROM sessions").n,
    messagesIndexed: one("SELECT COUNT(*) n FROM msg_fts").n,
    facts: one("SELECT COUNT(*) n FROM facts").n,
    busMessages: one("SELECT COUNT(*) n FROM bus").n,
    lastReindex: (one("SELECT value FROM meta WHERE key='last_reindex'") as any).value || "never",
  };
}
