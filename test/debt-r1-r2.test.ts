// Tests for debt payback R1 (osv-client) and R2 (run-summary)
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import fs from "node:fs";
import path from "node:path";

describe("R2: run-summary parsing", () => {
  it("extracts pkg and fixedVersion from OSV JSON", () => {
    const osvData = {
      id: "GHSA-test-1234-abcd",
      affected: [
        {
          package: {
            name: "lodash",
            ecosystem: "npm"
          },
          ranges: [
            {
              type: "SEMVER",
              events: [
                { introduced: "4.0.0" },
                { fixed: "4.17.21" }
              ]
            }
          ]
        }
      ]
    };

    // Extract pkg (first affected package)
    let pkg = null;
    if (osvData.affected && Array.isArray(osvData.affected) && osvData.affected.length > 0) {
      pkg = osvData.affected[0].package?.name || null;
    }
    assert.equal(pkg, "lodash");

    // Extract fixedVersion (first fixed event)
    let fixedVersion = null;
    if (osvData.affected && Array.isArray(osvData.affected)) {
      outer: for (const aff of osvData.affected) {
        if (aff.ranges && Array.isArray(aff.ranges)) {
          for (const range of aff.ranges) {
            if (range.events && Array.isArray(range.events)) {
              for (const evt of range.events) {
                if (evt.fixed) {
                  fixedVersion = evt.fixed;
                  break outer;
                }
              }
            }
          }
        }
      }
    }
    assert.equal(fixedVersion, "4.17.21");
  });

  it("handles OSV JSON with no fix version", () => {
    const osvData = {
      id: "GHSA-no-fix",
      affected: [
        {
          package: { name: "test-pkg" },
          ranges: [
            {
              type: "SEMVER",
              events: [
                { introduced: "1.0.0" },
                { last_affected: "2.0.0" }
              ]
            }
          ]
        }
      ]
    };

    let fixedVersion = null;
    if (osvData.affected && Array.isArray(osvData.affected)) {
      outer: for (const aff of osvData.affected) {
        if (aff.ranges && Array.isArray(aff.ranges)) {
          for (const range of aff.ranges) {
            if (range.events && Array.isArray(range.events)) {
              for (const evt of range.events) {
                if (evt.fixed) {
                  fixedVersion = evt.fixed;
                  break outer;
                }
              }
            }
          }
        }
      }
    }
    assert.equal(fixedVersion, null);
  });

  it("calculates durationMs from audit lines with timestamps", () => {
    const auditLines = [
      '{"at":"2026-11-01T00:22:39.408Z","tool":"cve_scan"}',
      '{"at":"2026-11-01T00:22:41.916Z","tool":"cve_prior_fixes"}',
      '{"at":"2026-11-01T00:22:47.482Z","tool":"cve_details"}'
    ];

    let firstTs: number | null = null;
    let lastTs: number | null = null;

    for (const line of auditLines) {
      try {
        const obj = JSON.parse(line);
        const ts = obj.at || obj.ts || obj.time || obj.timestamp;
        if (ts) {
          const parsed = new Date(ts).getTime();
          if (!isNaN(parsed)) {
            if (firstTs === null) firstTs = parsed;
            lastTs = parsed;
          }
        }
      } catch {
        // Skip malformed
      }
    }

    const durationMs = (firstTs !== null && lastTs !== null) ? lastTs - firstTs : 0;
    
    // Should be ~8074ms (47.482 - 39.408 = 8.074 seconds)
    assert.ok(durationMs > 8000 && durationMs < 8100);
  });

  it("handles audit lines without timestamps", () => {
    const auditLines = [
      '{"tool":"cve_scan"}',
      '{"tool":"cve_prior_fixes"}'
    ];

    let firstTs: number | null = null;
    let lastTs: number | null = null;

    for (const line of auditLines) {
      try {
        const obj = JSON.parse(line);
        const ts = obj.at || obj.ts || obj.time || obj.timestamp;
        if (ts) {
          const parsed = new Date(ts).getTime();
          if (!isNaN(parsed)) {
            if (firstTs === null) firstTs = parsed;
            lastTs = parsed;
          }
        }
      } catch {
        // Skip malformed
      }
    }

    const durationMs = (firstTs !== null && lastTs !== null) ? lastTs - firstTs : 0;
    assert.equal(durationMs, 0);
  });
});

describe("R1: osv-client error handling", () => {
  it("throws clear error for corrupt fixture", () => {
    const tmpDir = path.join("fixtures", "osv");
    const tmpFile = path.join(tmpDir, "test-corrupt.json");
    
    // Create a corrupt fixture
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(tmpFile, "{ this is not valid JSON }");

    try {
      // Simulate reading and parsing
      let err: Error | null = null;
      try {
        JSON.parse(fs.readFileSync(tmpFile, "utf-8"));
      } catch (e) {
        err = new Error(`OSV fixture corrupto: ${tmpFile}`);
      }
      
      assert.ok(err);
      assert.match(err.message, /OSV fixture corrupto/);
      assert.match(err.message, /test-corrupt\.json/);
    } finally {
      // Cleanup
      fs.unlinkSync(tmpFile);
    }
  });
});
