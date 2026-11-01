#!/usr/bin/env node
/**
 * sync-pact.mjs — inyecta el protocolo PACT canónico (swarm/_pact.md) en todos
 * los agentes del enjambre (~/.pi/agent/agents/*.md), entre marcadores, de forma
 * idempotente. Fuente de verdad única: edita _pact.md y re-ejecuta esto.
 *
 *   node ~/.pi/agent/swarm/sync-pact.mjs
 *
 * - Reemplaza la región entre <!-- PACT:START --> y <!-- PACT:END --> si existe.
 * - Si no hay marcadores pero sí un bloque viejo sin marcar (encabezado
 *   "## Protocolo de enjambre — PACT"), lo recorta y lo re-inyecta con marcadores.
 * - Omite archivos sin frontmatter válido (name/description) y el propio _pact.md.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const START = "<!-- PACT:START (auto-generado desde swarm/_pact.md — no editar a mano) -->";
const END = "<!-- PACT:END -->";

const swarmDir = dirname(fileURLToPath(import.meta.url));
const agentDir = join(swarmDir, "..");
const agentsDir = join(agentDir, "agents");

const body = readFileSync(join(swarmDir, "_pact.md"), "utf8").trim();
const block = `${START}\n\n---\n\n${body}\n\n${END}`;

function hasValidFrontmatter(txt) {
  const m = txt.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return false;
  return /\bname:\s*\S/.test(m[1]) && /\bdescription:\s*\S/.test(m[1]);
}

function stripExisting(txt) {
  // 1) región con marcadores (el bloque siempre se agrega al final => descarta lo posterior)
  const s = txt.indexOf(START);
  if (s >= 0) return txt.slice(0, s).replace(/\s+$/, "");
  // 2) bloque viejo sin marcar: "## Protocolo de enjambre — PACT"
  const h = txt.indexOf("## Protocolo de enjambre — PACT");
  if (h >= 0) {
    // retrocede hasta el separador '---' que lo precede (en su propia línea)
    const before = txt.slice(0, h);
    const sepIdx = before.lastIndexOf("\n---");
    const cut = sepIdx >= 0 ? sepIdx : h;
    return txt.slice(0, cut).replace(/\s+$/, "");
  }
  return txt.replace(/\s+$/, "");
}

let updated = 0,
  skipped = 0;
for (const f of readdirSync(agentsDir).filter((f) => f.endsWith(".md"))) {
  const p = join(agentsDir, f);
  const txt = readFileSync(p, "utf8");
  if (!hasValidFrontmatter(txt)) {
    skipped++;
    continue;
  }
  const base = stripExisting(txt);
  const next = `${base}\n\n${block}\n`;
  if (next !== txt) {
    writeFileSync(p, next);
    updated++;
    console.log(`  ✓ ${f}`);
  } else {
    console.log(`  = ${f} (sin cambios)`);
  }
}
console.log(`PACT sync: ${updated} actualizados, ${skipped} omitidos (sin frontmatter válido).`);
