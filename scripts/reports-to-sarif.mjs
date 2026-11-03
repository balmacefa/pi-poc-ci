#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

// Lee CVE JSONs de reports/cve/ y emite SARIF 2.1.0 con severity real y locations precisas
const reportsDir = 'reports/cve';
const outputFile = 'cve.sarif';

/**
 * Mapea severity de OSV/GHSA a nivel SARIF.
 * @param {string} severity - Severity raw del CVE (LOW, MODERATE, HIGH, CRITICAL)
 * @returns {'warning' | 'error'}
 */
export function mapSeverityToLevel(severity) {
  if (!severity) return 'warning';
  const s = severity.toUpperCase();
  if (s === 'HIGH' || s === 'CRITICAL') return 'error';
  return 'warning';
}

/**
 * Extrae el score CVSS si está disponible.
 * @param {object} data - JSON del CVE
 * @returns {string | undefined}
 */
export function extractCvssScore(data) {
  if (data.severity && Array.isArray(data.severity)) {
    const cvss = data.severity.find(s => s.type === 'CVSS_V3' || s.type === 'CVSS_V2');
    if (cvss?.score) return cvss.score;
  }
  return undefined;
}

/**
 * Extrae el nombre del paquete afectado.
 * @param {object} data - JSON del CVE
 * @returns {string | undefined}
 */
export function extractPackageName(data) {
  if (data.affected && Array.isArray(data.affected) && data.affected.length > 0) {
    return data.affected[0].package?.name;
  }
  return undefined;
}

if (!existsSync(reportsDir)) {
  // Fallback: reports/cve no existe, emitir SARIF vacío válido
  const emptySarif = {
    version: '2.1.0',
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    runs: [{
      tool: {
        driver: {
          name: 'CVE Scanner',
          version: '1.0.0',
          informationUri: 'https://github.com/balmacefa/pi-poc-ci',
          rules: []
        }
      },
      results: []
    }]
  };
  writeFileSync(outputFile, JSON.stringify(emptySarif, null, 2));
  console.log(`⚠ ${reportsDir} not found; generated empty ${outputFile}`);
  process.exit(0);
}

const files = readdirSync(reportsDir).filter(f => f.endsWith('.json'));

if (files.length === 0) {
  // Fallback: reports/cve vacío, emitir SARIF vacío válido
  const emptySarif = {
    version: '2.1.0',
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    runs: [{
      tool: {
        driver: {
          name: 'CVE Scanner',
          version: '1.0.0',
          informationUri: 'https://github.com/balmacefa/pi-poc-ci',
          rules: []
        }
      },
      results: []
    }]
  };
  writeFileSync(outputFile, JSON.stringify(emptySarif, null, 2));
  console.log(`⚠ No CVE JSONs in ${reportsDir}; generated empty ${outputFile}`);
  process.exit(0);
}

const results = [];
const rules = [];

files.forEach(f => {
  const path = join(reportsDir, f);
  const raw = readFileSync(path, 'utf8');
  const data = JSON.parse(raw);
  
  const cveId = data.id || data.cve_id || f.replace('.json', '');
  const message = data.summary || data.description || `Vulnerability ${cveId}`;
  
  // Extraer severity real de database_specific.severity o severity array
  const severityRaw = data.database_specific?.severity || data.severity?.[0]?.type || 'MODERATE';
  const level = mapSeverityToLevel(severityRaw);
  
  // Extraer CVSS score si está disponible
  const cvssScore = extractCvssScore(data);
  
  // Extraer nombre del paquete afectado
  const packageName = extractPackageName(data);
  
  // Location real: apuntar a targets/vuln-app/package.json si tenemos el paquete
  const uri = packageName ? 'targets/vuln-app/package.json' : 'package.json';
  
  const properties = {};
  if (cvssScore) properties.cvssScore = cvssScore;
  if (packageName) properties.affectedPackage = packageName;
  
  rules.push({
    id: cveId,
    name: cveId,
    shortDescription: { text: `CVE ${cveId}` },
    fullDescription: { text: message },
    defaultConfiguration: { level },
    properties: Object.keys(properties).length > 0 ? properties : undefined
  });
  
  const result = {
    ruleId: cveId,
    level,
    message: { text: message },
    locations: [{
      physicalLocation: {
        artifactLocation: { uri },
        region: { startLine: 1 }
      }
    }]
  };
  
  if (Object.keys(properties).length > 0) {
    result.properties = properties;
  }
  
  results.push(result);
});

const sarif = {
  version: '2.1.0',
  $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
  runs: [{
    tool: {
      driver: {
        name: 'CVE Scanner',
        version: '1.0.0',
        informationUri: 'https://github.com/balmacefa/pi-poc-ci',
        rules
      }
    },
    results
  }]
};

writeFileSync(outputFile, JSON.stringify(sarif, null, 2));
console.log(`✓ Generated ${outputFile} with ${results.length} CVEs`);
