// CI guard extension: mode-dependent write roots (--cve-mode), read limits, audit log, ci_status and cve_* tools.
// Assumes bash/powershell stay disabled in CI (see defaultTools); in cve modes they are also blocked here.
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { type ExtensionAPI, isToolCallEventType } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerCveTools } from "./cve/register.ts";
import { checkInside } from "./cve/fsguard.ts";
import { decide, parseMode, writeRoots } from "./cve/policy.ts";

export default function (pi: ExtensionAPI) {
  // API: registerFlag(name, { type: "string" }) here, read with getFlag(name) at call time (CLI: --cve-mode <value>).
  pi.registerFlag("cve-mode", {
    description: "CVE workflow mode: investigate (read-only, reports/ only) or patch (targets/ + reports/, git tools)",
    type: "string",
  });

  pi.on("tool_call", async (event, ctx) => {
    const mode = parseMode(pi.getFlag("cve-mode"));
    const input = event.input as Record<string, unknown>;
    let blockReason: string | undefined = decide(mode, event.toolName, input).reason;

    if (blockReason === undefined) {
      if (isToolCallEventType("write", event) || isToolCallEventType("edit", event)) {
        const roots = writeRoots(mode);
        const rule = `writes are only allowed under ${roots.map((r) => `${r}/`).join(", ") || "(nowhere)"}`;
        blockReason = typeof event.input.path === "string" ? checkInside(ctx.cwd, roots, event.input.path, rule) : `ci-guard: ${rule}`;
      } else if (
        isToolCallEventType("read", event) ||
        isToolCallEventType("grep", event) ||
        isToolCallEventType("find", event) ||
        isToolCallEventType("ls", event)
      ) {
        // grep/find/ls take an optional path; without one they run in the project root.
        if (event.input.path) blockReason = checkInside(ctx.cwd, [""], event.input.path, "reads are limited to the project");
      }
    }

    audit(ctx.cwd, event.toolName, input, blockReason);
    if (blockReason) return { block: true, reason: blockReason };
  });

  pi.registerTool({
    name: "ci_status",
    label: "CI status",
    description: "Return the CI environment: provider, branch and commit, read from environment variables.",
    parameters: Type.Object({}),
    async execute() {
      const env = process.env;
      const info = {
        provider: env.GITHUB_ACTIONS ? "github-actions" : env.GITLAB_CI ? "gitlab-ci" : "local",
        branch: env.GITHUB_REF_NAME ?? env.CI_COMMIT_REF_NAME ?? "unknown",
        commit: env.GITHUB_SHA ?? env.CI_COMMIT_SHA ?? "unknown",
      };
      return { content: [{ type: "text", text: JSON.stringify(info) }], details: info };
    },
  });

  registerCveTools(pi);
}

// One JSON line per tool call. Records the tool and the path/command only, never file contents.
function audit(cwd: string, tool: string, input: Record<string, unknown>, blockReason: string | undefined) {
  try {
    const summary = { path: input.path, command: input.command, id: input.id };
    appendFileSync(
      resolve(cwd, ".pi", "ci-audit.jsonl"),
      `${JSON.stringify({ at: new Date().toISOString(), tool, ...summary, blocked: blockReason !== undefined })}\n`,
    );
  } catch {
    // Auditing must never break the run.
  }
}
