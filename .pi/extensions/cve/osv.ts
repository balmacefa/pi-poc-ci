// Pure OSV helpers: batch query payload, batch response mapping and vulnerability summaries.
import type { PinnedPackage } from "./deps.ts";

export interface ScanResult {
  name: string;
  version: string;
  vulnIds: string[];
}

export interface AffectedSummary {
  package: string;
  ecosystem: string;
  ranges: string[];
  fixed: string[];
  gitFixed: string[];
}

export interface VulnSummary {
  id: string;
  aliases: string[];
  summary: string;
  severity: { type: string; score: string }[];
  databaseSeverity?: string;
  published?: string;
  affected: AffectedSummary[];
  /** Fixed package versions (SEMVER/ECOSYSTEM ranges only). */
  fixedVersions: string[];
  /** Fix commits from GIT ranges. */
  fixedCommits: string[];
  references: string[];
}

type Json = Record<string, any>;

/** Builds the body for POST /v1/querybatch (npm ecosystem). */
export function buildBatchPayload(packages: PinnedPackage[]) {
  return {
    queries: packages.map((p) => ({ package: { name: p.name, ecosystem: "npm" }, version: p.version })),
  };
}

/** Maps the querybatch response (same order as the queries) to per-package vulnerability ids. */
export function parseBatchResponse(packages: PinnedPackage[], response: unknown): ScanResult[] {
  const results = (response as { results?: { vulns?: { id?: unknown }[] }[] } | null)?.results;
  if (!Array.isArray(results) || results.length !== packages.length) {
    throw new Error("unexpected OSV querybatch response shape");
  }
  return packages.map((p, i) => ({
    name: p.name,
    version: p.version,
    vulnIds: (results[i]?.vulns ?? []).map((v) => v.id).filter((id): id is string => typeof id === "string"),
  }));
}

/** Reduces a raw OSV vulnerability record to the fields the agent needs, including fixed versions. */
export function summarizeVuln(raw: unknown): VulnSummary {
  const r = (raw ?? {}) as Json;
  const affected = (Array.isArray(r.affected) ? r.affected : []).map(summarizeAffected);
  const fixedVersions = [...new Set<string>(affected.flatMap((a: AffectedSummary) => a.fixed))];
  const fixedCommits = [...new Set<string>(affected.flatMap((a: AffectedSummary) => a.gitFixed))];
  return {
    id: String(r.id ?? ""),
    aliases: Array.isArray(r.aliases) ? r.aliases.map(String) : [],
    summary: String(r.summary ?? ""),
    severity: (Array.isArray(r.severity) ? r.severity : []).map((s: Json) => ({
      type: String(s?.type ?? ""),
      score: String(s?.score ?? ""),
    })),
    databaseSeverity: typeof r.database_specific?.severity === "string" ? r.database_specific.severity : undefined,
    published: typeof r.published === "string" ? r.published : undefined,
    affected,
    fixedVersions,
    fixedCommits,
    references: (Array.isArray(r.references) ? r.references : [])
      .map((x: Json) => x?.url)
      .filter((u: unknown): u is string => typeof u === "string"),
  };
}

// Turns OSV range events (introduced/fixed/last_affected) into readable ranges plus the fixed versions.
function summarizeAffected(a: Json): AffectedSummary {
  const ranges: string[] = [];
  const fixed: string[] = [];
  const gitFixed: string[] = [];
  for (const range of Array.isArray(a?.ranges) ? a.ranges : []) {
    let introduced: string | undefined;
    for (const ev of Array.isArray(range?.events) ? range.events : []) {
      if (ev.introduced !== undefined) introduced = String(ev.introduced);
      if (ev.fixed !== undefined) {
        (range.type === "GIT" ? gitFixed : fixed).push(String(ev.fixed));
        ranges.push(`>=${introduced ?? "0"} <${ev.fixed}`);
        introduced = undefined;
      }
      if (ev.last_affected !== undefined) {
        ranges.push(`>=${introduced ?? "0"} <=${ev.last_affected}`);
        introduced = undefined;
      }
    }
    if (introduced !== undefined) ranges.push(`>=${introduced}`);
  }
  return { package: String(a?.package?.name ?? ""), ecosystem: String(a?.package?.ecosystem ?? ""), ranges, fixed, gitFixed };
}
