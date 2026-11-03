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

/** Parses package-lock.json (lockfileVersion 2 or 3) and extracts resolved versions from the packages object. */
export function parseLock(packageLockText: string): PinnedPackage[] {
  const json: unknown = JSON.parse(packageLockText);
  const packages: PinnedPackage[] = [];
  const seen = new Set<string>();
  if (typeof json !== "object" || json === null) return packages;
  const pkgs = (json as Record<string, unknown>).packages;
  if (typeof pkgs !== "object" || pkgs === null) return packages;
  for (const [key, pkg] of Object.entries(pkgs)) {
    if (key === "") continue; // skip root
    if (!key.startsWith("node_modules/")) continue;
    const name = key.replace(/^node_modules\//, "");
    if (typeof pkg !== "object" || pkg === null) continue;
    const version = (pkg as Record<string, unknown>).version;
    if (typeof version !== "string") continue;
    const id = `${name}@${version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    packages.push({ name, version });
  }
  return packages;
}

/** Combines parseDeps and parseLock, deduplicating by name@version. */
export function collectPinned(packageJsonText: string, packageLockText?: string): ParsedDeps {
  const fromJson = parseDeps(packageJsonText);
  if (!packageLockText) return fromJson;
  const fromLock = parseLock(packageLockText);
  const seen = new Set(fromJson.packages.map(p => `${p.name}@${p.version}`));
  for (const p of fromLock) {
    const id = `${p.name}@${p.version}`;
    if (!seen.has(id)) {
      fromJson.packages.push(p);
      seen.add(id);
    }
  }
  return fromJson;
}

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
