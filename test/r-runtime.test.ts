import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  compareVersions,
  findSystemRscript,
  managedRscriptCandidates,
  meetsMinimum,
  parseRVersion,
  platformKey,
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
    expect(parseRVersion('R version 4.4.2 (2024-10-31) -- "Pile of Leaves"')).toBe('4.4.2');
  });
  it('parses `Rscript --version` output', () => {
    expect(parseRVersion('R scripting front-end version 4.3.1 (2023-06-16)')).toBe('4.3.1');
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
    expect(win.some((p) => p.endsWith(path.join('bin', 'x64', 'Rscript.exe')))).toBe(true);
    const mac = managedRscriptCandidates('/rt', 'darwin');
    expect(mac[0]).toContain(path.join('R.framework', 'Resources', 'bin', 'Rscript'));
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
    const env = { PATH: ['/nope', '/usr/local/bin'].join(path.delimiter) };
    expect(findSystemRscript('linux', env, fakeFs([exe]))).toBe(exe);
  });
  it('returns undefined when absent', () => {
    expect(findSystemRscript('linux', { PATH: '/nope' }, fakeFs([]))).toBeUndefined();
  });
});

describe('platformKey', () => {
  it('joins platform and arch', () => {
    expect(platformKey('win32', 'x64')).toBe('win32-x64');
  });
});

describe('RRuntimeManager', () => {
  it('resolves managed > custom > system in priority order', () => {
    const userData = '/data';
    const managed = path.join(userData, 'r-runtime', 'bin', 'Rscript');
    const mgr = new RRuntimeManager({
      userDataDir: userData,
      platform: 'linux',
      arch: 'x64',
      fsLike: fakeFs([managed]),
      systemRscript: () => '/usr/bin/Rscript',
    });
    expect(mgr.resolveRscript()).toEqual({ rPath: managed, source: 'managed' });
  });

  it('falls back to system R when no managed runtime exists', () => {
    const mgr = new RRuntimeManager({
      userDataDir: '/data',
      platform: 'linux',
      arch: 'x64',
      fsLike: fakeFs([]),
      systemRscript: () => '/usr/bin/Rscript',
    });
    expect(mgr.resolveRscript()).toEqual({ rPath: '/usr/bin/Rscript', source: 'system' });
  });

  it('reports not-found status when R is entirely absent', async () => {
    const mgr = new RRuntimeManager({
      userDataDir: '/data',
      platform: 'linux',
      arch: 'x64',
      fsLike: fakeFs([]),
      systemRscript: () => undefined,
    });
    const status = await mgr.status();
    expect(status.found).toBe(false);
    expect(status.libraryPath).toContain('library');
  });

  it('parses version via an injected spawner', async () => {
    const mgr = new RRuntimeManager({
      userDataDir: '/data',
      platform: 'linux',
      arch: 'x64',
      fsLike: fakeFs(['/usr/bin/Rscript']),
      systemRscript: () => '/usr/bin/Rscript',
      // minimal fake child process emitting a version banner on stdout
      spawner: (() => {
        const handlers: Record<string, (arg?: unknown) => void> = {};
        const stdout = { on: (ev: string, cb: (b: Buffer) => void) => (handlers[`out:${ev}`] = cb as never) };
        const child = {
          stdout,
          stderr: { on: () => {} },
          on: (ev: string, cb: (arg?: unknown) => void) => {
            handlers[ev] = cb;
            if (ev === 'close') {
              setTimeout(() => {
                handlers['out:data']?.(Buffer.from('R scripting front-end version 4.4.2 (2024-10-31)'));
                cb(0);
              }, 0);
            }
            return child;
          },
        };
        return child as never;
      }) as never,
    });
    const status = await mgr.status();
    expect(status.found).toBe(true);
    expect(status.version).toBe('4.4.2');
    expect(status.source).toBe('system');
  });
});
