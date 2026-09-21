import { mkdtemp, readFile, rm, access, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const axePath = require.resolve('axe-core/axe.min.js');

if (!process.argv[2]) throw new Error('Usage: node scripts/smoke-packaged.mjs <executable>');
let executable = process.argv[2];
if (executable === '--auto') {
  const candidates = process.platform === 'win32' ? ['dist/win-unpacked/shinylaunchR.exe']
    : process.platform === 'darwin' ? [`dist/${process.arch === 'arm64' ? 'mac-arm64' : 'mac'}/shinylaunchR.app/Contents/MacOS/shinylaunchR`]
    : [`dist/${process.arch === 'x64' ? 'linux-unpacked' : `linux-${process.arch}-unpacked`}/shinylaunchr`];
  executable = candidates[0];
  await access(executable);
}
const root = await mkdtemp(join(tmpdir(), 'shinylaunchr-smoke-'));
try {
  const child = spawn(resolve(executable), ['--smoke-test'], {
    env: { ...process.env, SLR_SMOKE_ROOT: root, SLR_SMOKE_AXE_PATH: axePath, ELECTRON_RUN_AS_NODE: undefined }, stdio: 'inherit',
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 60_000);
  const code = await new Promise((res, rej) => { child.once('error', rej); child.once('exit', res); }).finally(() => clearTimeout(timer));
  const report = await readFile(join(root, 'smoke-result.json'), 'utf8').then(JSON.parse).catch(() => ({ ok: false, error: `No smoke receipt; process exited ${code}` }));
  if (process.env.SLR_SMOKE_RECEIPT) {
    const receipt = resolve(process.env.SLR_SMOKE_RECEIPT);
    await mkdir(dirname(receipt), { recursive: true });
    await copyFile(join(root, 'dashboard.png'), receipt + '.png').catch(() => {});
    await writeFile(receipt, JSON.stringify({ platform: process.platform, arch: process.arch, ...report }, null, 2) + '\n');
  }
  if (code !== 0) throw new Error(`Packaged smoke exited ${code}: ${JSON.stringify(report)}`);
  if (report.ok !== true) throw new Error(`Packaged smoke failed: ${JSON.stringify(report)}`);
  console.log(JSON.stringify(report, null, 2));
} finally { await rm(root, { recursive: true, force: true }); }
