// Validation and normalization of advisory ids (CVE-, GHSA-, OSV) and CVE branch names.

const CVE_RE = /^CVE-\d{4}-\d{4,}$/;
const GHSA_RE = /^GHSA-[a-z0-9-]+$/;
// OSV ids look like PREFIX-body (e.g. PYSEC-2020-1); they start with a letter, so no path tricks.
const OSV_RE = /^[A-Z][A-Z0-9]*-[A-Za-z0-9][A-Za-z0-9._-]{2,80}$/;
const BRANCH_RE = /^cve\/(CVE-\d{4}-\d{4,}|GHSA-[a-z0-9-]+)$/;

/** Normalizes case (CVE upper, GHSA body lower) and returns the id, or undefined when it is not a valid advisory id. */
export function normalizeAdvisoryId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const id = raw.trim();
  const upper = id.toUpperCase();
  if (upper.startsWith("CVE-")) return CVE_RE.test(upper) ? upper : undefined;
  if (upper.startsWith("GHSA-")) {
    const ghsa = `GHSA-${id.slice(5).toLowerCase()}`;
    return GHSA_RE.test(ghsa) ? ghsa : undefined;
  }
  return OSV_RE.test(id) ? id : undefined;
}

/** Returns the id only when it may name a patch branch (CVE or GHSA, canonical case). */
export function normalizeBranchId(raw: unknown): string | undefined {
  const id = normalizeAdvisoryId(raw);
  return id !== undefined && BRANCH_RE.test(`cve/${id}`) ? id : undefined;
}

/** Builds the branch name for an id, or undefined when the id is not branchable. */
export function branchFor(raw: unknown): string | undefined {
  const id = normalizeBranchId(raw);
  return id === undefined ? undefined : `cve/${id}`;
}

/** True when the branch name matches the allowed CVE branch pattern (never main/master). */
export function isCveBranch(name: string): boolean {
  return BRANCH_RE.test(name);
}
