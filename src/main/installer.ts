/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

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
  isValidPkg,
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

/**
 * Library-setup lines prepended to every install script: create and prepend the
 * managed lib, and point `repos` at the validated CRAN mirror (so pak, which
 * does not take a `repos` argument, resolves CRAN deps from the same mirror).
 */
function libSetup(lib: string, repos: string): string[] {
  return [
    `lib <- "${rPath(lib)}"`,
    `dir.create(lib, showWarnings = FALSE, recursive = TRUE)`,
    `.libPaths(c(lib, .libPaths()))`,
    `options(repos = c(CRAN = "${repos}"))`,
  ];
}

/** Ensure a bootstrap helper (pak/remotes) is present in the managed lib. */
function ensureHelper(helper: 'pak' | 'remotes', repos: string): string {
  return (
    `if (!requireNamespace("${helper}", quietly = TRUE)) { ` +
    `cat("Bootstrapping ${helper} into the managed library...\\n"); ` +
    `utils::install.packages("${helper}", lib = lib, repos = "${repos}") }`
  );
}

/**
 * Final lines: confirm the freshly-installed target package actually loads
 * (its namespace + hard deps resolve) before emitting the INSTALL_OK sentinel.
 * A missing dependency makes this `stop()`, so the install is reported as failed
 * rather than a false "ready" that later halts at launch.
 */
function loadGate(pkg: string): string[] {
  return [
    `if (!requireNamespace("${pkg}", quietly = TRUE)) ` +
      `stop("installed but package '${pkg}' will not load - a dependency may be missing")`,
    `cat("INSTALL_OK\\n")`,
  ];
}

/**
 * Build the R expression to install a CRAN package together with its full
 * dependency tree. `dependencies = TRUE` (Depends/Imports/LinkingTo/Suggests)
 * so runtime-only deps such as `shiny.i18n` are pulled; pak (preferred) resolves
 * the same graph and installs binaries where possible.
 */
export function buildCranScript(
  pkg: string,
  lib: string,
  repos: string,
  preferPak = false,
): string {
  if (!isValidPkg(pkg)) throw new Error(`invalid package: ${pkg}`);
  const installer = preferPak
    ? [
        ensureHelper('pak', repos),
        `cat("Installing ${pkg} and its full dependency tree via pak...\\n")`,
        `pak::pkg_install("${pkg}", lib = lib, dependencies = TRUE, upgrade = FALSE, ask = FALSE)`,
      ]
    : [
        `cat("Installing ${pkg} and its full dependency tree via install.packages...\\n")`,
        `utils::install.packages("${pkg}", lib = lib, repos = "${repos}", dependencies = TRUE)`,
      ];
  return [...libSetup(lib, repos), ...installer, ...loadGate(pkg)].join('; ');
}

/**
 * Build the R expression to install a GitHub package and its full dependency
 * tree. pak (preferred) resolves CRAN/Bioc/GitHub deps from the graph; the
 * remotes fallback uses `dependencies = TRUE` (covers Suggests) and
 * `upgrade = "never"` so other managed packages are not churned on every install.
 * `pkg` is the validated package name used for the post-install load gate.
 */
export function buildGithubScript(
  repo: string,
  pkg: string,
  lib: string,
  repos: string,
  preferPak: boolean,
): string {
  if (!isValidRepo(repo)) throw new Error(`invalid repo: ${repo}`);
  if (!isValidPkg(pkg)) throw new Error(`invalid package: ${pkg}`);
  const installer = preferPak
    ? [
        ensureHelper('pak', repos),
        `cat("Installing ${repo} and its full dependency tree via pak...\\n")`,
        `pak::pkg_install("${repo}", lib = lib, dependencies = TRUE, upgrade = FALSE, ask = FALSE)`,
      ]
    : [
        ensureHelper('remotes', repos),
        `cat("Installing ${repo} and its full dependency tree via remotes...\\n")`,
        `remotes::install_github("${repo}", lib = lib, dependencies = TRUE, upgrade = "never")`,
      ];
  return [...libSetup(lib, repos), ...installer, ...loadGate(pkg)].join('; ');
}

/**
 * Build the R expression that installs the dependencies a SHINY FILE / `source`
 * app needs. `pkgs` is the (validated) set scanned from the app's files; `shiny`
 * is always ensured. Only packages not already present in the managed library
 * are installed (so re-staging is cheap), then `shiny` is load-gated before the
 * INSTALL_OK sentinel. There is no package to `library()` here — the app is run
 * later with `shiny::runApp(dir)`.
 */
export function buildSourceInstallScript(
  pkgs: string[],
  lib: string,
  repos: string,
  preferPak: boolean,
): string {
  const valid = [...new Set(pkgs.filter(isValidPkg))];
  const list = valid.includes('shiny') ? valid : ['shiny', ...valid];
  const vec = list.map((p) => `"${p}"`).join(', ');
  const installMissing = preferPak
    ? `pak::pkg_install(missing, lib = lib, dependencies = TRUE, upgrade = FALSE, ask = FALSE)`
    : `utils::install.packages(missing, lib = lib, repos = "${repos}", dependencies = TRUE)`;
  return [
    ...libSetup(lib, repos),
    ...(preferPak ? [ensureHelper('pak', repos)] : []),
    `pkgs <- c(${vec})`,
    `missing <- pkgs[!vapply(pkgs, function(p) requireNamespace(p, quietly = TRUE), logical(1))]`,
    `if (length(missing) > 0) { ` +
      `cat("Installing app dependencies:", paste(missing, collapse = ", "), "\\n"); ` +
      `${installMissing} }`,
    `if (!requireNamespace("shiny", quietly = TRUE)) ` +
      `stop("shiny is required but could not be installed")`,
    `cat("INSTALL_OK\\n")`,
  ].join('; ');
}

/** Build a quick R expression that reports whether `pkg` loads in the managed lib. */
export function buildLoadCheckScript(pkg: string): string {
  if (!isValidPkg(pkg)) throw new Error(`invalid package: ${pkg}`);
  return `if (requireNamespace("${pkg}", quietly = TRUE)) cat("LOAD_OK\\n") else cat("LOAD_FAIL\\n")`;
}

export interface InstallDeps {
  runtime: RRuntimeManager;
  settings: AppSettings;
  /** GitHub PAT passed only via process env to the child; never logged. */
  token?: string | null;
  spawner?: (cmd: string, args: string[], options: SpawnOptions) => ReturnType<typeof spawn>;
}

/**
 * Spawn a supervised Rscript that runs `script`, stream its output to the logger
 * with secret redaction, and resolve once it exits. Success requires a clean
 * exit *and* the INSTALL_OK sentinel. Shared by package and source installs.
 */
export function runInstallScript(
  entry: AppEntry,
  script: string,
  deps: InstallDeps,
  label: string,
): Promise<InstallResult> {
  const resolved = deps.runtime.resolveRscript();
  if (!resolved) {
    const message = 'R is not available — cannot install. Set up R in the R Runtime panel.';
    logger.error('installer', message, entry.id);
    return Promise.resolve({ ok: false, id: entry.id, message });
  }
  const env = deps.runtime.childEnv(deps.token ? { GITHUB_PAT: deps.token } : {});
  const spawner = deps.spawner ?? spawn;

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
        windowsHide: true,
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
          ok ? `Installed ${label}.` : `Install of ${label} failed (exit ${code}).`,
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

/** Install (or reinstall) the package for a PACKAGE-family `entry`. */
export function installPackage(entry: AppEntry, deps: InstallDeps): Promise<InstallResult> {
  const { settings } = deps;
  const lib = deps.runtime.ensureLibrary();
  let script: string;
  try {
    const repos = safeRepos(settings.cranMirror);
    if (entry.source.kind === 'cran') {
      script = buildCranScript(entry.pkg!, lib, repos, settings.preferPak);
    } else if (entry.source.kind === 'github') {
      script = buildGithubScript(entry.source.repo, entry.pkg!, lib, repos, settings.preferPak);
    } else {
      throw new Error('installPackage called for a non-package source');
    }
  } catch (err) {
    const message = `Could not build install script: ${String(err)}`;
    logger.error('installer', message, entry.id);
    return Promise.resolve({ ok: false, id: entry.id, message });
  }
  logger.info('installer', `Installing ${entry.pkg} (${entry.source.kind})…`, entry.id);
  return runInstallScript(entry, script, deps, entry.pkg!);
}

/** Install the scanned dependency set for a SHINY FILE / `source` app. */
export function installSourceDeps(
  entry: AppEntry,
  pkgs: string[],
  deps: InstallDeps,
): Promise<InstallResult> {
  const { settings } = deps;
  const lib = deps.runtime.ensureLibrary();
  let script: string;
  try {
    const repos = safeRepos(settings.cranMirror);
    script = buildSourceInstallScript(pkgs, lib, repos, settings.preferPak);
  } catch (err) {
    const message = `Could not build install script: ${String(err)}`;
    logger.error('installer', message, entry.id);
    return Promise.resolve({ ok: false, id: entry.id, message });
  }
  logger.info('installer', `Resolving dependencies for "${entry.name}"…`, entry.id);
  return runInstallScript(entry, script, deps, entry.name);
}

export interface LoadCheckDeps {
  runtime: RRuntimeManager;
  spawner?: (cmd: string, args: string[], options: SpawnOptions) => ReturnType<typeof spawn>;
}

/**
 * Quick pre-launch probe: does `pkg` load from the managed library? Returns
 * false if R is unavailable, the namespace can't load (e.g. a missing
 * dependency), or the probe errors — so the caller can surface a clear
 * "dependency may be missing, try Reinstall" message instead of launching into
 * a raw `loadNamespace` halt. Never throws.
 */
export function verifyPackageLoads(pkg: string, deps: LoadCheckDeps): Promise<boolean> {
  const resolved = deps.runtime.resolveRscript();
  if (!resolved) return Promise.resolve(false);
  let script: string;
  try {
    script = buildLoadCheckScript(pkg);
  } catch {
    return Promise.resolve(false);
  }
  const spawner = deps.spawner ?? spawn;
  const env = deps.runtime.childEnv();
  return new Promise<boolean>((resolve) => {
    let ok = false;
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    try {
      const child = spawner(resolved.rPath, ['--vanilla', '-e', script], {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.stdout?.on('data', (buf: Buffer) => {
        if (buf.toString().includes('LOAD_OK')) ok = true;
      });
      child.on('error', () => finish(false));
      child.on('close', () => finish(ok));
    } catch {
      finish(false);
    }
  });
}
