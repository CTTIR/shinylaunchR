import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IconManager } from '../src/main/icons';
import { ICON_SCRIPT } from '../src/main/r-scripts';
import type { AppEntry } from '@shared/types';
import type { RRuntimeManager } from '../src/main/r-runtime';
import type { RunOptions } from '../src/main/process-manager';
let dir: string;
const id = '12345678-1234-1234-1234-123456789abc';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-test-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});
function image(): string {
  const file = path.join(dir, 'logo #?.png');
  fs.writeFileSync(file, 'fake image');
  return file;
}
it('copies selected icons and serves only its narrow protocol instead of file URLs', () => {
  const icons = new IconManager(path.join(dir, 'cache'));
  const copied = icons.copyUserIcon(image(), id)!;
  const url = icons.url(copied)!;
  expect(url).toBe(`slr-icon://cache/user-${id}.png`);
  expect(icons.resolveUrl(url)).toBe(copied);
  expect(icons.url(path.join(dir, 'outside.png'))).toBeUndefined();
  for (const invalid of [
    'file:///etc/passwd',
    'slr-icon://cache/../outside.png',
    'slr-icon://evil/' + id + '.png',
    `slr-icon://cache/${id}.png?x=1`,
    'slr-icon://cache/%2e%2e%2foutside.png',
  ])
    expect(() => icons.resolveUrl(invalid)).toThrow();
});
it('clearCache retains user-selected icons while deleting discovered icons', () => {
  const icons = new IconManager(path.join(dir, 'cache'));
  const source = image();
  const user = icons.copyUserIcon(source, id)!;
  const discovered = icons.copyUserIcon(source, id, false)!;
  expect(icons.clearCache()).toBe(1);
  expect(fs.existsSync(user)).toBe(true);
  expect(fs.existsSync(discovered)).toBe(false);
});
it('refuses unsafe identifiers, extensions, oversized images and symlink output paths', () => {
  const icons = new IconManager(path.join(dir, 'cache'));
  const src = image();
  expect(() => icons.copyUserIcon(src, '../escape')).toThrow();
  const txt = path.join(dir, 'x.txt');
  fs.writeFileSync(txt, 'x');
  expect(() => icons.copyUserIcon(txt, id)).toThrow();
  const large = path.join(dir, 'large.png');
  fs.writeFileSync(large, Buffer.alloc(5 * 1024 * 1024 + 1));
  expect(() => icons.copyUserIcon(large, id)).toThrow();
  fs.mkdirSync(icons.cacheDir, { recursive: true });
  const victim = path.join(dir, 'outside');
  fs.writeFileSync(victim, 'keep');
  fs.symlinkSync(victim, path.join(icons.cacheDir, `user-${id}.png`));
  expect(() => icons.copyUserIcon(src, id)).toThrow();
  expect(fs.readFileSync(victim, 'utf8')).toBe('keep');
});
it('uses the constant help/figures lookup script with package data in environment', async () => {
  const logo = image();
  const signal = new AbortController().signal;
  const startScript = vi.fn(
    (_cmd: string, _script: string, _opts: RunOptions) => ({
      done: Promise.resolve({ code: 0, stdout: logo + '\n', stderr: '' }),
    }),
  );
  const runtime = {
    ready: vi.fn(async () => ({ rPath: '/fake/Rscript' })),
    processes: { startScript },
    childEnv: (env: NodeJS.ProcessEnv) => env,
  } as unknown as RRuntimeManager;
  const icons = new IconManager(path.join(dir, 'cache'));
  const found = await icons.resolvePackageIcon(
    { id, pkg: 'testpkg' } as AppEntry,
    runtime,
    signal,
  );
  expect(found).toBe(path.join(icons.cacheDir, `${id}.png`));
  expect(startScript).toHaveBeenCalledWith(
    '/fake/Rscript',
    ICON_SCRIPT,
    expect.objectContaining({
      signal,
      env: { SLR_PACKAGE: 'testpkg' },
      timeoutMs: 10000,
    }),
  );
  expect(ICON_SCRIPT).toContain(
    'system.file("help","figures","logo.png",package=pkg)',
  );
  expect(ICON_SCRIPT).not.toContain('testpkg');
});
it('never accepts icon output from a failed lookup process', async () => {
  const logo = image();
  const runtime = {
    ready: async () => ({ rPath: '/fake/Rscript' }),
    processes: {
      startScript: () => ({
        done: Promise.resolve({ code: 1, stdout: logo, stderr: 'failed' }),
      }),
    },
    childEnv: (env: NodeJS.ProcessEnv) => env,
  } as unknown as RRuntimeManager;
  expect(
    await new IconManager(path.join(dir, 'cache')).resolvePackageIcon(
      { id, pkg: 'testpkg' } as AppEntry,
      runtime,
    ),
  ).toBeUndefined();
});
