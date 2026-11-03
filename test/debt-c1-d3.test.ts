import { test } from "node:test";
import { strict as assert } from "node:assert";

// Importar funciones exportadas de C1 (reports-to-sarif.mjs es ESM, usar import dinámico)
// y D3 (actions.ts)
import { truncateOutput, deduceTargetPath } from "../.pi/extensions/cve/actions.ts";
import type { Io } from "../.pi/extensions/cve/actions.ts";

// Tests para C1: mapeo de severity

test("mapSeverityToLevel: HIGH → error", async () => {
  const { mapSeverityToLevel } = await import("../scripts/reports-to-sarif.mjs");
  assert.equal(mapSeverityToLevel("HIGH"), "error");
});

test("mapSeverityToLevel: CRITICAL → error", async () => {
  const { mapSeverityToLevel } = await import("../scripts/reports-to-sarif.mjs");
  assert.equal(mapSeverityToLevel("CRITICAL"), "error");
});

test("mapSeverityToLevel: MODERATE → warning", async () => {
  const { mapSeverityToLevel } = await import("../scripts/reports-to-sarif.mjs");
  assert.equal(mapSeverityToLevel("MODERATE"), "warning");
});

test("mapSeverityToLevel: LOW → warning", async () => {
  const { mapSeverityToLevel } = await import("../scripts/reports-to-sarif.mjs");
  assert.equal(mapSeverityToLevel("LOW"), "warning");
});

test("mapSeverityToLevel: undefined → warning", async () => {
  const { mapSeverityToLevel } = await import("../scripts/reports-to-sarif.mjs");
  assert.equal(mapSeverityToLevel(undefined), "warning");
});

test("mapSeverityToLevel: case-insensitive", async () => {
  const { mapSeverityToLevel } = await import("../scripts/reports-to-sarif.mjs");
  assert.equal(mapSeverityToLevel("high"), "error");
  assert.equal(mapSeverityToLevel("CrItIcAl"), "error");
  assert.equal(mapSeverityToLevel("moderate"), "warning");
});

// Tests para extractCvssScore

test("extractCvssScore: extrae CVSS_V3", async () => {
  const { extractCvssScore } = await import("../scripts/reports-to-sarif.mjs");
  const data = {
    severity: [
      { type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L" }
    ]
  };
  assert.equal(extractCvssScore(data), "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L");
});

test("extractCvssScore: sin severity → undefined", async () => {
  const { extractCvssScore } = await import("../scripts/reports-to-sarif.mjs");
  const data = {};
  assert.equal(extractCvssScore(data), undefined);
});

test("extractCvssScore: severity no array → undefined", async () => {
  const { extractCvssScore } = await import("../scripts/reports-to-sarif.mjs");
  const data = { severity: "HIGH" };
  assert.equal(extractCvssScore(data), undefined);
});

// Tests para extractPackageName

test("extractPackageName: extrae nombre de affected[0]", async () => {
  const { extractPackageName } = await import("../scripts/reports-to-sarif.mjs");
  const data = {
    affected: [
      { package: { name: "lodash", ecosystem: "npm" } }
    ]
  };
  assert.equal(extractPackageName(data), "lodash");
});

test("extractPackageName: sin affected → undefined", async () => {
  const { extractPackageName } = await import("../scripts/reports-to-sarif.mjs");
  const data = {};
  assert.equal(extractPackageName(data), undefined);
});

test("extractPackageName: affected vacío → undefined", async () => {
  const { extractPackageName } = await import("../scripts/reports-to-sarif.mjs");
  const data = { affected: [] };
  assert.equal(extractPackageName(data), undefined);
});

// Tests para D3: truncateOutput

test("truncateOutput: texto corto pasa sin cambios", () => {
  const short = "Hello world";
  assert.equal(truncateOutput(short, 100), short);
});

test("truncateOutput: texto largo se trunca", () => {
  const long = "a".repeat(5000);
  const truncated = truncateOutput(long, 100);
  assert.ok(truncated.length < long.length);
  assert.ok(truncated.includes("[... truncated ...]"));
});

test("truncateOutput: preserva inicio y fin", () => {
  const text = "START" + "x".repeat(5000) + "END";
  const truncated = truncateOutput(text, 200);
  assert.ok(truncated.startsWith("START"));
  assert.ok(truncated.endsWith("END"));
  assert.ok(truncated.includes("[... truncated ...]"));
});

test("truncateOutput: respeta maxBytes", () => {
  const long = "a".repeat(10000);
  const truncated = truncateOutput(long, 500);
  // Debe ser <= 500 (aproximado, con el separador)
  assert.ok(truncated.length <= 550); // margen para el separador
});

// Tests para deduceTargetPath

test("deduceTargetPath: extrae targets/vuln-app de git status", async () => {
  const mockIo: Io = {
    cwd: "/project",
    fetch: async () => ({ ok: true } as any),
    git: async (args: string[]) => {
      if (args[0] === "status") {
        return {
          code: 0,
          stdout: " M targets/vuln-app/package.json\n M targets/vuln-app/index.js\n",
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    readFile: () => "{}",
    writeFile: () => {},
    dirExists: () => true,
    env: {},
  };
  
  const result = await deduceTargetPath(mockIo);
  assert.equal(result, "targets/vuln-app");
});

test("deduceTargetPath: fallback a 'targets' si no hay match", async () => {
  const mockIo: Io = {
    cwd: "/project",
    fetch: async () => ({ ok: true } as any),
    git: async (args: string[]) => {
      if (args[0] === "status") {
        return {
          code: 0,
          stdout: " M README.md\n M src/index.ts\n",
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    readFile: () => "{}",
    writeFile: () => {},
    dirExists: () => true,
    env: {},
  };
  
  const result = await deduceTargetPath(mockIo);
  assert.equal(result, "targets");
});

test("deduceTargetPath: fallback a 'targets' si git falla", async () => {
  const mockIo: Io = {
    cwd: "/project",
    fetch: async () => ({ ok: true } as any),
    git: async () => {
      throw new Error("git not available");
    },
    readFile: () => "{}",
    writeFile: () => {},
    dirExists: () => true,
    env: {},
  };
  
  const result = await deduceTargetPath(mockIo);
  assert.equal(result, "targets");
});

test("deduceTargetPath: extrae primer target de múltiples", async () => {
  const mockIo: Io = {
    cwd: "/project",
    fetch: async () => ({ ok: true } as any),
    git: async (args: string[]) => {
      if (args[0] === "status") {
        return {
          code: 0,
          stdout: " M targets/app1/package.json\n M targets/app2/package.json\n",
          stderr: "",
        };
      }
      return { code: 0, stdout: "", stderr: "" };
    },
    readFile: () => "{}",
    writeFile: () => {},
    dirExists: () => true,
    env: {},
  };
  
  const result = await deduceTargetPath(mockIo);
  assert.equal(result, "targets/app1");
});
