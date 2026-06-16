/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * R Runtime Manager: locate / version-check / (best-effort) bootstrap a managed
 * R installation. The pure helpers (version parsing, path resolution) are
 * exported separately so they can be unit-tested against a mocked filesystem,
 * with no real R required.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, type SpawnOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { RStatus, RSourcesConfig } from '@shared/types';
import { logger } from './logger';
import sourcesJson from './r-sources.json';

export const R_SOURCES = sourcesJson as unknown as RSourcesConfig;

export interface FsLike {
  existsSync(p: string): boolean;
}

/** Parse a version like "4.4.2" out of `R --version` / `Rscript --version`. */
export function parseRVersion(text: string): string | undefined {
  if (!text) return undefined;
  const labelled = text.match(/version\s+(\d+\.\d+(?:\.\d+)?)/i);
  if (labelled) return labelled[1];
  const any = text.match(/\b(\d+\.\d+\.\d+)\b/);
  return any ? any[1] : undefined;
}

/** Compare semver-ish strings. Returns -1/0/1 (a<b / a==b / a>b). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da < db ? -1 : 1;
  }
  return 0;
}

export function meetsMinimum(version: string, minimum = '4.2.0'): boolean {
  return compareVersions(version, minimum) >= 0;
}

/** Candidate Rscript locations inside a managed runtime dir, per platform. */
export function managedRscriptCandidates(runtimeDir: string, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') {
    return [
      path.join(runtimeDir, 'bin', 'x64', 'Rscript.exe'),
      path.join(runtimeDir, 'bin', 'Rscript.exe'),
    ];
  }
  if (platform === 'darwin') {
    return [
      path.join(runtimeDir, 'R.framework', 'Resources', 'bin', 'Rscript'),
      path.join(runtimeDir, 'bin', 'Rscript'),
    ];
  }
  return [path.join(runtimeDir, 'bin', 'Rscript')];
}

/** First existing managed Rscript path, or undefined. */
export function resolveManagedRscript(
  runtimeDir: string,
  platform: NodeJS.Platform,
  fsLike: FsLike = fs,
): string | undefined {
  return managedRscriptCandidates(runtimeDir, platform).find((p) => fsLike.existsSync(p));
}

export function platformKey(platform: NodeJS.Platform, arch: string): string {
  return `${platform}-${arch}`;
}

/** Reject any managed-R download source that is not plain https. */
export function assertHttpsSource(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`invalid R source URL: ${url}`);
  }
  if (u.protocol !== 'https:') throw new Error(`R source must be https: ${url}`);
  return u.href;
}

/** Verify a downloaded payload against an expected SHA-256 (hex). */
export function verifySha256(data: Buffer, expectedHex: string): boolean {
  if (!expectedHex) return false;
  const actual = createHash('sha256').update(data).digest('hex');
  return actual.toLowerCase() === expectedHex.toLowerCase();
}

export type Spawner = (
  cmd: string,
  args: string[],
  options: SpawnOptions,
) => ReturnType<typeof spawn>;

export interface RuntimeDeps {
  userDataDir: string;
  platform?: NodeJS.Platform;
  arch?: string;
  fsLike?: FsLike;
  spawner?: Spawner;
  /** Override Rscript discovery on PATH (returns absolute path or undefined). */
  systemRscript?: () => string | undefined;
}

/** Locate `Rscript` on PATH by scanning PATH dirs for the executable. */
export function findSystemRscript(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  fsLike: FsLike = fs,
): string | undefined {
  const exe = platform === 'win32' ? 'Rscript.exe' : 'Rscript';
  const dirs = (env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, exe);
    if (fsLike.existsSync(candidate)) return candidate;
  }
  // Common fixed locations
  const fixed =
    platform === 'darwin'
      ? ['/Library/Frameworks/R.framework/Resources/bin/Rscript', '/usr/local/bin/Rscript']
      : platform === 'win32'
        ? []
        : ['/usr/bin/Rscript', '/usr/local/bin/Rscript'];
  return fixed.find((p) => fsLike.existsSync(p));
}

export class RRuntimeManager {
  private readonly platform: NodeJS.Platform;
  private readonly arch: string;
  private readonly fsLike: FsLike;
  private readonly spawner: Spawner;
  private readonly systemRscript: () => string | undefined;
  private customRscript: string | undefined;

  constructor(private readonly deps: RuntimeDeps) {
    this.platform = deps.platform ?? process.platform;
    this.arch = deps.arch ?? process.arch;
    this.fsLike = deps.fsLike ?? fs;
    this.spawner = deps.spawner ?? spawn;
    this.systemRscript =
      deps.systemRscript ?? (() => findSystemRscript(this.platform, process.env, this.fsLike));
  }

  get runtimeDir(): string {
    return path.join(this.deps.userDataDir, 'r-runtime');
  }

  get libraryPath(): string {
    return path.join(this.runtimeDir, 'library');
  }

  /** Point the manager at a user-chosen Rscript (the "use existing R" flow). */
  setCustomRscript(rscriptPath: string | undefined): void {
    this.customRscript = rscriptPath;
  }

  /** Resolve the Rscript to use, in priority order: managed > custom > system. */
  resolveRscript(): { rPath: string; source: 'managed' | 'system' | 'custom' } | undefined {
    const managed = resolveManagedRscript(this.runtimeDir, this.platform, this.fsLike);
    if (managed) return { rPath: managed, source: 'managed' };
    if (this.customRscript && this.fsLike.existsSync(this.customRscript)) {
      return { rPath: this.customRscript, source: 'custom' };
    }
    const sys = this.systemRscript();
    if (sys) return { rPath: sys, source: 'system' };
    return undefined;
  }

  /** Run `Rscript --version` and parse the version. */
  async queryVersion(rscriptPath: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      let out = '';
      try {
        const child = this.spawner(rscriptPath, ['--version'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        });
        child.stdout?.on('data', (d) => (out += d.toString()));
        child.stderr?.on('data', (d) => (out += d.toString()));
        child.on('error', () => resolve(undefined));
        child.on('close', () => resolve(parseRVersion(out)));
      } catch {
        resolve(undefined);
      }
    });
  }

  /** Build the full status object the UI displays. */
  async status(): Promise<RStatus> {
    const resolved = this.resolveRscript();
    if (!resolved) {
      return {
        found: false,
        managed: false,
        libraryPath: this.libraryPath,
        message: 'R not found. Bootstrap a managed R or install R ≥ 4.2.',
      };
    }
    const version = await this.queryVersion(resolved.rPath);
    const ok = version ? meetsMinimum(version) : false;
    return {
      found: true,
      managed: resolved.source === 'managed',
      rPath: resolved.rPath,
      version,
      libraryPath: this.libraryPath,
      source: resolved.source,
      message: version
        ? ok
          ? undefined
          : `Detected R ${version}; shinylaunchR targets R ≥ 4.2.`
        : 'Found Rscript but could not determine its version.',
    };
  }

  /** Ensure the managed library directory exists; returns its path. */
  ensureLibrary(): string {
    fs.mkdirSync(this.libraryPath, { recursive: true });
    return this.libraryPath;
  }

  /**
   * Best-effort managed-R bootstrap. Network/extraction is intentionally not
   * implemented as a hard dependency: if a download source is missing we throw
   * a descriptive error so the UI can fall back to "install R yourself".
   */
  async bootstrap(): Promise<RStatus> {
    const key = platformKey(this.platform, this.arch);
    const perPlatform = R_SOURCES.platforms[key];
    const version = R_SOURCES.defaultVersion;
    const entry = perPlatform?.[version];
    this.ensureLibrary();
    if (!entry || !entry.url) {
      const msg =
        `No managed R download is configured for ${key} (R ${version}). ` +
        `Install R ≥ 4.2 and use "Point to existing R", or add a source to r-sources.json.`;
      logger.warn('r-runtime', msg);
      throw new Error(msg);
    }
    // Never fetch a managed-R binary over a non-https source, and require a
    // checksum to be present before any (future) download/extract is attempted.
    assertHttpsSource(entry.url);
    if (!entry.sha256) {
      throw new Error(
        `R source for ${key} has no sha256 checksum; refusing to download an unverified binary.`,
      );
    }
    // A real implementation downloads `entry.url`, verifies `entry.sha256`,
    // and extracts into `this.runtimeDir`. That is deliberately left as a
    // runtime feature behind this clear boundary so the app builds and runs
    // without network access. See README "R runtime".
    logger.warn(
      'r-runtime',
      `Managed-R download from ${entry.url} is not performed in this build; ` +
        `falling back to system R detection.`,
    );
    throw new Error(
      'Automated managed-R download is not enabled in this build. ' +
        'Please install R ≥ 4.2 and use "Point to existing R".',
    );
  }

  /** Default child-process environment with the managed library on R_LIBS_USER. */
  childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    return {
      ...process.env,
      R_LIBS_USER: this.libraryPath,
      ...extra,
    };
  }

  homeTempHint(): string {
    return os.tmpdir();
  }
}
