import { describe, expect, it } from 'vitest';
import { buildCranScript, buildGithubScript, installPackage, safeRepos } from '../src/main/installer';
import { DEFAULT_SETTINGS, type AppEntry } from '@shared/types';
import type { RRuntimeManager } from '../src/main/r-runtime';

describe('safeRepos', () => {
  it('accepts clean http(s) mirrors', () => {
    expect(safeRepos('https://cloud.r-project.org')).toMatch(/^https:\/\/cloud\.r-project\.org/);
    expect(safeRepos('http://cran.example.org/')).toMatch(/^http:\/\//);
  });

  it('rejects non-URLs', () => {
    expect(() => safeRepos('not a url')).toThrow();
  });

  it('rejects non-http protocols', () => {
    expect(() => safeRepos('file:///etc/passwd')).toThrow();
    expect(() => safeRepos('javascript:alert(1)')).toThrow();
  });

  it('rejects injection attempts that would break the R string', () => {
    // a quote/paren payload must never survive into the R source
    expect(() => safeRepos('https://x"); system("rm -rf /"); ("')).toThrow();
  });
});

describe('install script builders', () => {
  it('rejects invalid package and repo names', () => {
    expect(() => buildCranScript('bad;name', '/lib', 'https://x')).toThrow();
    expect(() => buildGithubScript('not-a-repo', '/lib', 'https://x', true)).toThrow();
  });

  it('produces a fully-qualified, quoted install call', () => {
    const s = buildCranScript('molpathR', '/lib', 'https://cloud.r-project.org');
    expect(s).toContain('install.packages("molpathR"');
    expect(s).toContain('INSTALL_OK');
  });
});

describe('installPackage degradation (R absent)', () => {
  it('returns a recoverable error, never throws, when R is unavailable', async () => {
    const entry: AppEntry = {
      id: 'a1',
      name: 'Demo',
      pkg: 'molpathR',
      fun: 'mp_run_app',
      source: { kind: 'cran' },
      installed: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const runtime = {
      resolveRscript: () => undefined,
      ensureLibrary: () => '/lib',
      childEnv: () => ({}),
    } as unknown as RRuntimeManager;

    const result = await installPackage(entry, { runtime, settings: DEFAULT_SETTINGS });
    expect(result.ok).toBe(false);
    expect(result.id).toBe('a1');
    expect(result.message).toMatch(/R is not available/i);
  });
});
