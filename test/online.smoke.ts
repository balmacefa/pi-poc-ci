// Optional online smoke test against the real OSV API (not run by `npm test`).
// Run: node test/online.smoke.ts
import { cveDetails, cveScan, realIo } from "../.pi/extensions/cve/actions.ts";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "cve-smoke-"));
mkdirSync(join(dir, "targets", "vuln-app"), { recursive: true });
writeFileSync(join(dir, "targets", "vuln-app", "package.json"), JSON.stringify({ dependencies: { lodash: "4.17.11", minimist: "1.2.0" } }));
const io = realIo(dir);

const scan = await cveScan("targets/vuln-app", io);
console.log("scan:", scan.vulnerable.map((v) => `${v.name}@${v.version}: ${v.vulnIds.length} ids`).join("; "));
if (scan.vulnerable.length !== 2) throw new Error("expected both lodash and minimist to be vulnerable");

const d = await cveDetails("CVE-2019-10744", io);
console.log("details:", d.id, d.aliases, d.fixedVersions, d.savedTo);
if (d.fixedVersions.length === 0) throw new Error("expected fixed versions");
console.log("ok (temp dir:", dir, ")");
