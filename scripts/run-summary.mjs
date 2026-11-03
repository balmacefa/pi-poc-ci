#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const AUDIT_PATH = '.pi/ci-audit.jsonl';
const REPORTS_DIR = 'reports/cve';
const OUTPUT_PATH = 'run-summary.json';

// Calculate durationMs from audit timestamps
let toolCalls = 0;
let durationMs = 0;
if (fs.existsSync(AUDIT_PATH)) {
  try {
    const lines = fs.readFileSync(AUDIT_PATH, 'utf8').split('\n').filter(l => l.trim());
    toolCalls = lines.length;
    
    if (lines.length > 0) {
      let firstTs = null;
      let lastTs = null;
      
      for (const line of lines) {
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
          // Skip malformed lines
        }
      }
      
      if (firstTs !== null && lastTs !== null) {
        durationMs = lastTs - firstTs;
      }
    }
  } catch {
    // If audit read fails, leave toolCalls=0, durationMs=0
  }
}

// Parse CVE reports with real pkg and fixedVersion extraction
const cves = [];
let errors = 0;
if (fs.existsSync(REPORTS_DIR)) {
  const files = fs.readdirSync(REPORTS_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, file), 'utf8'));
      
      // Extract pkg from affected[].package.name (first one)
      let pkg = null;
      if (data.affected && Array.isArray(data.affected) && data.affected.length > 0) {
        pkg = data.affected[0].package?.name || null;
      }
      
      // Extract fixedVersion from affected[].ranges[].events[].fixed (first found)
      let fixedVersion = null;
      if (data.affected && Array.isArray(data.affected)) {
        outer: for (const aff of data.affected) {
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
      
      cves.push({
        id: data.id || null,
        status: 'reported',
        pkg,
        fixedVersion
      });
    } catch {
      // Skip malformed JSON, count as error
      errors++;
    }
  }
}

const summary = {
  runId: Date.now(),
  generatedAt: new Date().toISOString(),
  durationMs,
  cves,
  toolCalls,
  errors,
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
