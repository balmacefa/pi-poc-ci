// Default git runner: execFile with an args array, never a shell.
import { execFile } from "node:child_process";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type GitRunner = (args: string[], cwd: string) => Promise<GitResult>;

/** Runs `git <args>` in cwd and resolves (never rejects) with exit code and output. */
export const runGit: GitRunner = (args, cwd) =>
  new Promise((resolvePromise) => {
    execFile("git", args, { cwd, maxBuffer: 16 * 1024 * 1024, windowsHide: true, timeout: 60_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === "number" ? err.code : 1) : 0;
      resolvePromise({ code, stdout: String(stdout), stderr: err && !stderr ? String(err.message) : String(stderr) });
    });
  });
