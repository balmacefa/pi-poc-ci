// Unit tests for the pure cve modules: ids, deps, osv, truncate, policy.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseDeps } from "../.pi/extensions/cve/deps.ts";
import { branchFor, isCveBranch, normalizeAdvisoryId } from "../.pi/extensions/cve/ids.ts";
import { buildBatchPayload, parseBatchResponse, summarizeVuln } from "../.pi/extensions/cve/osv.ts";
import { decide, parseMode, writeRoots } from "../.pi/extensions/cve/policy.ts";
import { applyBudget, truncate } from "../.pi/extensions/cve/truncate.ts";

describe("ids", () => {
  it("normalizes CVE and GHSA case", () => {
    assert.equal(normalizeAdvisoryId("cve-2019-10744"), "CVE-2019-10744");
    assert.equal(normalizeAdvisoryId("GHSA-JF85-CPCP-J695"), "GHSA-jf85-cpcp-j695");
  });
  it("rejects malformed and dangerous ids", () => {
    for (const bad of ["", "CVE-19-1", "../etc/passwd", "CVE-2019-10744/../x", "-rf", "a b", 5, undefined, "GHSA-", "x\n"]) {
      assert.equal(normalizeAdvisoryId(bad), undefined, String(bad));
    }
  });
  it("accepts generic OSV ids", () => {
    assert.equal(normalizeAdvisoryId("PYSEC-2020-123"), "PYSEC-2020-123");
  });
  it("only CVE and GHSA ids make branches", () => {
    assert.equal(branchFor("CVE-2019-10744"), "cve/CVE-2019-10744");
    assert.equal(branchFor("PYSEC-2020-123"), undefined);
    assert.equal(branchFor("main"), undefined);
  });
  it("isCveBranch enforces the pattern", () => {
    assert.ok(isCveBranch("cve/CVE-2019-10744"));
    assert.ok(isCveBranch("cve/GHSA-jf85-cpcp-j695"));
    for (const b of ["main", "master", "cve/cve-2019-10744", "cve/CVE-2019-1", "cve/GHSA-ABC", "xcve/CVE-2019-10744", "cve/CVE-2019-10744/x"]) {
      assert.equal(isCveBranch(b), false, b);
    }
  });
});

describe("deps", () => {
  it("keeps exact pins, strips ^ and ~, skips ranges", () => {
    const { packages, skipped } = parseDeps(
      JSON.stringify({
        dependencies: { lodash: "4.17.11", minimist: "^1.2.0" },
        devDependencies: { a: "~2.0.1", b: ">=1.0.0", c: "latest", d: "1.x" },
      }),
    );
    assert.deepEqual(packages, [
      { name: "lodash", version: "4.17.11" },
      { name: "minimist", version: "1.2.0" },
      { name: "a", version: "2.0.1" },
    ]);
    assert.deepEqual(skipped.map((s) => s.name), ["b", "c", "d"]);
  });
  it("handles missing sections", () => {
    assert.deepEqual(parseDeps("{}"), { packages: [], skipped: [] });
  });
});

describe("osv", () => {
  const pkgs = [{ name: "lodash", version: "4.17.11" }, { name: "minimist", version: "1.2.0" }];
  it("builds the npm batch payload", () => {
    assert.deepEqual(buildBatchPayload(pkgs).queries[0], { package: { name: "lodash", ecosystem: "npm" }, version: "4.17.11" });
  });
  it("maps batch results by position", () => {
    const out = parseBatchResponse(pkgs, { results: [{ vulns: [{ id: "GHSA-a" }, { id: "GHSA-b" }] }, {}] });
    assert.deepEqual(out.map((r) => r.vulnIds), [["GHSA-a", "GHSA-b"], []]);
  });
  it("rejects a mismatched batch response", () => {
    assert.throws(() => parseBatchResponse(pkgs, { results: [] }));
  });
  it("summarizes a vuln with fixed versions", () => {
    const s = summarizeVuln({
      id: "GHSA-x",
      aliases: ["CVE-2019-10744"],
      summary: "Prototype pollution",
      published: "2019-07-26T00:00:00Z",
      severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N" }],
      database_specific: { severity: "CRITICAL" },
      affected: [
        { package: { name: "lodash", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.12" }] }] },
      ],
      references: [{ type: "WEB", url: "https://example.com/a" }, { type: "WEB" }],
    });
    assert.deepEqual(s.fixedVersions, ["4.17.12"]);
    assert.deepEqual(s.affected[0].ranges, [">=0 <4.17.12"]);
    assert.deepEqual(s.references, ["https://example.com/a"]);
    assert.equal(s.databaseSeverity, "CRITICAL");
    assert.deepEqual(s.aliases, ["CVE-2019-10744"]);
  });
  it("tolerates empty records", () => {
    assert.equal(summarizeVuln({}).fixedVersions.length, 0);
  });
});

describe("truncate", () => {
  it("leaves short text alone and marks cuts", () => {
    assert.equal(truncate("abc", 5), "abc");
    assert.match(truncate("abcdef", 3), /^abc\n\[\.\.\. truncated 3 chars\]$/);
  });
  it("applies per-item and total budgets", () => {
    const out = applyBudget(["a".repeat(10), "b".repeat(10), "c".repeat(10)], 6, 10);
    assert.ok(out[0].startsWith("aaaaaa\n"));
    assert.ok(out[1].startsWith("bbbb\n"));
    assert.ok(out[2].startsWith("\n[... truncated"));
  });
});

describe("policy", () => {
  it("parses modes", () => {
    assert.equal(parseMode(undefined), "default");
    assert.equal(parseMode("patch"), "patch");
    assert.equal(parseMode("investigate"), "investigate");
    assert.equal(parseMode("PATCH"), "invalid");
    assert.equal(parseMode(true), "invalid");
  });
  it("write roots per mode", () => {
    assert.deepEqual(writeRoots("default"), ["src"]);
    assert.deepEqual(writeRoots("investigate"), ["reports"]);
    assert.deepEqual(writeRoots("patch"), ["targets", "reports"]);
    assert.deepEqual(writeRoots("invalid"), []);
  });
  it("blocks patch tools outside patch mode", () => {
    for (const mode of ["default", "investigate", "invalid"] as const) {
      assert.equal(decide(mode, "cve_branch", { id: "CVE-2019-10744" }).block, true, mode);
      assert.equal(decide(mode, "cve_commit_push", { id: "CVE-2019-10744", message: "m" }).block, true, mode);
    }
  });
  it("allows patch tools in patch mode with valid ids only", () => {
    assert.equal(decide("patch", "cve_branch", { id: "CVE-2019-10744" }).block, false);
    assert.equal(decide("patch", "cve_branch", { id: "main" }).block, true);
    assert.equal(decide("patch", "cve_branch", { id: "CVE-2019-10744; rm" }).block, true);
    assert.equal(decide("patch", "cve_commit_push", { id: "CVE-2019-10744", message: " " }).block, true);
    assert.equal(decide("patch", "cve_commit_push", { id: "CVE-2019-10744", message: "fix" }).block, false);
  });
  it("validates ids for details and report; reports allowed in both modes", () => {
    assert.equal(decide("investigate", "cve_details", { id: "../x" }).block, true);
    assert.equal(decide("investigate", "cve_report", { id: "CVE-2019-10744", markdown: "x" }).block, false);
    assert.equal(decide("patch", "cve_report", { id: "CVE-2019-10744", markdown: "x" }).block, false);
    assert.equal(decide("investigate", "cve_scan", {}).block, false);
  });
  it("blocks cve tools without a mode and shell tools in modes", () => {
    assert.equal(decide("default", "cve_scan", {}).block, true);
    assert.equal(decide("default", "read", { path: "x" }).block, false);
    assert.equal(decide("patch", "bash", { command: "ls" }).block, true);
    assert.equal(decide("investigate", "powershell", {}).block, true);
  });
  it("fails closed on invalid mode", () => {
    assert.equal(decide("invalid", "write", { path: "src/a" }).block, true);
    assert.equal(decide("invalid", "cve_scan", {}).block, true);
    assert.equal(decide("invalid", "read", { path: "src/a" }).block, false);
  });
});
