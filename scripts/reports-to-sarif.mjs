#!/usr/bin/env node
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

// Q&D: Lee CVE JSONs de reports/cve/ y emite SARIF 2.1.0 mínimo
const reportsDir = 'reports/cve';
const outputFile = 'cve.sarif';

const files = readdirSync(reportsDir).filter(f => f.endsWith('.json'));
const results = [];
const rules = [];

files.forEach(f => {
  const path = join(reportsDir, f);
  const raw = readFileSync(path, 'utf8');
  const data = JSON.parse(raw);
  
  // Hardcode: asume que el JSON tiene id, severity, description (ajustar según estructura real)
  const cveId = data.id || data.cve_id || f.replace('.json', '');
  const message = data.summary || data.description || `Vulnerability ${cveId}`;
  const severity = data.severity || 'MODERATE';
  
  // Mapear severity a level SARIF (q&d: todo error)
  const level = 'error';
  
  rules.push({
    id: cveId,
    name: cveId,
    shortDescription: { text: `CVE ${cveId}` },
    fullDescription: { text: message },
    defaultConfiguration: { level }
  });
  
  results.push({
    ruleId: cveId,
    level,
    message: { text: message },
    locations: [{
      physicalLocation: {
        artifactLocation: { uri: 'package.json' },
        region: { startLine: 1 }
      }
    }]
  });
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
