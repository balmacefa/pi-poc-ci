// Tests for fsguard, osv-client, gitflow and actions using injected fetch/git and temp directories.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { cveBranch, cveCommitPush, cveDetails, cvePriorFixes, cveReport, cveScan, type Io } from "../.pi/extensions/cve/actions.ts";
import { checkInside } from "../.pi/extensions/cve/fsguard.ts";
import type { GitResult } from "../.pi/extensions/cve/git-runner.ts";
import { fetchVuln } from "../.pi/extensions/cve/osv-client.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cve-test-"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "targets", "vuln-app"), { recursive: true });
  writeFileSync(
    join(dir, "targets", "vuln-app", "package.json"),
    JSON.stringify({ dependencies: { lodash: "4.17.11", minimist: "^1.2.0" } }),
  );
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ok = (stdout = ""): GitResult => ({ code: 0, stdout, stderr: "" });
const fail = (stderr: string): GitResult => ({ code: 1, stdout: "", stderr });
const noFetch: Io["fetch"] = async () => {
  throw new Error("network used");
};

function makeIo(over: Partial<Io>): Io {
  return {
    cwd: dir,
    fetch: noFetch,
    git: async () => ok(),
    readFile: (p) => readFileSync(p, "utf8"),
    writeFile: (p, t) => {
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, t);
    },
    dirExists: () => true,
    env: {},
    ...over,
  };
}

describe("fsguard", () => {
  it("allows files under a root and rejects the root itself, siblings and traversal", () => {
    assert.equal(checkInside(dir, ["src"], "src/a.js", "r"), undefined);
    assert.equal(checkInside(dir, ["src"], "src/new/deep.js", "r"), undefined);
    assert.ok(checkInside(dir, ["src"], "src", "r"));
    assert.ok(checkInside(dir, ["src"], "targets/x", "r"));
    assert.ok(checkInside(dir, ["src"], "src/../targets/x", "r"));
    assert.ok(checkInside(dir, ["src"], join(tmpdir(), "elsewhere.txt"), "r"));
    assert.ok(checkInside(dir, [], "src/a", "r"));
  });
  it("supports several roots; missing root dirs are fine", () => {
    assert.equal(checkInside(dir, ["targets", "reports"], "reports/cve/x.md", "r"), undefined);
    assert.equal(checkInside(dir, ["targets", "reports"], "targets/vuln-app/a.js", "r"), undefined);
    assert.ok(checkInside(dir, ["targets", "reports"], "src/a.js", "r"));
  });
  it("project root reads allowed with root ''", () => {
    assert.equal(checkInside(dir, [""], ".", "r"), undefined);
    assert.equal(checkInside(dir, [""], "src/a.js", "r"), undefined);
    assert.ok(checkInside(dir, [""], "..", "r"));
  });
  it("follows symlinks out of the root", (t) => {
    const outside = mkdtempSync(join(tmpdir(), "cve-out-"));
    try {
      symlinkSync(outside, join(dir, "src", "link"), "junction");
    } catch {
      t.skip("symlinks unavailable");
      return;
    }
    assert.ok(checkInside(dir, ["src"], "src/link/x.txt", "r"));
    rmSync(outside, { recursive: true, force: true });
  });
});

describe("osv-client", () => {
  it("validates the id before building the URL", async () => {
    await assert.rejects(fetchVuln("../../etc", noFetch), /invalid advisory id/);
    let url = "";
    await fetchVuln("cve-2019-10744", async (u) => {
      url = u;
      return { ok: true, status: 200, json: async () => ({}) };
    });
    assert.equal(url, "https://api.osv.dev/v1/vulns/CVE-2019-10744");
  });
});

describe("actions", () => {
  it("cveScan posts pinned deps and returns vulnerable packages", async () => {
    let body: any;
    const io = makeIo({
      fetch: async (url, init) => {
        assert.equal(url, "https://api.osv.dev/v1/querybatch");
        body = JSON.parse(init!.body!);
        return { ok: true, status: 200, json: async () => ({ results: [{ vulns: [{ id: "GHSA-1" }] }, {}] }) };
      },
    });
    const res = await cveScan("targets/vuln-app", io);
    assert.equal(body.queries.length, 2);
    assert.equal(body.queries[1].version, "1.2.0");
    assert.deepEqual(res.vulnerable, [{ name: "lodash", version: "4.17.11", vulnIds: ["GHSA-1"] }]);
  });
  it("cveScan rejects paths outside the project", async () => {
    await assert.rejects(cveScan("..", makeIo({})), /inside the project/);
  });
  it("cveDetails summarizes and writes reports/cve/<id>.json", async () => {
    const raw = { id: "GHSA-x", affected: [{ package: { name: "l" }, ranges: [{ events: [{ introduced: "0" }, { fixed: "1.2.3" }] }] }] };
    const io = makeIo({ fetch: async () => ({ ok: true, status: 200, json: async () => raw }) });
    const res = await cveDetails("GHSA-X", io);
    assert.deepEqual(res.fixedVersions, ["1.2.3"]);
    assert.equal(res.savedTo, "reports/cve/GHSA-x.json");
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "reports/cve/GHSA-x.json"), "utf8")), raw);
  });
  it("cveDetails follows the GHSA alias when the CVE record only has a git fix", async () => {
    const cve = { id: "CVE-2020-0001", aliases: ["GHSA-abcd-efgh-ijkl"], affected: [{ ranges: [{ type: "GIT", events: [{ introduced: "0" }, { fixed: "deadbeef" }] }] }] };
    const ghsa = { id: "GHSA-abcd-efgh-ijkl", affected: [{ package: { name: "l" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.12" }] }] }] };
    const urls: string[] = [];
    const io = makeIo({
      fetch: async (u) => (urls.push(u), { ok: true, status: 200, json: async () => (u.endsWith("CVE-2020-0001") ? cve : ghsa) }),
    });
    const res = await cveDetails("CVE-2020-0001", io);
    assert.deepEqual(res.fixedVersions, []);
    assert.deepEqual(res.fixedCommits, ["deadbeef"]);
    assert.deepEqual(res.viaAlias?.fixedVersions, ["4.17.12"]);
    assert.equal(urls.length, 2);
  });
  it("cveReport writes markdown and rejects bad ids", () => {
    const io = makeIo({});
    assert.equal(cveReport("CVE-2019-10744", "# hi", io).savedTo, "reports/cve/CVE-2019-10744.md");
    assert.equal(readFileSync(join(dir, "reports/cve/CVE-2019-10744.md"), "utf8"), "# hi");
    assert.throws(() => cveReport("../x", "m", io));
  });
  it("cvePriorFixes uses an args array and truncates diffs", async () => {
    const calls: string[][] = [];
    const hash = "a".repeat(40);
    const io = makeIo({
      git: async (args) => {
        calls.push(args);
        if (args[0] === "log") return ok(`${hash}\u001ffix CVE-1\u001f2020-01-01T00:00:00Z\n`);
        if (args.includes("--name-only")) return ok("a.js\nb.js\n");
        return ok("x".repeat(9000));
      },
    });
    const res = await cvePriorFixes({ limit: 3 }, io);
    assert.deepEqual(calls[0].slice(0, 5), ["log", "--grep=CVE-", "-i", "-n", "3"]);
    assert.equal(res.commits[0].files.length, 2);
    assert.ok(res.commits[0].diff.length < 6100);
    assert.ok(res.commits[0].diff.includes("truncated"));
  });
  it("cvePriorFixes rejects dash arguments and foreign repos", async () => {
    const io = makeIo({});
    await assert.rejects(cvePriorFixes({ pattern: "--all" }, io), /must not start/);
    await assert.rejects(cvePriorFixes({ repo: "--upload-pack=x" }, io), /must not start/);
    await assert.rejects(cvePriorFixes({ repo: join(tmpdir()) }, io), /inside the project/);
    const ref = join(tmpdir(), "some-ref-repo");
    const res = await cvePriorFixes({ repo: ref }, makeIo({ env: { CVE_REFERENCE_REPO: ref }, git: async () => ok("") }));
    assert.equal(res.repo, ref);
  });
  it("cveBranch creates or switches", async () => {
    const seen: string[][] = [];
    await cveBranch("CVE-2019-10744", makeIo({ git: async (a) => (seen.push(a), a[0] === "rev-parse" ? fail("") : ok()) }));
    assert.deepEqual(seen[1], ["switch", "-c", "cve/CVE-2019-10744"]);
    seen.length = 0;
    await cveBranch("CVE-2019-10744", makeIo({ git: async (a) => (seen.push(a), ok()) }));
    assert.deepEqual(seen[1], ["switch", "cve/CVE-2019-10744"]);
    await assert.rejects(cveBranch("main", makeIo({})), /invalid id/);
  });
  it("cveCommitPush refuses the wrong branch", async () => {
    const io = makeIo({ git: async () => ok("main\n") });
    await assert.rejects(cveCommitPush("CVE-2019-10744", "m", io), /expected cve\/CVE-2019-10744/);
  });
  it("cveCommitPush stages only targets and reports, then returns push errors as a result", async () => {
    const seen: string[][] = [];
    const io = makeIo({
      git: async (a) => {
        seen.push(a);
        if (a[0] === "status") return ok(" M targets/vuln-app/package.json\n");
        if (a[0] === "rev-parse") return ok("cve/CVE-2019-10744\n");
        if (a[0] === "push") return fail("fatal: 'origin' does not appear to be a git repository");
        return ok("[cve/CVE-2019-10744 abc] fix\n");
      },
    });
    const res = await cveCommitPush("CVE-2019-10744", "fix lodash", io);
    assert.equal(res.ok, false);
    assert.match(res.steps.join("\n"), /does not appear to be a git repository/);
    // Ahora seen[0] es status, seen[1] es rev-parse, seen[2] es add, etc.
    assert.deepEqual(seen[2], ["add", "--", "targets", "reports"]);
    assert.deepEqual(seen[3], ["commit", "-m", "fix lodash", "--", "targets", "reports"]);
    assert.deepEqual(seen[4], ["push", "-u", "origin", "cve/CVE-2019-10744"]);
  });
});
