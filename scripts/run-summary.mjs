#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const AUDIT_PATH = '.pi/ci-audit.jsonl';
const REPORTS_DIR = 'reports/cve';
const OUTPUT_PATH = 'run-summary.json';

// Hardcoded happy-path: lee audit, cuenta líneas
let toolCalls = 0;
if (fs.existsSync(AUDIT_PATH)) {
  const lines = fs.readFileSync(AUDIT_PATH, 'utf8').split('\n').filter(l => l.trim());
  toolCalls = lines.length;
}

// Lee reports CVE
const cves = [];
if (fs.existsSync(REPORTS_DIR)) {
  const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const data = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, file), 'utf8'));
    cves.push({
      id: data.id || null,
      status: 'reported',
      pkg: data.pkg || null,              // hardcodeo null si no existe
      fixedVersion: data.fixedVersion || null
    });
  }
}

const summary = {
  runId: Date.now(),
  generatedAt: new Date().toISOString(),
  durationMs: 0,  // hardcodeo 0, no hay fuente
  cves,
  toolCalls,
  model: process.env.PI_MODEL || null
};

fs.writeFileSync(OUTPUT_PATH, JSON.stringify(summary, null, 2));

// Salida humana
const msg = `RUN SUMMARY: ${cves.length} CVEs, ${toolCalls} tool-calls`;
console.log(msg);

// Markdown a GITHUB_STEP_SUMMARY si existe
if (process.env.GITHUB_STEP_SUMMARY) {
  const md = `
## Run Summary
- **CVEs reported:** ${cves.length}
- **Tool calls:** ${toolCalls}
- **Model:** ${summary.model || 'N/A'}
- **Run ID:** ${summary.runId}
`;
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
