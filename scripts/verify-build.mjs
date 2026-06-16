// Post-build smoke check: assert the three bundles exist AND that the main/
// preload entry module format agrees with package.json "type" — a mismatch
// (e.g. type:module + a CJS `require(` entry) crashes the packaged app on
// launch with "require is not defined in ES module scope". Exit non-zero on any
// failure.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const required = ['out/main/main.js', 'out/preload/preload.js', 'out/renderer/index.html'];

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

// --- module-format consistency guard ---------------------------------------
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));
const isEsmPackage = pkg.type === 'module';
const mainEntry = resolve(root, pkg.main ?? 'out/main/main.js');

function classifyModule(file) {
  if (file.endsWith('.cjs')) return 'cjs';
  if (file.endsWith('.mjs')) return 'esm';
  const src = existsSync(file) ? readFileSync(file, 'utf-8') : '';
  // A bundled CJS file has top-level `require(`/`module.exports`; ESM has neither
  // (it uses import/export). This is a coarse but reliable signal for our bundles.
  const looksCjs = /(^|\n)\s*(const|var|let)?[^\n]*\brequire\(/.test(src) || /module\.exports/.test(src);
  return looksCjs ? 'cjs' : 'esm';
}

const mainFormat = classifyModule(mainEntry);
const expected = isEsmPackage ? 'esm' : 'cjs';
if (mainFormat === expected) {
  console.log(
    `  ✓ main entry format (${mainFormat}) matches package.json type (${pkg.type ?? 'commonjs'})`,
  );
} else {
  console.error(
    `  ✗ MODULE MISMATCH: package.json type=${pkg.type ?? 'commonjs'} expects ${expected}, ` +
      `but ${pkg.main} looks like ${mainFormat}. The packaged app would crash on launch.`,
  );
  ok = false;
}

if (!ok) {
  console.error('verify-build: FAILED');
  process.exit(1);
}
console.log('verify-build: PASS');
