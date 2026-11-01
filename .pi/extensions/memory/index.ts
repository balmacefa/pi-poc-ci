/**
 * memory — tiered long-term memory + agent-to-agent comms bus for pi.
 * =============================================================================
 * Levels:  L0 raw sessions (searchable) · L1 episodic · L2 core facts · L3 profile
 * Comms:   a persistent mailbox other pi threads/sessions read & write.
 *
 * On startup it catches up the index over all existing sessions, then injects
 * your L3 profile + top L2 facts + unread-bus count into context once per
 * session. Tools let the model search/recall/remember and talk to other agents.
 *
 * Location: ~/.pi/agent/extensions/memory/  (auto-discovered). /reload to apply.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { agentName, closeDb } from "./db.ts";
import { readProfile } from "./db.ts";
import { reindex } from "./indexer.ts";
import {
  searchMessages,
  recallSession,
  recentSessions,
  writeFact,
  searchFacts,
  factsForContext,
  busSend,
  busInbox,
  busMarkRead,
  busUnreadCount,
  setSessionSummary,
  stats,
} from "./store.ts";

// ---- helpers for LLM digest ----
function entriesToText(entries: any[]): string {
  const out: string[] = [];
  for (const e of entries) {
    const m = e?.message;
    if (!m || m.role === "system") continue;
    const c = m.content;
    let text = "";
    if (typeof c === "string") text = c;
    else if (Array.isArray(c))
      text = c
        .map((b: any) =>
          b?.type === "text"
            ? b.text
            : b?.type === "tool_use"
              ? `[tool:${b.name}]`
              : b?.type === "tool_result"
                ? "[result]"
                : "",
        )
        .join(" ")
        .trim();
    if (text) out.push(`${m.role.toUpperCase()}: ${text}`);
  }
  return out.join("\n").slice(0, 24000);
}

const DIGEST_PROMPT = (convo: string) =>
  `You distill a coding/PM session into durable memory. Return ONLY minified JSON:
{"summary":"<=3 sentence recap of goal, decisions, outcome","facts":[{"category":"preference|convention|project|person|chore|note","content":"self-contained durable fact worth remembering for months","key":"short-dedupe-key"}]}
Include 0-6 facts; only things clearly durable (stable preferences, decisions, conventions, project details, recurring chores). Skip one-off chatter. No prose outside the JSON.

SESSION:
${convo}`;

function parseDigest(raw: string): { summary?: string; facts?: any[] } {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s < 0 || e < 0) return {};
  try {
    return JSON.parse(raw.slice(s, e + 1));
  } catch {
    return {};
  }
}

export default async function (pi: ExtensionAPI) {
  const ME = agentName();
  const injected = new Set<string>();

  // --- startup: catch-up index (bounded, never blocks the session fatally) ---
  try {
    const r = reindex(false);
    if (r.indexed > 0) {
      pi.on("session_start", async (_e, ctx) => {
        ctx.ui.notify(`memory: indexed ${r.indexed} session(s), ${r.skipped} up-to-date`, "info");
      });
    }
  } catch (e: any) {
    // degrade gracefully — memory tools will still try per-call.
    console.error("[memory] initial reindex failed:", e?.message);
  }

  // --- inject memory context once per session ---
  pi.on("before_agent_start", async (event: any, ctx: any) => {
    try {
      const sid = ctx.sessionManager?.getSessionId?.() || "ephemeral";
      if (injected.has(sid)) return;
      injected.add(sid);
      const cwd = ctx.cwd || process.cwd();
      const parts: string[] = [];
      const profile = readProfile();
      if (profile) parts.push("## Long-term profile (L3)\n" + profile);
      const facts = factsForContext(cwd, 20);
      if (facts.length)
        parts.push(
          "## Core memory (L2)\n" +
            facts.map((f) => `- [${f.category}] ${f.content}`).join("\n"),
        );
      const unread = busUnreadCount(ME);
      const hints = [
        `You have a persistent cross-session memory. Agent id: ${ME}.`,
        `Use memory_search (past conversations), memory_recall (a session), memory_remember (save a durable fact).`,
        unread > 0
          ? `You have ${unread} unread message(s) on the agent bus — call bus_inbox to read them.`
          : `Use bus_send / bus_inbox to coordinate with other pi threads.`,
      ];
      parts.push("## Memory system\n" + hints.join("\n"));
      if (!parts.length) return;
      return { systemPrompt: event.systemPrompt + "\n\n" + parts.join("\n\n") };
    } catch (e: any) {
      console.error("[memory] inject failed:", e?.message);
    }
  });

  // --- automatic freshness: index the current (growing) session promptly ---
  pi.on("session_compact", async () => {
    try {
      reindex(false);
    } catch {}
  });
  pi.on("session_shutdown", async () => {
    try {
      reindex(false);
    } catch {}
    // keep db across reloads; close only to flush WAL safely
    try {
      closeDb();
    } catch {}
  });

  // --- shared digest routine (LLM summary + candidate L2 facts) ---
  async function runDigest(ctx: any): Promise<string> {
    const sid = ctx.sessionManager?.getSessionId?.();
    if (!sid) return "No active session to digest.";
    const entries = ctx.sessionManager.buildContextEntries?.() || ctx.sessionManager.getBranch?.() || [];
    const convo = entriesToText(entries);
    if (convo.trim().length < 80) return "Session too short to digest.";
    // pick model: env override "provider/modelId" else active model
    let model = ctx.model;
    const envModel = process.env.MEMORY_CAPTURE_MODEL;
    if (envModel && envModel.includes("/")) {
      const [prov, ...rest] = envModel.split("/");
      const m = ctx.modelRegistry.find(prov, rest.join("/"));
      if (m) model = m;
    }
    if (!model) return "No model available for digest.";
    if (ctx.modelRegistry.hasConfiguredAuth && !ctx.modelRegistry.hasConfiguredAuth(model))
      return `No auth configured for ${model.provider}/${model.id}.`;
    reindex(false); // make sure the session row exists
    const resp = await ctx.modelRegistry.complete(
      model,
      { messages: [{ role: "user", content: [{ type: "text", text: DIGEST_PROMPT(convo) }], timestamp: Date.now() }] },
      { cacheRetention: "none" },
    );
    const raw = (resp.content || [])
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
    const d = parseDigest(raw);
    let saved = 0;
    if (d.summary) setSessionSummary(sid, d.summary);
    if (Array.isArray(d.facts))
      for (const f of d.facts) {
        if (f && f.content) {
          writeFact({ content: f.content, category: f.category, key: f.key, scope: "global", source: `digest:${sid}` });
          saved++;
        }
      }
    return `Digest done: summary ${d.summary ? "saved" : "—"}, ${saved} fact(s) captured.`;
  }

  // ------------------------------------------------------------------ tools --
  pi.registerTool({
    name: "memory_search",
    label: "Memory: search",
    description:
      "Full-text search across ALL past pi conversations (every session). Returns matching snippets with session ids you can recall.",
    parameters: Type.Object({
      query: Type.String({ description: "Keywords to search for across past sessions" }),
      limit: Type.Optional(Type.Number({ description: "Max hits (default 12)" })),
    }),
    async execute(_id, p: any) {
      const hits = searchMessages(p.query, p.limit ?? 12);
      if (!hits.length) return { content: [{ type: "text", text: `No matches for "${p.query}".` }], details: {} };
      const text = hits
        .map(
          (h) =>
            `• [${h.started_at?.slice(0, 10) || "?"}] session ${h.session_id?.slice(0, 8)} (${h.role})\n  ${h.title || h.cwd}\n  ${h.snippet}`,
        )
        .join("\n");
      return { content: [{ type: "text", text }], details: { count: hits.length } };
    },
  });

  pi.registerTool({
    name: "memory_recall",
    label: "Memory: recall session",
    description:
      "Recall the L1 summary of a specific past session by id/prefix, or list recent sessions when no id is given.",
    parameters: Type.Object({
      session_id: Type.Optional(Type.String({ description: "Session id or prefix" })),
      scope_cwd: Type.Optional(Type.String({ description: "Filter recent list to this working dir" })),
      limit: Type.Optional(Type.Number()),
    }),
    async execute(_id, p: any) {
      if (p.session_id) {
        const s = recallSession(p.session_id);
        if (!s) return { content: [{ type: "text", text: `No session matching "${p.session_id}".` }], details: {} };
        const text =
          `Session ${s.session_id} (${s.started_at?.slice(0, 16)})\ncwd: ${s.cwd}\nmodel: ${s.model}\n` +
          `messages: ${s.msg_count}\ntitle: ${s.title}\n\nSummary: ${s.summary}\n\nfile: ${s.file_path}`;
        return { content: [{ type: "text", text }], details: {} };
      }
      const list = recentSessions(p.limit ?? 10, p.scope_cwd);
      const text = list
        .map((s) => `• ${s.session_id.slice(0, 8)} [${s.started_at?.slice(0, 10)}] ${s.title || "(untitled)"}`)
        .join("\n");
      return { content: [{ type: "text", text: text || "No sessions indexed yet." }], details: {} };
    },
  });

  pi.registerTool({
    name: "memory_remember",
    label: "Memory: remember",
    description:
      "Save a DURABLE fact to core memory (L2): a preference, convention, project detail, person, or recurring chore. Deduped by key; auto-surfaced in future sessions.",
    parameters: Type.Object({
      content: Type.String({ description: "The fact to remember, phrased to stand alone" }),
      category: Type.Optional(
        Type.String({ description: "preference|convention|project|person|chore|note (default note)" }),
      ),
      key: Type.Optional(Type.String({ description: "Short dedupe key; defaults to the content" })),
      scope: Type.Optional(Type.String({ description: "'global' (default) or a working-dir path for project-scoped" })),
    }),
    async execute(_id, p: any, _s, _u, ctx: any) {
      const r = writeFact({
        content: p.content,
        category: p.category,
        key: p.key,
        scope: p.scope,
        source: ctx?.sessionManager?.getSessionId?.() || "",
      });
      return { content: [{ type: "text", text: `Fact ${r.action} (#${r.id}).` }], details: r };
    },
  });

  pi.registerTool({
    name: "memory_recall_facts",
    label: "Memory: recall facts",
    description: "Search durable core memory (L2) facts by keyword.",
    parameters: Type.Object({
      query: Type.String(),
      scope: Type.Optional(Type.String()),
    }),
    async execute(_id, p: any) {
      const rows = searchFacts(p.query, p.scope);
      const text = rows.length
        ? rows.map((f) => `- [${f.category}/${f.scope}] ${f.content}`).join("\n")
        : `No facts matching "${p.query}".`;
      return { content: [{ type: "text", text }], details: { count: rows.length } };
    },
  });

  // --- agent-to-agent comms bus ---
  pi.registerTool({
    name: "bus_send",
    label: "Bus: send",
    description:
      "Send a message to another pi thread/agent (or broadcast). Persists across sessions; recipients read it with bus_inbox. For compact hand-offs consider PACT encoding.",
    parameters: Type.Object({
      body: Type.String({ description: "Message / task hand-off" }),
      to: Type.Optional(Type.String({ description: "Target agent id (omit to broadcast)" })),
      channel: Type.Optional(Type.String({ description: "Channel name (default 'general')" })),
    }),
    async execute(_id, p: any, _s, _u, ctx: any) {
      const mid = busSend({
        body: p.body,
        from: ME,
        to: p.to,
        channel: p.channel,
        sessionId: ctx?.sessionManager?.getSessionId?.() || "",
      });
      return { content: [{ type: "text", text: `Sent (#${mid}) from ${ME}${p.to ? " to " + p.to : " (broadcast)"}.` }], details: { id: mid } };
    },
  });

  pi.registerTool({
    name: "bus_inbox",
    label: "Bus: inbox",
    description: "Read messages addressed to this agent (or broadcast). Marks them read unless peek=true.",
    parameters: Type.Object({
      unread_only: Type.Optional(Type.Boolean()),
      channel: Type.Optional(Type.String()),
      peek: Type.Optional(Type.Boolean({ description: "Do not mark as read" })),
      limit: Type.Optional(Type.Number()),
    }),
    async execute(_id, p: any) {
      const msgs = busInbox(ME, { unreadOnly: p.unread_only, channel: p.channel, limit: p.limit });
      if (!p.peek && msgs.length) busMarkRead(ME, msgs.map((m) => m.id));
      const text = msgs.length
        ? msgs
            .map(
              (m) =>
                `#${m.id} [${m.channel}] ${m.from_agent} → ${m.to_agent || "all"} (${m.created_at.slice(0, 16)})\n  ${m.body}`,
            )
            .join("\n")
        : "Inbox empty.";
      return { content: [{ type: "text", text }], details: { count: msgs.length } };
    },
  });

  pi.registerTool({
    name: "memory_digest",
    label: "Memory: digest session",
    description:
      "Summarize the CURRENT session with the model and capture durable facts (L2). Call at a milestone or before ending work. Uses MEMORY_CAPTURE_MODEL if set, else the active model.",
    parameters: Type.Object({}),
    async execute(_id, _p, _s, _u, ctx: any) {
      const msg = await runDigest(ctx);
      return { content: [{ type: "text", text: msg }], details: {} };
    },
  });

  // ---------------------------------------------------------------- commands --
  pi.registerCommand("memory-digest", {
    description: "LLM-summarize this session and capture durable facts",
    handler: async (_args, ctx) => {
      ctx.ui.notify("memory: digesting\u2026", "info");
      try {
        ctx.ui.notify(await runDigest(ctx), "info");
      } catch (e: any) {
        ctx.ui.notify(`digest failed: ${e?.message}`, "error");
      }
    },
  });

  pi.registerCommand("memory", {
    description: "Show memory system stats",
    handler: async (_args, ctx) => {
      const s = stats();
      ctx.ui.notify(
        `memory: ${s.sessions} sessions · ${s.messagesIndexed} msgs · ${s.facts} facts · ${s.busMessages} bus msgs · last reindex ${String(s.lastReindex).slice(0, 16)}`,
        "info",
      );
    },
  });

  pi.registerCommand("remember", {
    description: "Save a durable fact to core memory (L2)",
    handler: async (args, ctx) => {
      if (!args?.trim()) return ctx.ui.notify("Usage: /remember <fact>", "warn");
      const r = writeFact({ content: args.trim(), category: "note", source: "/remember" });
      ctx.ui.notify(`Remembered (#${r.id}, ${r.action}).`, "info");
    },
  });

  pi.registerCommand("recall", {
    description: "Search past sessions (keyword)",
    handler: async (args, ctx) => {
      if (!args?.trim()) return ctx.ui.notify("Usage: /recall <keywords>", "warn");
      const hits = searchMessages(args.trim(), 6);
      if (!hits.length) return ctx.ui.notify(`No matches for "${args}".`, "info");
      ctx.ui.notify(
        hits
          .map((h) => `[${h.started_at?.slice(0, 10)}] ${h.session_id?.slice(0, 8)}: ${h.title || h.snippet}`)
          .join("\n"),
        "info",
      );
    },
  });

  pi.registerCommand("reindex", {
    description: "Force a full memory reindex of all sessions",
    handler: async (_args, ctx) => {
      const r = reindex(true);
      ctx.ui.notify(`Reindexed ${r.indexed}/${r.scanned} sessions.`, "info");
    },
  });
}
