// Git operations for the CVE workflow (prior fixes, branch, commit+push) over an injected git runner.
import { branchFor } from "./ids.ts";
import type { GitRunner } from "./git-runner.ts";
import { applyBudget } from "./truncate.ts";

export interface PriorFix {
  hash: string;
  subject: string;
  date: string;
  files: string[];
  diff: string;
}

const PER_COMMIT_CHARS = 6000;
const TOTAL_CHARS = 20000;
const HASH_RE = /^[0-9a-f]{40}$/;
const SEP = "\u001f";

/** Lists commits whose message matches `pattern` with their files and truncated diffs. Throws on bad arguments. */
export async function priorFixes(
  repoDir: string,
  pattern: string,
  limit: number,
  run: GitRunner,
): Promise<PriorFix[]> {
  if (pattern.startsWith("-") || pattern === "") throw new Error("pattern must be non-empty and must not start with '-'");
  const n = Math.min(Math.max(Math.floor(limit), 1), 20);
  const log = await run(["log", `--grep=${pattern}`, "-i", "-n", String(n), `--format=%H${SEP}%s${SEP}%aI`], repoDir);
  if (log.code !== 0) throw new Error(`git log failed: ${log.stderr.trim()}`);
  const commits = log.stdout
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => l.split(SEP))
    .filter(([hash]) => HASH_RE.test(hash ?? ""));
  const shown: { hash: string; subject: string; date: string; files: string[]; diff: string }[] = [];
  for (const [hash, subject = "", date = ""] of commits) {
    const names = await run(["show", "--name-only", "--format=", hash], repoDir);
    const patch = await run(["show", "--stat", "--patch", "--format=", hash], repoDir);
    shown.push({
      hash,
      subject,
      date,
      files: names.stdout.split("\n").filter((f) => f.trim() !== ""),
      diff: patch.code === 0 ? patch.stdout : `git show failed: ${patch.stderr.trim()}`,
    });
  }
  const diffs = applyBudget(shown.map((c) => c.diff), PER_COMMIT_CHARS, TOTAL_CHARS);
  return shown.map((c, i) => ({ ...c, diff: diffs[i] }));
}

/** Creates (or switches to) cve/<id>. Returns the branch name; throws on invalid id or git failure. */
export async function switchToCveBranch(id: string, cwd: string, run: GitRunner): Promise<string> {
  const branch = branchFor(id);
  if (branch === undefined) throw new Error(`invalid id for branch: ${JSON.stringify(id)}`);
  const exists = await run(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd);
  const res = exists.code === 0 ? await run(["switch", branch], cwd) : await run(["switch", "-c", branch], cwd);
  if (res.code !== 0) throw new Error(`git switch failed: ${res.stderr.trim()}`);
  return branch;
}

export interface CommitPushResult {
  ok: boolean;
  branch: string;
  steps: string[];
}

/**
 * Commits changes under targets/ and reports/ on cve/<id> and pushes. Only the allowed dirs are staged and committed.
 * Push failure is reported in the result (ok: false), not thrown.
 */
export async function commitAndPush(
  id: string,
  message: string,
  cwd: string,
  run: GitRunner,
  dirExists: (dir: string) => boolean,
): Promise<CommitPushResult> {
  const branch = branchFor(id);
  if (branch === undefined) throw new Error(`invalid id for branch: ${JSON.stringify(id)}`);
  const current = await run(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const head = current.stdout.trim();
  if (current.code !== 0 || head !== branch) {
    throw new Error(`current branch is ${JSON.stringify(head)}, expected ${branch}; run cve_branch first`);
  }
  const dirs = ["targets", "reports"].filter(dirExists);
  if (dirs.length === 0) throw new Error("neither targets/ nor reports/ exists, nothing to commit");
  const steps: string[] = [];
  const add = await run(["add", "--", ...dirs], cwd);
  if (add.code !== 0) throw new Error(`git add failed: ${add.stderr.trim()}`);
  // "--" followed by paths limits the commit to those paths even if other files were staged earlier.
  const commit = await run(["commit", "-m", message, "--", ...dirs], cwd);
  if (commit.code !== 0) {
    throw new Error(`git commit failed: ${(commit.stderr + commit.stdout).trim()}`);
  }
  steps.push(`committed: ${commit.stdout.split("\n")[0]}`);
  const push = await run(["push", "-u", "origin", branch], cwd);
  if (push.code !== 0) {
    steps.push(`push failed: ${(push.stderr || push.stdout).trim()}`);
    return { ok: false, branch, steps };
  }
  steps.push(`pushed ${branch}`);
  return { ok: true, branch, steps };
}
