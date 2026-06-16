// Post-build smoke check: assert the three bundles exist. Exit non-zero on failure.
import { existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const required = [
  'out/main/main.js',
  'out/preload/preload.js',
  'out/renderer/index.html',
];

let ok = true;
console.log('verify-build: checking bundles…');
for (const rel of required) {
  const abs = resolve(root, rel);
  if (existsSync(abs) && statSync(abs).size > 0) {
    console.log(`  ✓ ${rel} (${statSync(abs).size} bytes)`);
  } else {
    console.error(`  ✗ MISSING or empty: ${rel}`);
    ok = false;
  }
}

if (!ok) {
  console.error('verify-build: FAILED');
  process.exit(1);
}
console.log('verify-build: PASS');
