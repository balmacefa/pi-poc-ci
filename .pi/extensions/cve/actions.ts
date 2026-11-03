// Implementations of the cve_* tools with injected IO (fs, fetch, git), free of any pi imports.
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseDeps } from "./deps.ts";
import { checkInside } from "./fsguard.ts";
import { runGit, type GitRunner } from "./git-runner.ts";
import { commitAndPush, priorFixes, switchToCveBranch, type CommitPushResult, type PriorFix } from "./gitflow.ts";
import { normalizeAdvisoryId } from "./ids.ts";
import { fetchVuln, queryBatch, type FetchLike } from "./osv-client.ts";
import { summarizeVuln, type ScanResult, type VulnSummary } from "./osv.ts";

export interface Io {
  cwd: string;
  fetch: FetchLike;
  git: GitRunner;
  readFile: (path: string) => string;
  writeFile: (path: string, text: string) => void;
  dirExists: (path: string) => boolean;
  env: Record<string, string | undefined>;
}

/** Real IO bound to a project directory. */
export function realIo(cwd: string): Io {
  return {
    cwd,
    fetch: (url, init) => fetch(url, init),
    git: runGit,
    readFile: (p) => readFileSync(p, "utf8"),
    writeFile: (p, text) => {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
    },
    dirExists: (p) => existsSync(p),
    env: process.env,
  };
}

/** cve_scan: queries OSV for the pinned dependencies of <path>/package.json. */
export async function cveScan(path: string, io: Io) {
  const blocked = checkInside(io.cwd, [""], path, "cve_scan path must stay inside the project");
  if (blocked) throw new Error(blocked);
  const { packages, skipped } = parseDeps(io.readFile(resolve(io.cwd, path, "package.json")));
  const results: ScanResult[] = await queryBatch(packages, io.fetch);
  return {
    path,
    scanned: packages.length,
    skippedNonPinned: skipped,
    vulnerable: results.filter((r) => r.vulnIds.length > 0),
    note: "Ids are OSV/GHSA ids; call cve_details for each to get CVE aliases and fixed versions.",
  };
}

/** cve_details: fetches one OSV record, saves the raw JSON under reports/cve/ and returns a summary. */
export async function cveDetails(
  id: string,
  io: Io,
): Promise<VulnSummary & { savedTo: string; viaAlias?: VulnSummary & { savedTo: string } }> {
  const { id: clean, raw } = await fetchVuln(id, io.fetch);
  const savedTo = writeReport(io, clean, "json", JSON.stringify(raw, null, 2));
  const summary = summarizeVuln(raw);
  // A CVE record often only has a git fix commit; the GHSA alias carries the npm version ranges.
  const ghsa = summary.fixedVersions.length === 0 ? summary.aliases.find((a) => a.startsWith("GHSA-")) : undefined;
  if (ghsa === undefined) return { ...summary, savedTo };
  const alias = await fetchVuln(ghsa, io.fetch);
  const aliasSaved = writeReport(io, alias.id, "json", JSON.stringify(alias.raw, null, 2));
  return { ...summary, savedTo, viaAlias: { ...summarizeVuln(alias.raw), savedTo: aliasSaved } };
}

/** cve_report: writes reports/cve/<id>.md. */
export function cveReport(id: string, markdown: string, io: Io): { savedTo: string } {
  const clean = normalizeAdvisoryId(id);
  if (clean === undefined) throw new Error(`invalid advisory id: ${JSON.stringify(id)}`);
  return { savedTo: writeReport(io, clean, "md", markdown) };
}

/** cve_prior_fixes: searches git history of the project (or a permitted reference repo) for similar fixes. */
export async function cvePriorFixes(
  args: { pattern?: string; limit?: number; repo?: string },
  io: Io,
): Promise<{ repo: string; commits: PriorFix[] }> {
  const repo = resolveRepo(args.repo, io);
  const commits = await priorFixes(repo, args.pattern ?? "CVE-", args.limit ?? 5, io.git);
  return { repo, commits };
}

/** cve_branch: creates or switches to cve/<id>. */
export async function cveBranch(id: string, io: Io): Promise<{ branch: string }> {
  return { branch: await switchToCveBranch(id, io.cwd, io.git) };
}

/** cve_commit_push: commits targets/ and reports/ on cve/<id> and tries to push; git errors come back as text. */
export async function cveCommitPush(id: string, message: string, io: Io): Promise<CommitPushResult> {
  // Quick & dirty: verify fix before pushing (log only, don't block)
  try {
    const verification = await verifyPatch(id, "targets", io);
    console.error(`[verify] CVE ${id}: cleared=${verification.cleared}, testsOk=${verification.testsOk}`);
  } catch (err) {
    console.error(`[verify] CVE ${id}: verification failed:`, err);
  }
  return commitAndPush(id, message, io.cwd, io.git, (d) => io.dirExists(resolve(io.cwd, d)));
}

// Writes reports/cve/<id>.<ext>, re-checking containment because reports/ may be a symlink.
function writeReport(io: Io, id: string, ext: "json" | "md", text: string): string {
  const rel = `reports/cve/${id}.${ext}`;
  const blocked = checkInside(io.cwd, ["reports"], rel, "reports must stay under reports/");
  if (blocked) throw new Error(blocked);
  io.writeFile(resolve(io.cwd, rel), text);
  return rel;
}

/** verifyFix: re-scans the target package and returns true if the CVE id no longer appears. */
export async function verifyFix(id: string, targetPath: string, io: Io): Promise<{ cleared: boolean }> {
  const cleanId = normalizeAdvisoryId(id);
  if (cleanId === undefined) throw new Error(`invalid advisory id: ${JSON.stringify(id)}`);
  const scan = await cveScan(targetPath, io);
  const stillPresent = scan.vulnerable.some((r) => r.vulnIds.includes(cleanId));
  return { cleared: !stillPresent };
}

/** runTargetTests: runs npm test in targetPath if package.json has a test script. */
export function runTargetTests(targetPath: string, io: Io): { ran: boolean; ok: boolean; output?: string } {
  const pkgPath = resolve(io.cwd, targetPath, "package.json");
  if (!existsSync(pkgPath)) return { ran: false, ok: true };
  const pkg = JSON.parse(io.readFile(pkgPath));
  if (!pkg.scripts?.test) return { ran: false, ok: true };
  try {
    const output = execSync("npm test", { cwd: resolve(io.cwd, targetPath), encoding: "utf8", stdio: "pipe" });
    return { ran: true, ok: true, output };
  } catch (err: any) {
    return { ran: true, ok: false, output: err.stdout || err.stderr || String(err) };
  }
}

/** verifyPatch: combines verifyFix + runTargetTests for a complete post-patch check. */
export async function verifyPatch(
  id: string,
  targetPath: string,
  io: Io,
): Promise<{ cleared: boolean; testsOk: boolean }> {
  const fix = await verifyFix(id, targetPath, io);
  const tests = runTargetTests(targetPath, io);
  return { cleared: fix.cleared, testsOk: tests.ok };
}

// The repo argument must be a path inside the project or exactly the CVE_REFERENCE_REPO env var.
function resolveRepo(repo: string | undefined, io: Io): string {
  if (repo === undefined || repo === "") return io.cwd;
  if (repo.startsWith("-")) throw new Error("repo must not start with '-'");
  const reference = io.env.CVE_REFERENCE_REPO;
  if (reference && resolve(repo) === resolve(reference)) return resolve(reference);
  const blocked = checkInside(io.cwd, [""], repo, "repo must be inside the project or equal CVE_REFERENCE_REPO");
  if (blocked) throw new Error(blocked);
  return resolve(io.cwd, repo);
}
