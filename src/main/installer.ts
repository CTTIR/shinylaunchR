/**
 * Installs an app's R package into the managed library, from CRAN or GitHub.
 * Runs a supervised child Rscript process and streams stdout/stderr to the
 * logger (which forwards to the UI Log Console, with secret redaction). Never
 * blocks the main thread.
 *
 * Security: pkg/repo are validated against strict regexes upstream and are only
 * ever interpolated into a fully-qualified R expression, then spawned via an
 * argument array — never a shell command line.
 */
import { spawn, type SpawnOptions } from 'node:child_process';
import {
  isValidName,
  isValidRepo,
  type AppEntry,
  type AppSettings,
  type InstallResult,
} from '@shared/types';
import { logger } from './logger';
import type { RRuntimeManager } from './r-runtime';

/** R-safe forward-slash path (R accepts these on Windows too). */
function rPath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Validate a CRAN mirror before it is interpolated into R source. Rejects
 * anything that isn't a plain http(s) URL or that contains characters which
 * would break out of the R string literal — closing R-script injection via a
 * tampered settings value.
 */
export function safeRepos(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`invalid CRAN mirror: ${url}`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error(`CRAN mirror must be http(s): ${url}`);
  }
  if (/["\\\n\r]/.test(u.href)) throw new Error('CRAN mirror contains illegal characters');
  return u.href;
}

/** Build the R expression to install a CRAN package. */
export function buildCranScript(pkg: string, lib: string, repos: string): string {
  if (!isValidName(pkg)) throw new Error(`invalid package: ${pkg}`);
  return [
    `lib <- "${rPath(lib)}"`,
    `dir.create(lib, showWarnings = FALSE, recursive = TRUE)`,
    `.libPaths(c(lib, .libPaths()))`,
    `utils::install.packages("${pkg}", lib = lib, repos = "${repos}")`,
    `if (!requireNamespace("${pkg}", quietly = TRUE)) stop("install failed: ${pkg}")`,
    `cat("INSTALL_OK\\n")`,
  ].join('; ');
}

/** Build the R expression to install a GitHub package (pak preferred). */
export function buildGithubScript(
  repo: string,
  lib: string,
  repos: string,
  preferPak: boolean,
): string {
  if (!isValidRepo(repo)) throw new Error(`invalid repo: ${repo}`);
  const installer = preferPak
    ? [
        `if (!requireNamespace("pak", quietly = TRUE)) utils::install.packages("pak", lib = lib, repos = "${repos}")`,
        `pak::pak("${repo}")`,
      ]
    : [
        `if (!requireNamespace("remotes", quietly = TRUE)) utils::install.packages("remotes", lib = lib, repos = "${repos}")`,
        `remotes::install_github("${repo}", lib = lib)`,
      ];
  return [
    `lib <- "${rPath(lib)}"`,
    `dir.create(lib, showWarnings = FALSE, recursive = TRUE)`,
    `.libPaths(c(lib, .libPaths()))`,
    ...installer,
    `cat("INSTALL_OK\\n")`,
  ].join('; ');
}

export interface InstallDeps {
  runtime: RRuntimeManager;
  settings: AppSettings;
  /** GitHub PAT passed only via process env to the child; never logged. */
  token?: string | null;
  spawner?: (cmd: string, args: string[], options: SpawnOptions) => ReturnType<typeof spawn>;
}

/** Install (or reinstall) the package for `entry`. Resolves with the result. */
export function installPackage(entry: AppEntry, deps: InstallDeps): Promise<InstallResult> {
  const { runtime, settings } = deps;
  const resolved = runtime.resolveRscript();
  if (!resolved) {
    const message = 'R is not available — cannot install. Set up R in the R Runtime panel.';
    logger.error('installer', message, entry.id);
    return Promise.resolve({ ok: false, id: entry.id, message });
  }

  const lib = runtime.ensureLibrary();
  let script: string;
  try {
    const repos = safeRepos(settings.cranMirror);
    script =
      entry.source.kind === 'cran'
        ? buildCranScript(entry.pkg, lib, repos)
        : buildGithubScript(entry.source.repo, lib, repos, settings.preferPak);
  } catch (err) {
    const message = `Could not build install script: ${String(err)}`;
    logger.error('installer', message, entry.id);
    return Promise.resolve({ ok: false, id: entry.id, message });
  }

  const env = runtime.childEnv(deps.token ? { GITHUB_PAT: deps.token } : {});
  const spawner = deps.spawner ?? spawn;

  logger.info('installer', `Installing ${entry.pkg} (${entry.source.kind})…`, entry.id);

  return new Promise<InstallResult>((resolve) => {
    let sawOk = false;
    let settled = false;
    const finish = (result: InstallResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const child = spawner(resolved.rPath, ['--vanilla', '-e', script], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const onData = (level: 'info' | 'error') => (buf: Buffer) => {
        const text = buf.toString();
        if (text.includes('INSTALL_OK')) sawOk = true;
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) logger.log(level, 'installer', line, entry.id);
        }
      };
      child.stdout?.on('data', onData('info'));
      child.stderr?.on('data', onData('error'));
      child.on('error', (err) => {
        logger.error('installer', `Spawn failed: ${String(err)}`, entry.id);
        finish({ ok: false, id: entry.id, message: String(err) });
      });
      child.on('close', (code) => {
        const ok = code === 0 && sawOk;
        logger.log(
          ok ? 'info' : 'error',
          'installer',
          ok ? `Installed ${entry.pkg}.` : `Install of ${entry.pkg} failed (exit ${code}).`,
          entry.id,
        );
        finish({
          ok,
          id: entry.id,
          message: ok ? undefined : `Install failed (exit code ${code}).`,
        });
      });
    } catch (err) {
      logger.error('installer', `Spawn threw: ${String(err)}`, entry.id);
      finish({ ok: false, id: entry.id, message: String(err) });
    }
  });
}
