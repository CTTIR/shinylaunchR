import { describe, expect, it, vi } from 'vitest';
import {
  installPackage,
  installSourceDeps,
  safeRepos,
} from '../src/main/installer';
import { INSTALL_SCRIPT } from '../src/main/r-scripts';
import { DEFAULT_SETTINGS, type AppEntry } from '@shared/types';
import type { RRuntimeManager } from '../src/main/r-runtime';
import type { ProcessResult, RunOptions } from '../src/main/process-manager';
const entry: AppEntry = {
  id: '12345678-1234-1234-1234-123456789abc',
  name: 'Demo',
  pkg: 'testpkg',
  fun: 'run',
  source: { kind: 'cran' },
  installed: false,
  createdAt: '',
};
function fixture(
  result: ProcessResult = { code: 0, stdout: 'INSTALL_OK\n', stderr: '' },
) {
  const startScript = vi.fn(
    (_cmd: string, _script: string, _opts: RunOptions) => ({
      done: Promise.resolve(result),
    }),
  );
  const ready = vi.fn(async (_signal?: AbortSignal) => ({
    rPath: '/fake/Rscript',
    source: 'system',
    version: '4.4.2',
    arch: 'x86_64',
  }));
  const runtime = {
    ready,
    processes: { startScript },
    ensureLibrary: () => '/fake/library with spaces',
    childEnv: (extra: NodeJS.ProcessEnv) => ({
      R_LIBS_USER: '/fake/library with spaces',
      ...extra,
    }),
  } as unknown as RRuntimeManager;
  return { runtime, ready, startScript };
}
describe('mirror trust boundary', () => {
  it('accepts clean HTTPS and rejects HTTP, credentials, control characters and injection', () => {
    expect(safeRepos('https://cloud.r-project.org')).toBe(
      'https://cloud.r-project.org/',
    );
    for (const url of [
      'http://cran.example.org',
      'file:///tmp/x',
      'https://user:password@example.org',
      'https://x\n',
      'https://x");system("x")',
    ])
      expect(() => safeRepos(url)).toThrow();
  });
});
it('passes package/repo/library/token as environment data to a constant program', async () => {
  const f = fixture();
  const token = 'fake-installer-token';
  const result = await installPackage(
    { ...entry, source: { kind: 'github', repo: 'owner/repo@topic' } },
    { runtime: f.runtime, settings: DEFAULT_SETTINGS, token },
  );
  expect(result.ok).toBe(true);
  const [command, script, options] = f.startScript.mock.calls[0]!;
  expect(command).toBe('/fake/Rscript');
  expect(script).toBe(INSTALL_SCRIPT);
  expect(script).not.toContain(token);
  expect(script).not.toContain('owner/repo@topic');
  expect(options.env).toMatchObject({
    GITHUB_PAT: token,
    SLR_PACKAGE: 'testpkg',
    SLR_REPO: 'owner/repo@topic',
    SLR_LIBRARY: '/fake/library with spaces',
  });
  expect(options.owner).toBe(entry.id);
  expect(options.timeoutMs).toBeGreaterThan(0);
});
it('includes shiny once and installs only the supplied declared dependency set', async () => {
  const f = fixture();
  const source = {
    ...entry,
    pkg: undefined,
    source: {
      kind: 'source' as const,
      origin: { from: 'local' as const, path: '/fake/source' },
    },
  };
  expect(
    (
      await installSourceDeps(source, ['DT', 'shiny', 'DT'], {
        runtime: f.runtime,
        settings: DEFAULT_SETTINGS,
      })
    ).ok,
  ).toBe(true);
  expect(f.startScript.mock.calls[0]![2].env?.SLR_PACKAGES).toBe('shiny,DT');
});
it('requires an exact success record and a successful process exit', async () => {
  for (const result of [
    { code: 0, stdout: 'prefix INSTALL_OK\n', stderr: '' },
    { code: 1, stdout: 'INSTALL_OK\n', stderr: 'failed load' },
    { code: 0, stdout: 'INSTALL_OK\n', stderr: '', error: 'cancelled' },
  ]) {
    const f = fixture(result);
    expect(
      (
        await installPackage(entry, {
          runtime: f.runtime,
          settings: DEFAULT_SETTINGS,
        })
      ).ok,
    ).toBe(false);
  }
});
it('gates final success on every target loading from the managed library', () => {
  expect(INSTALL_SCRIPT).toContain(
    'requireNamespace(p,lib.loc=lib,quietly=TRUE)',
  );
  expect(INSTALL_SCRIPT).toContain(
    'normalizePath(dirname(location)) != normalizePath(lib)',
  );
  expect(INSTALL_SCRIPT.indexOf('for (p in targets)')).toBeLessThan(
    INSTALL_SCRIPT.indexOf('cat("INSTALL_OK'),
  );
});
it('rejects invalid package/dependency input without starting a process', async () => {
  const f = fixture();
  expect(
    (
      await installPackage(
        { ...entry, pkg: 'bad;name' },
        { runtime: f.runtime, settings: DEFAULT_SETTINGS },
      )
    ).ok,
  ).toBe(false);
  expect(
    (
      await installSourceDeps(
        {
          ...entry,
          source: { kind: 'source', origin: { from: 'local', path: '/fake' } },
        },
        ['../bad'],
        { runtime: f.runtime, settings: DEFAULT_SETTINGS },
      )
    ).ok,
  ).toBe(false);
  expect(f.startScript).not.toHaveBeenCalled();
});
it('forwards cancellation to runtime and managed install process', async () => {
  const f = fixture({
    code: null,
    stdout: '',
    stderr: '',
    error: 'Operation cancelled.',
  });
  const controller = new AbortController();
  const result = await installPackage(entry, {
    runtime: f.runtime,
    settings: DEFAULT_SETTINGS,
    signal: controller.signal,
  });
  expect(f.ready).toHaveBeenCalledWith(controller.signal);
  expect(f.startScript.mock.calls[0]![2].signal).toBe(controller.signal);
  expect(result.ok).toBe(false);
  expect(result.message).toContain('cancelled');
});
it('reports absent R as a recoverable error', async () => {
  const f = fixture();
  f.ready.mockResolvedValueOnce(undefined as never);
  const result = await installPackage(entry, {
    runtime: f.runtime,
    settings: DEFAULT_SETTINGS,
  });
  expect(result.ok).toBe(false);
  expect(result.message).toMatch(/R is not available/);
  expect(f.startScript).not.toHaveBeenCalled();
});
