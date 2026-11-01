/**
 * Indexer — scans session JSONL (L0) and populates msg_fts + sessions (L1).
 * Incremental: skips files whose size+mtime are unchanged since last index.
 * Pure/deterministic (no LLM): L1 summaries are extractive. LLM summaries can
 * be layered later without changing the schema.
 */
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { getDb, sessionsRoot, nowIso } from "./db.ts";

interface Parsed {
  sessionId: string;
  cwd: string;
  startedAt: string;
  endedAt: string;
  model: string;
  msgCount: number;
  userMsgCount: number;
  title: string;
  summary: string;
  filesTouched: string[];
  toolsUsed: Record<string, number>;
  rows: { role: string; ts: string; body: string }[];
}

function blockText(c: any): { text: string; tools: Record<string, number>; files: string[] } {
  const tools: Record<string, number> = {};
  const files: string[] = [];
  if (typeof c === "string") return { text: c, tools, files };
  if (!Array.isArray(c)) return { text: "", tools, files };
  const parts: string[] = [];
  for (const b of c) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
    else if (b.type === "tool_use") {
      const name = String(b.name || "tool");
      tools[name] = (tools[name] || 0) + 1;
      const p = b.input && (b.input.path || b.input.file || b.input.filename);
      if (p) files.push(String(p));
      const cmd = b.input && b.input.command;
      parts.push(`[tool:${name}${cmd ? " " + String(cmd).slice(0, 120) : p ? " " + p : ""}]`);
    } else if (b.type === "tool_result") {
      const r = b.content;
      if (typeof r === "string") parts.push(r.slice(0, 500));
      else if (Array.isArray(r))
        parts.push(
          r
            .map((x: any) => (x && x.type === "text" ? x.text : ""))
            .join(" ")
            .slice(0, 500),
        );
    }
  }
  return { text: parts.join("\n").trim(), tools, files };
}

function parseFile(path: string): Parsed | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return null;

  let sessionId = "";
  let cwd = "";
  let startedAt = "";
  let endedAt = "";
  let model = "";
  let msgCount = 0;
  let userMsgCount = 0;
  let title = "";
  const filesSet = new Set<string>();
  const toolsUsed: Record<string, number> = {};
  const rows: Parsed["rows"] = [];
  let lastAssistant = "";

  for (const line of lines) {
    let e: any;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.type === "session") {
      sessionId = e.id || sessionId;
      cwd = e.cwd || cwd;
      startedAt = e.timestamp || startedAt;
      continue;
    }
    if (e.type === "model_change") {
      model = e.modelId || model;
      continue;
    }
    if (e.type === "message" && e.message) {
      const m = e.message;
      const role = m.role || "unknown";
      if (role === "system") continue;
      const { text, tools, files } = blockText(m.content);
      for (const [k, v] of Object.entries(tools)) toolsUsed[k] = (toolsUsed[k] || 0) + v;
      for (const f of files) filesSet.add(f);
      if (text) {
        msgCount++;
        const ts = e.timestamp || "";
        if (ts) endedAt = ts;
        rows.push({ role, ts, body: text });
        if (role === "user") {
          userMsgCount++;
          if (!title) title = text.replace(/\s+/g, " ").trim().slice(0, 140);
        }
        if (role === "assistant") lastAssistant = text;
      }
    }
  }

  if (!sessionId) return null;

  const files = [...filesSet];
  const toolSummary = Object.entries(toolsUsed)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}×${v}`)
    .join(", ");
  const summary = [
    title ? `Goal: ${title}` : null,
    `Turns: ${userMsgCount} user / ${msgCount} total.`,
    toolSummary ? `Tools: ${toolSummary}.` : null,
    files.length ? `Files: ${files.slice(0, 12).join(", ")}${files.length > 12 ? " …" : ""}.` : null,
    lastAssistant ? `Last: ${lastAssistant.replace(/\s+/g, " ").trim().slice(0, 200)}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    sessionId,
    cwd,
    startedAt,
    endedAt,
    model,
    msgCount,
    userMsgCount,
    title,
    summary,
    filesTouched: files,
    toolsUsed,
    rows,
  };
}

function listSessionFiles(root: string): string[] {
  const out: string[] = [];
  let dirs: string[];
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => join(root, d.name));
  } catch {
    return out;
  }
  for (const d of dirs) {
    let files: string[];
    try {
      files = readdirSync(d).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) out.push(join(d, f));
  }
  return out;
}

/** Index a single file (always re-reads). Returns true if it wrote anything. */
function indexFile(db: DatabaseSync, path: string): boolean {
  const p = parseFile(path);
  if (!p) return false;
  // Remove stale fts rows for this session, then re-insert (files are append-only).
  db.prepare("DELETE FROM msg_fts WHERE session_id = ?").run(p.sessionId);
  const insFts = db.prepare("INSERT INTO msg_fts(session_id, role, ts, body) VALUES (?,?,?,?)");
  for (const r of p.rows) insFts.run(p.sessionId, r.role, r.ts, r.body);

  let size = 0;
  let mtime = 0;
  try {
    const st = statSync(path);
    size = st.size;
    mtime = st.mtimeMs;
  } catch {}

  db.prepare(
    `INSERT INTO sessions(session_id,file_path,cwd,started_at,ended_at,model,msg_count,user_msg_count,title,summary,files_touched,tools_used,file_size,file_mtime,indexed_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(session_id) DO UPDATE SET
       file_path=excluded.file_path, cwd=excluded.cwd, started_at=excluded.started_at,
       ended_at=excluded.ended_at, model=excluded.model, msg_count=excluded.msg_count,
       user_msg_count=excluded.user_msg_count, title=excluded.title, summary=excluded.summary,
       files_touched=excluded.files_touched, tools_used=excluded.tools_used,
       file_size=excluded.file_size, file_mtime=excluded.file_mtime, indexed_at=excluded.indexed_at`,
  ).run(
    p.sessionId,
    path,
    p.cwd,
    p.startedAt,
    p.endedAt,
    p.model,
    p.msgCount,
    p.userMsgCount,
    p.title,
    p.summary,
    JSON.stringify(p.filesTouched),
    JSON.stringify(p.toolsUsed),
    size,
    mtime,
    nowIso(),
  );
  return true;
}

export interface IndexResult {
  scanned: number;
  indexed: number;
  skipped: number;
}

/** Catch-up index. Incremental unless force=true. */
export function reindex(force = false): IndexResult {
  const db = getDb();
  const files = listSessionFiles(sessionsRoot());
  let indexed = 0;
  let skipped = 0;
  const getMeta = db.prepare("SELECT file_size, file_mtime FROM sessions WHERE file_path = ?");
  db.exec("BEGIN");
  try {
    for (const f of files) {
      if (!force) {
        try {
          const st = statSync(f);
          const prev = getMeta.get(f) as { file_size: number; file_mtime: number } | undefined;
          if (prev && prev.file_size === st.size && Math.abs(prev.file_mtime - st.mtimeMs) < 1) {
            skipped++;
            continue;
          }
        } catch {}
      }
      if (indexFile(db, f)) indexed++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  db.prepare("INSERT INTO meta(key,value) VALUES('last_reindex',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(
    nowIso(),
  );
  return { scanned: files.length, indexed, skipped };
}
