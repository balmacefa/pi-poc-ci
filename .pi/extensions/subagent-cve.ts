// Propagates CVE patch mode to spawned subagents.
//
// Problem: the native `subagent` tool spawns a child `pi` process WITHOUT the --cve-mode flag, so the
// child would run in "default" mode. In default mode the git tools cve_branch / cve_commit_push are
// BLOCKED, so a cve-fixer subagent could not create its cve/<id> branch nor commit+push its fix.
//
// Fix: before a `subagent` tool call runs, set PI_CVE_MODE=patch on this process's environment. Child
// processes spawned by the subagent tool inherit the parent environment, so the child pi's ci-guard
// resolves the mode from PI_CVE_MODE (see cve/policy.ts resolveMode) and runs in patch mode: writes are
// restricted to targets/ + reports/ and the git patch tools are allowed. The explicit --cve-mode flag,
// when present, always overrides this env fallback.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    if (event.toolName !== "subagent") return;
    // Spawned subagents inherit this; set it so the child pi runs in patch mode.
    process.env.PI_CVE_MODE = "patch";
  });
}
