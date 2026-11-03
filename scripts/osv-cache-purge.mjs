#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const FIXTURES_DIR = 'fixtures/osv';

let count = 0;
if (fs.existsSync(FIXTURES_DIR)) {
  const files = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.json'));
  for (const file of files) {
    fs.unlinkSync(path.join(FIXTURES_DIR, file));
    count++;
  }
}

console.log(`Purged ${count} OSV fixture(s) from ${FIXTURES_DIR}`);
