// Parses package.json dependencies into exactly pinned npm packages.

export interface PinnedPackage {
  name: string;
  version: string;
}

export interface ParsedDeps {
  packages: PinnedPackage[];
  /** Entries whose version is not an exact pin (ranges, tags, urls). */
  skipped: { name: string; spec: string }[];
}

const EXACT_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/** Reads dependencies and devDependencies, strips a leading ^ or ~, and keeps only exact versions. */
export function parseDeps(packageJsonText: string): ParsedDeps {
  const json: unknown = JSON.parse(packageJsonText);
  const packages: PinnedPackage[] = [];
  const skipped: { name: string; spec: string }[] = [];
  const seen = new Set<string>();
  if (typeof json !== "object" || json === null) return { packages, skipped };
  for (const section of ["dependencies", "devDependencies"] as const) {
    const deps = (json as Record<string, unknown>)[section];
    if (typeof deps !== "object" || deps === null) continue;
    for (const [name, spec] of Object.entries(deps)) {
      const version = typeof spec === "string" ? spec.trim().replace(/^[\^~]/, "") : "";
      if (!EXACT_RE.test(version)) {
        skipped.push({ name, spec: String(spec) });
        continue;
      }
      if (seen.has(`${name}@${version}`)) continue;
      seen.add(`${name}@${version}`);
      packages.push({ name, version });
    }
  }
  return { packages, skipped };
}
