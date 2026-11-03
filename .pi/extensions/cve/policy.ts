// Mode policy: which tools are allowed in which CVE mode (pure, no filesystem access).
import { branchFor, normalizeAdvisoryId } from "./ids.ts";

export type Mode = "default" | "investigate" | "patch" | "invalid";

export interface Decision {
  block: boolean;
  reason?: string;
}

const PATCH_ONLY = new Set(["cve_branch", "cve_commit_push"]);
const CVE_TOOLS = new Set(["cve_scan", "cve_details", "cve_prior_fixes", "cve_report", ...PATCH_ONLY]);
const SHELL_TOOLS = new Set(["bash", "powershell"]);

/** Maps the --cve-mode flag value to a mode; unknown values become "invalid" (everything mutating is blocked). */
export function parseMode(flag: unknown): Mode {
  if (flag === undefined || flag === false || flag === "") return "default";
  if (flag === "investigate" || flag === "patch") return flag;
  return "invalid";
}

/**
 * Resolves the effective mode: the explicit --cve-mode flag wins; if absent, falls back to the
 * PI_CVE_MODE env var. This is how the mode is propagated to spawned subagents (the subagent-cve
 * hook sets PI_CVE_MODE=patch before a subagent spawns, so the child pi inherits patch mode and can
 * use cve_branch / cve_commit_push and write under targets/). The flag always overrides the env.
 */
export function resolveMode(flag: unknown, env?: string): Mode {
  const hasFlag = !(flag === undefined || flag === false || flag === "");
  return parseMode(hasFlag ? flag : env);
}

/** Directories (relative to the project) where edit/write are allowed in a mode. */
export function writeRoots(mode: Mode): string[] {
  switch (mode) {
    case "default":
      // Guards re-endurecidos: default ahora limita a targets/ + reports/ (igual que patch).
      // Para propagar --cve-mode a subagentes ver DEUDA más abajo.
      return ["targets", "reports"];
    case "investigate":
      return ["reports"];
    case "patch":
      return ["targets", "reports"];
    case "invalid":
      return [];
  }
}

/** Decides whether a tool call is allowed in a mode. Path containment for edit/write is checked separately. */
export function decide(mode: Mode, toolName: string, input: Record<string, unknown>): Decision {
  const deny = (reason: string): Decision => ({ block: true, reason: `ci-guard: ${reason}` });
  if (mode === "invalid") {
    if (toolName === "edit" || toolName === "write" || SHELL_TOOLS.has(toolName) || CVE_TOOLS.has(toolName)) {
      return deny("invalid --cve-mode value (use investigate or patch); mutating tools are blocked");
    }
    return { block: false };
  }
  // PATCH_ONLY tools are blocked outside patch mode (including default).
  if (PATCH_ONLY.has(toolName)) {
    if (mode !== "patch") return deny(`${toolName} is only allowed in patch mode`);
    if (branchFor(input.id) === undefined) {
      return deny(`invalid id for branch (need cve/CVE-YYYY-NNNN or cve/GHSA-...), got ${JSON.stringify(input.id)}`);
    }
    if (toolName === "cve_commit_push" && (typeof input.message !== "string" || input.message.trim() === "")) {
      return deny("cve_commit_push needs a non-empty commit message");
    }
    return { block: false };
  }
  if (mode === "default") {
    // Se permiten herramientas cve_* READ-ONLY en modo default para subagentes.
    // writeRoots ya está restringido a targets/+reports/.
    return { block: false };
  }
  if (SHELL_TOOLS.has(toolName)) return deny(`${toolName} is not allowed in ${mode} mode`);
  if ((toolName === "cve_details" || toolName === "cve_report") && normalizeAdvisoryId(input.id) === undefined) {
    return deny(`invalid advisory id ${JSON.stringify(input.id)}`);
  }
  return { block: false };
}
