import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import type {
  ProcessManager,
  ProcessResult,
} from '../src/main/process-manager';
import { RUNTIME_SCRIPT } from '../src/main/r-scripts';
import {
  compareVersions,
  findSystemRscript,
  managedRscriptCandidates,
  meetsMinimum,
  parseRVersion,
  resolveManagedRscript,
  RRuntimeManager,
  type FsLike,
} from '../src/main/r-runtime';

function fakeFs(existing: string[]): FsLike {
  const set = new Set(existing.map((p) => p.replace(/\\/g, '/')));
  return { existsSync: (p: string) => set.has(p.replace(/\\/g, '/')) };
}

describe('parseRVersion', () => {
  it('parses `R --version` banner', () => {
    expect(
      parseRVersion('R version 4.4.2 (2024-10-31) -- "Pile of Leaves"'),
    ).toBe('4.4.2');
  });
  it('parses `Rscript --version` output', () => {
    expect(
      parseRVersion('R scripting front-end version 4.3.1 (2023-06-16)'),
    ).toBe('4.3.1');
  });
  it('returns undefined when no version present', () => {
    expect(parseRVersion('no numbers here')).toBeUndefined();
  });
});

describe('version comparison', () => {
  it('orders versions', () => {
    expect(compareVersions('4.4.2', '4.4.2')).toBe(0);
    expect(compareVersions('4.2.0', '4.4.0')).toBe(-1);
    expect(compareVersions('4.5', '4.4.9')).toBe(1);
  });
  it('enforces the minimum', () => {
    expect(meetsMinimum('4.4.2')).toBe(true);
    expect(meetsMinimum('4.1.3')).toBe(false);
  });
});

describe('managed Rscript resolution', () => {
  it('lists platform-correct candidates', () => {
    const win = managedRscriptCandidates('/rt', 'win32');
    expect(
      win.some((p) => p.endsWith(path.join('bin', 'x64', 'Rscript.exe'))),
    ).toBe(true);
    const mac = managedRscriptCandidates('/rt', 'darwin');
    expect(mac[0]).toContain(
      path.join('R.framework', 'Resources', 'bin', 'Rscript'),
    );
    const lin = managedRscriptCandidates('/rt', 'linux');
    expect(lin[0]).toBe(path.join('/rt', 'bin', 'Rscript'));
  });

  it('finds the first existing candidate', () => {
    const expected = path.join('/rt', 'bin', 'Rscript');
    const fs = fakeFs([expected]);
    expect(resolveManagedRscript('/rt', 'linux', fs)).toBe(expected);
  });

  it('returns undefined when none exist', () => {
    expect(resolveManagedRscript('/rt', 'linux', fakeFs([]))).toBeUndefined();
  });
});

describe('findSystemRscript', () => {
  it('scans PATH for the executable', () => {
    const exe = path.join('/usr/local/bin', 'Rscript');
    const env = { PATH: ['/nope', '/usr/local/bin'].join(':') };
    expect(findSystemRscript('linux', env, fakeFs([exe]))).toBe(exe);
  });
  it('returns undefined when absent', () => {
    expect(
      findSystemRscript('linux', { PATH: '/nope' }, fakeFs([])),
    ).toBeUndefined();
  });
  it.each([
    ['linux', ':', 'Rscript'],
    ['darwin', ':', 'Rscript'],
    ['win32', ';', 'Rscript.exe'],
  ] as const)('uses %s PATH separators and executable names', (platform, delimiter, name) => {
    const executable = path.join('second-bin', name);
    expect(findSystemRscript(platform, {
      PATH: ['first-bin', 'second-bin'].join(delimiter),
    }, fakeFs([executable]))).toBe(executable);
  });
});

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-test-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});
function processFixture(
  result: ProcessResult = {
    code: 0,
    stdout: 'SLR_RUNTIME:4.4.2:x86_64\n',
    stderr: '',
  },
) {
  const startScript = vi.fn(() => ({ done: Promise.resolve(result) }));
  const start = vi.fn(() => ({
    done: Promise.resolve({
      code: 0,
      stdout: 'R scripting front-end version 4.4.2',
      stderr: '',
    }),
  }));
  return {
    startScript,
    start,
    processes: { startScript, start } as unknown as ProcessManager,
  };
}
function executable(name = 'Rscript'): string {
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'fake executable');
  return file;
}
it('resolves managed runtime before system and explicitly selected runtime before both', () => {
  const f = processFixture();
  const custom = executable();
  const managed = path.join(dir, 'r-runtime', 'bin', 'Rscript');
  fs.mkdirSync(path.dirname(managed), { recursive: true });
  fs.writeFileSync(managed, 'fake');
  const mgr = new RRuntimeManager({
    userDataDir: dir,
    platform: 'linux',
    systemRscript: () => '/fake/system',
    processes: f.processes,
  });
  expect(mgr.resolveRscript()).toEqual({ rPath: managed, source: 'managed' });
  mgr.setCustomRscript(custom);
  expect(mgr.resolveRscript()).toEqual({ rPath: custom, source: 'custom' });
});
it('persists selection, revalidates after restart and scopes library by verified version and architecture', async () => {
  const f = processFixture();
  const custom = executable();
  new RRuntimeManager({
    userDataDir: dir,
    processes: f.processes,
  }).setCustomRscript(custom);
  const next = new RRuntimeManager({
    userDataDir: dir,
    processes: f.processes,
  });
  const status = await next.status();
  expect(status).toMatchObject({
    found: true,
    source: 'custom',
    rPath: custom,
    version: '4.4.2',
  });
  expect(path.basename(next.libraryPath)).toBe('4.4-x86_64');
  expect(f.startScript).toHaveBeenCalledWith(
    custom,
    RUNTIME_SCRIPT,
    expect.objectContaining({ owner: 'runtime', timeoutMs: process.platform === 'win32' ? 30000 : 10000 }),
  );
});
it('does not silently use system R when a saved custom executable disappeared', async () => {
  const f = processFixture();
  const custom = executable();
  new RRuntimeManager({
    userDataDir: dir,
    processes: f.processes,
  }).setCustomRscript(custom);
  fs.unlinkSync(custom);
  const next = new RRuntimeManager({
    userDataDir: dir,
    systemRscript: () => '/fake/system',
    processes: f.processes,
  });
  expect((await next.status()).found).toBe(false);
  expect(f.startScript).not.toHaveBeenCalled();
});
it('rejects old, malformed, failed and non-exact runtime probe output', async () => {
  for (const result of [
    { code: 0, stdout: 'SLR_RUNTIME:4.1.0:x86_64\n', stderr: '' },
    { code: 1, stdout: 'SLR_RUNTIME:4.4.2:x86_64\n', stderr: '' },
    { code: 0, stdout: 'prefix SLR_RUNTIME:4.4.2:x86_64\n', stderr: '' },
  ]) {
    const f = processFixture(result);
    const mgr = new RRuntimeManager({
      userDataDir: dir,
      systemRscript: () => '/fake/system',
      processes: f.processes,
    });
    expect((await mgr.status()).found).toBe(false);
  }
});
it('deduplicates verification and refuses a cancelled caller', async () => {
  const f = processFixture();
  const mgr = new RRuntimeManager({
    userDataDir: dir,
    systemRscript: () => '/fake/system',
    processes: f.processes,
  });
  await Promise.all([mgr.ready(), mgr.ready()]);
  expect(f.startScript).toHaveBeenCalledOnce();
  const c = new AbortController();
  c.abort();
  await expect(mgr.ready(c.signal)).rejects.toThrow(/cancelled/);
});
it('does not return a stale verified runtime after selection changes during probing', async () => {
  let finish!: (result: ProcessResult) => void;
  const f = processFixture();
  f.startScript.mockReturnValueOnce({
    done: new Promise((resolve) => {
      finish = resolve;
    }),
  });
  const first = executable('first-Rscript');
  const second = executable('second-Rscript');
  const mgr = new RRuntimeManager({ userDataDir: dir, processes: f.processes });
  mgr.setCustomRscript(first);
  const pending = mgr.ready();
  mgr.setCustomRscript(second);
  finish({ code: 0, stdout: 'SLR_RUNTIME:4.4.2:x86_64\n', stderr: '' });
  await expect(pending).rejects.toThrow(/changed|cancel|selection/i);
  expect((await mgr.ready())?.rPath).toBe(second);
});
it('child environment removes inherited GitHub credentials unless explicitly provided', async () => {
  vi.stubEnv('GITHUB_PAT', 'fake-parent-pat');
  vi.stubEnv('GH_TOKEN', 'fake-parent-token');
  const f = processFixture();
  const mgr = new RRuntimeManager({
    userDataDir: dir,
    systemRscript: () => '/fake/system',
    processes: f.processes,
  });
  await mgr.ready();
  expect(mgr.childEnv().GITHUB_PAT).toBeUndefined();
  expect(mgr.childEnv().GH_TOKEN).toBeUndefined();
  expect(mgr.childEnv({ GITHUB_PAT: 'fake-requested' }).GITHUB_PAT).toBe(
    'fake-requested',
  );
  expect(mgr.childEnv().R_LIBS_USER).toBe(mgr.libraryPath);
});
it('finds Homebrew and rig locations without a shell PATH', () => {
  expect(
    findSystemRscript(
      'darwin',
      { PATH: '' },
      fakeFs(['/opt/homebrew/bin/Rscript']),
    ),
  ).toBe('/opt/homebrew/bin/Rscript');
  const rig = path.join(dir, '.local/share/rig/bin/Rscript');
  expect(
    findSystemRscript('darwin', { PATH: '', HOME: dir }, fakeFs([rig])),
  ).toBe(rig);
});
it('discovers versioned Windows installations using a temporary ProgramFiles fixture', () => {
  const exe = path.join(dir, 'R', 'R-4.4.2', 'bin', 'Rscript.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, 'fake');
  expect(
    findSystemRscript(
      'win32',
      { PATH: '', ProgramFiles: dir, LOCALAPPDATA: dir },
      fakeFs([exe]),
    ),
  ).toBe(exe);
});
it('queries version through the managed process API', async () => {
  const f = processFixture();
  const mgr = new RRuntimeManager({ userDataDir: dir, processes: f.processes });
  expect(await mgr.queryVersion('/fake/Rscript')).toBe('4.4.2');
  expect(f.start).toHaveBeenCalledWith(
    '/fake/Rscript',
    ['--version'],
    expect.objectContaining({ timeoutMs: process.platform === 'win32' ? 30000 : 10000 }),
  );
});
