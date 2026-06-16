import { describe, expect, it } from 'vitest';
import {
  buildCranScript,
  buildGithubScript,
  buildNamespacesLoadScript,
  buildSourceInstallScript,
  installPackage,
  safeRepos,
} from '../src/main/installer';
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
    expect(() => buildGithubScript('not-a-repo', 'pkg', '/lib', 'https://x', true)).toThrow();
    expect(() => buildGithubScript('org/repo', 'bad;name', '/lib', 'https://x', true)).toThrow();
  });

  it('CRAN fallback installs the full dependency tree and gates on load', () => {
    const s = buildCranScript('molpathR', '/lib', 'https://cloud.r-project.org');
    expect(s).toContain('install.packages("molpathR"');
    expect(s).toContain('dependencies = TRUE');
    expect(s).toContain('requireNamespace("molpathR"');
    expect(s).toContain('INSTALL_OK');
  });

  it('CRAN with pak preferred resolves the tree via pak', () => {
    const s = buildCranScript('molpathR', '/lib', 'https://cloud.r-project.org', true);
    expect(s).toContain('pak::pkg_install("molpathR"');
    expect(s).toContain('dependencies = TRUE');
  });

  it('GitHub via pak installs the tree into the managed lib', () => {
    const s = buildGithubScript('cttir/zhncommandR', 'zhncommandR', '/lib', 'https://x', true);
    expect(s).toContain('pak::pkg_install("cttir/zhncommandR"');
    expect(s).toContain('lib = lib');
    expect(s).toContain('dependencies = TRUE');
    expect(s).toContain('requireNamespace("zhncommandR"');
  });

  it('GitHub remotes fallback pulls Suggests and never upgrades', () => {
    const s = buildGithubScript('cttir/zhncommandR', 'zhncommandR', '/lib', 'https://x', false);
    expect(s).toContain('remotes::install_github("cttir/zhncommandR"');
    expect(s).toContain('dependencies = TRUE');
    expect(s).toContain('upgrade = "never"');
  });

  it('runs installs under a one-shot lock-cleanup retry (Windows move/AV resilience)', () => {
    // pak path: the actual install call still runs, now wrapped by the retry
    const pak = buildGithubScript('cttir/zhncommandR', 'zhncommandR', '/lib', 'https://x', true);
    expect(pak).toContain('.slr_install(function() pak::pkg_install("cttir/zhncommandR"');
    expect(pak).toContain('00LOCK');
    expect(pak).toContain('Sys.sleep');
    // CRAN install.packages and remotes fallbacks are wrapped too
    expect(buildCranScript('molpathR', '/lib', 'https://x')).toContain(
      '.slr_install(function() utils::install.packages("molpathR"',
    );
    expect(buildGithubScript('cttir/zhncommandR', 'zhncommandR', '/lib', 'https://x', false)).toContain(
      '.slr_install(function() remotes::install_github("cttir/zhncommandR"',
    );
  });
});

describe('buildSourceInstallScript', () => {
  it('always ensures shiny, installs missing only, and gates on shiny', () => {
    const s = buildSourceInstallScript(['dplyr'], '/lib', 'https://cloud.r-project.org', false);
    expect(s).toContain('"shiny"');
    expect(s).toContain('"dplyr"');
    expect(s).toContain('requireNamespace("shiny"');
    expect(s).toContain('INSTALL_OK');
  });

  it('is resilient: a batch failure falls back to per-package tryCatch', () => {
    const s = buildSourceInstallScript(['dplyr', 'ggplot2'], '/lib', 'https://x', true);
    expect(s).toContain('tryCatch');
    expect(s).toContain('for (p in missing)');
    // a false-positive name must not be able to abort the whole install
    expect(s).not.toMatch(/stop\(.*missing/);
  });

  it('drops invalid scanned names defensively', () => {
    const s = buildSourceInstallScript(['ok.pkg', 'bad;name', '../evil'], '/lib', 'https://x', false);
    expect(s).toContain('"ok.pkg"');
    expect(s).not.toContain('bad;name');
    expect(s).not.toContain('evil');
  });
});

describe('buildNamespacesLoadScript', () => {
  it('reports LOAD_OK / LOAD_MISSING over the validated set', () => {
    const s = buildNamespacesLoadScript(['shiny', 'dplyr', 'bad;name']);
    expect(s).toContain('"shiny"');
    expect(s).toContain('"dplyr"');
    expect(s).not.toContain('bad;name');
    expect(s).toContain('LOAD_OK');
    expect(s).toContain('LOAD_MISSING');
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
