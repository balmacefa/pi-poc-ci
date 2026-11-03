#!/usr/bin/env node
/**
 * security-report.mjs — Genera reporte HTML autocontenido + badge SVG
 * del análisis de CVEs del enjambre pi-poc-ci
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Leer run-summary.json
let summary = null;
const summaryPath = path.join(rootDir, 'run-summary.json');
if (fs.existsSync(summaryPath)) {
  summary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
}

// Leer todos los CVE reports
const cveDir = path.join(rootDir, 'reports', 'cve');
const cveFiles = fs.existsSync(cveDir) 
  ? fs.readdirSync(cveDir).filter(f => f.endsWith('.json'))
  : [];

const cves = cveFiles.map(f => {
  const data = JSON.parse(fs.readFileSync(path.join(cveDir, f), 'utf-8'));
  return data;
});

// Combinar con summary si existe
if (summary && summary.cves) {
  cves.forEach(cve => {
    const summaryItem = summary.cves.find(s => s.id === cve.id);
    if (summaryItem) {
      cve.status = summaryItem.status;
      cve.pkg = summaryItem.pkg;
      cve.fixedVersion = summaryItem.fixedVersion;
    }
  });
}

// Calcular stats
const stats = {
  total: cves.length,
  critical: cves.filter(c => c.database_specific?.severity === 'CRITICAL').length,
  high: cves.filter(c => c.database_specific?.severity === 'HIGH').length,
  moderate: cves.filter(c => c.database_specific?.severity === 'MODERATE').length,
  low: cves.filter(c => c.database_specific?.severity === 'LOW').length,
  patched: cves.filter(c => c.status === 'patched').length,
  verified: cves.filter(c => c.status === 'verified').length,
  toolCalls: summary?.toolCalls || 0,
  model: summary?.model || 'N/A',
  generatedAt: summary?.generatedAt || new Date().toISOString(),
};

// Helper: badge de severidad
function severityBadge(severity) {
  const colors = {
    CRITICAL: '#dc2626',
    HIGH: '#ea580c',
    MODERATE: '#f59e0b',
    LOW: '#6b7280',
  };
  const color = colors[severity] || '#6b7280';
  return `<span style="display: inline-block; padding: 0.25rem 0.75rem; border-radius: 0.375rem; font-size: 0.75rem; font-weight: 600; color: white; background: ${color};">${severity || 'UNKNOWN'}</span>`;
}

// Helper: badge de estado
function statusBadge(status) {
  const colors = {
    verified: '#10b981',
    patched: '#3b82f6',
    reported: '#8b5cf6',
    failed: '#ef4444',
  };
  const color = colors[status] || '#6b7280';
  return `<span style="display: inline-block; padding: 0.25rem 0.75rem; border-radius: 0.375rem; font-size: 0.75rem; font-weight: 500; color: white; background: ${color};">${status || 'pending'}</span>`;
}

// Generar HTML
const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>pi-poc-ci — Security Report</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg-dark: #0a0a0a;
      --bg-card: #1a1a1a;
      --bg-table: #151515;
      --text-primary: #e8e8e8;
      --text-secondary: #a0a0a0;
      --accent: #00d4ff;
      --border: #2a2a2a;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-dark);
      color: var(--text-primary);
      line-height: 1.6;
      padding: 2rem;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    
    /* Header */
    .header {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      padding: 3rem 2rem;
      border-radius: 1rem;
      margin-bottom: 2rem;
      border: 1px solid var(--border);
    }
    .header h1 {
      font-size: 2.5rem;
      font-weight: 800;
      background: linear-gradient(135deg, var(--accent) 0%, #0099cc 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 0.5rem;
    }
    .header .timestamp {
      color: var(--text-secondary);
      font-size: 0.875rem;
    }
    
    /* KPIs */
    .kpis {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .kpi {
      background: var(--bg-card);
      padding: 1.5rem;
      border-radius: 0.75rem;
      border: 1px solid var(--border);
    }
    .kpi-value {
      font-size: 2.5rem;
      font-weight: 700;
      color: var(--accent);
      line-height: 1;
      margin-bottom: 0.5rem;
    }
    .kpi-label {
      color: var(--text-secondary);
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    
    /* Table section */
    .section {
      background: var(--bg-card);
      padding: 2rem;
      border-radius: 0.75rem;
      border: 1px solid var(--border);
      margin-bottom: 2rem;
    }
    .section h2 {
      font-size: 1.5rem;
      margin-bottom: 1.5rem;
      color: var(--text-primary);
    }
    
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--bg-table);
      border-radius: 0.5rem;
      overflow: hidden;
    }
    thead {
      background: rgba(0, 212, 255, 0.1);
    }
    th, td {
      padding: 0.875rem 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      font-weight: 600;
      font-size: 0.875rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-secondary);
    }
    tbody tr:hover {
      background: rgba(0, 212, 255, 0.05);
    }
    tbody tr:last-child td {
      border-bottom: none;
    }
    td a {
      color: var(--accent);
      text-decoration: none;
    }
    td a:hover {
      text-decoration: underline;
    }
    .pkg-cell {
      font-family: 'Courier New', monospace;
      font-size: 0.875rem;
    }
    
    /* Footer */
    .footer {
      text-align: center;
      padding: 2rem;
      color: var(--text-secondary);
      font-size: 0.875rem;
      border-top: 1px solid var(--border);
      margin-top: 2rem;
    }
    .footer strong {
      color: var(--accent);
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header -->
    <div class="header">
      <h1>pi-poc-ci — Security Report</h1>
      <div class="timestamp">Generated: ${new Date(stats.generatedAt).toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}</div>
    </div>
    
    <!-- KPIs -->
    <div class="kpis">
      <div class="kpi">
        <div class="kpi-value">${stats.total}</div>
        <div class="kpi-label">CVEs Found</div>
      </div>
      <div class="kpi">
        <div class="kpi-value">${stats.patched + stats.verified}</div>
        <div class="kpi-label">Patched + Verified</div>
      </div>
      <div class="kpi">
        <div class="kpi-value">${stats.critical + stats.high}</div>
        <div class="kpi-label">Critical + High</div>
      </div>
      <div class="kpi">
        <div class="kpi-value">${stats.toolCalls}</div>
        <div class="kpi-label">Tool Calls</div>
      </div>
      <div class="kpi">
        <div class="kpi-value" style="font-size: 1.25rem;">${stats.model}</div>
        <div class="kpi-label">Model</div>
      </div>
    </div>
    
    <!-- CVEs Table -->
    <div class="section">
      <h2>Vulnerabilities (${stats.total})</h2>
      <table>
        <thead>
          <tr>
            <th>CVE ID</th>
            <th>Package</th>
            <th>Severity</th>
            <th>Status</th>
            <th>Fix Version</th>
            <th>Summary</th>
          </tr>
        </thead>
        <tbody>
          ${cves.length === 0 ? '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">No CVEs found</td></tr>' : ''}
          ${cves.map(cve => {
            const pkg = cve.affected?.[0]?.package?.name || cve.pkg || 'N/A';
            const severity = cve.database_specific?.severity || 'UNKNOWN';
            const status = cve.status || 'pending';
            const fixVersion = cve.fixedVersion || cve.affected?.[0]?.ranges?.[0]?.events?.find(e => e.fixed)?.fixed || 'N/A';
            const summary = (cve.summary || '').substring(0, 100) + (cve.summary?.length > 100 ? '...' : '');
            
            return `
            <tr>
              <td><a href="https://osv.dev/vulnerability/${cve.id}" target="_blank" rel="noopener">${cve.id}</a></td>
              <td class="pkg-cell">${pkg}</td>
              <td>${severityBadge(severity)}</td>
              <td>${statusBadge(status)}</td>
              <td class="pkg-cell">${fixVersion}</td>
              <td style="max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${summary}</td>
            </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
    
    <!-- Footer -->
    <div class="footer">
      Generado por el enjambre de <strong>pi</strong> — Autonomous CVE remediation
    </div>
  </div>
</body>
</html>`;

// Guardar HTML
const reportPath = path.join(rootDir, 'site', 'report.html');
fs.writeFileSync(reportPath, html, 'utf-8');
console.log('✓ site/report.html generado');

// Generar badge SVG (shields.io style)
const hasCritical = stats.critical > 0;
const badgeColor = hasCritical ? '#dc2626' : '#10b981';
const badgeText = `${stats.total} found`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="140" height="20" role="img" aria-label="CVEs: ${badgeText}">
  <title>CVEs: ${badgeText}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="140" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="45" height="20" fill="#555"/>
    <rect x="45" width="95" height="20" fill="${badgeColor}"/>
    <rect width="140" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="22.5" y="14" fill="#010101" fill-opacity=".3">CVEs</text>
    <text x="22.5" y="13">CVEs</text>
    <text x="91.5" y="14" fill="#010101" fill-opacity=".3">${badgeText}</text>
    <text x="91.5" y="13">${badgeText}</text>
  </g>
</svg>`;

const badgePath = path.join(rootDir, 'site', 'security-badge.svg');
fs.writeFileSync(badgePath, svg, 'utf-8');
console.log('✓ site/security-badge.svg generado');

console.log('\n📊 Stats:');
console.log(`   Total CVEs: ${stats.total}`);
console.log(`   Critical: ${stats.critical} | High: ${stats.high} | Moderate: ${stats.moderate} | Low: ${stats.low}`);
console.log(`   Patched: ${stats.patched} | Verified: ${stats.verified}`);
console.log(`\n🎯 Abre site/report.html para ver el reporte completo.`);
