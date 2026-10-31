// Path containment checks that follow symlinks (used by the tool_call guard and by cve tools).
import { realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

// Windows paths are case-insensitive, so compare them lowercased there.
const fold = (p: string) => (process.platform === "win32" ? p.toLowerCase() : p);

/** True when `real` is strictly inside `root` (the root itself only counts when allowRoot is set). */
function isInside(root: string, real: string, allowRoot: boolean): boolean {
  const rel = relative(fold(root), fold(real));
  if (rel === "") return allowRoot;
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/**
 * Returns a block message when `target` resolves outside every `<cwd>/<root>` (roots: "" means the project).
 * Symlinks are followed, and a root that is itself a symlink leaving the project is rejected.
 */
export function checkInside(cwd: string, roots: string[], target: string, rule: string): string | undefined {
  const projectReal = realpathOfNearestAncestor(resolve(cwd));
  const real = realpathOfNearestAncestor(resolve(cwd, target));
  for (const root of roots) {
    const rootReal = realpathOfNearestAncestor(resolve(cwd, root));
    if (!isInside(projectReal, rootReal, true)) continue;
    // Writing to the root directory itself is never allowed; reading the project root (root "") is.
    if (isInside(rootReal, real, root === "")) return undefined;
  }
  return `ci-guard: ${rule} (got ${target})`;
}

/** Resolves a path through symlinks even when the tail does not exist yet, by resolving the nearest existing ancestor. */
export function realpathOfNearestAncestor(path: string): string {
  let existing = path;
  const missing: string[] = [];
  while (true) {
    try {
      return resolve(realpathSync(existing), ...missing.reverse());
    } catch {
      missing.push(existing.slice(dirname(existing).length + 1));
      const parent = dirname(existing);
      if (parent === existing) return path;
      existing = parent;
    }
  }
}
