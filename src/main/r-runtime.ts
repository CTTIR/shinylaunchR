/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * R Runtime Manager: locate and version-check a selected R installation. The pure helpers (version parsing, path resolution) are
 * exported separately so they can be unit-tested against a mocked filesystem,
 * with no real R required.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ProcessManager } from './process-manager';
import { RUNTIME_SCRIPT } from './r-scripts';
import { writeAtomicJson } from './atomic-store';
import { spawn, spawnSync, type SpawnOptions } from 'node:child_process';
import type { RStatus } from '@shared/types';

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
export function managedRscriptCandidates(
  runtimeDir: string,
  platform: NodeJS.Platform,
): string[] {
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
  return managedRscriptCandidates(runtimeDir, platform).find((p) =>
    fsLike.existsSync(p),
  );
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
  processes?: ProcessManager;
}

/** Locate `Rscript` on PATH by scanning PATH dirs for the executable. */
export function findSystemRscript(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  fsLike: FsLike = fs,
): string | undefined {
  const exe = platform === 'win32' ? 'Rscript.exe' : 'Rscript';
  const dirs = (env.PATH ?? '')
    .split(platform === 'win32' ? ';' : ':')
    .filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, exe);
    if (fsLike.existsSync(candidate)) return candidate;
  }
  // Common fixed locations
  const fixed =
    platform === 'darwin'
      ? [
          '/Library/Frameworks/R.framework/Resources/bin/Rscript',
          '/opt/homebrew/bin/Rscript',
          '/usr/local/bin/Rscript',
          path.join(env.HOME ?? '', '.local/share/rig/bin/Rscript'),
        ]
      : platform === 'win32'
        ? windowsRLocations(env)
        : ['/usr/bin/Rscript', '/usr/local/bin/Rscript'];
  return fixed.find((p) => fsLike.existsSync(p));
}

function windowsRLocations(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  for (const base of [
    path.join(env.ProgramFiles ?? 'C:/Program Files', 'R'),
    path.join(env.LOCALAPPDATA ?? '', 'Programs', 'R'),
  ]) {
    try {
      for (const folder of fs.readdirSync(base).sort().reverse())
        out.push(
          path.join(base, folder, 'bin', 'Rscript.exe'),
          path.join(base, folder, 'bin', 'x64', 'Rscript.exe'),
        );
    } catch {
      /* absent */
    }
  }
  if (process.platform === 'win32') {
    const result = spawnSync(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\R-core\\R', '/v', 'InstallPath'],
      { encoding: 'utf8', timeout: 2000, windowsHide: true },
    );
    const match = result.stdout?.match(/InstallPath\s+REG_SZ\s+(.+)/);
    if (match) out.unshift(path.join(match[1]!.trim(), 'bin', 'Rscript.exe'));
  }
  return out;
}

export class RRuntimeManager {
  readonly processes: ProcessManager;
  private customRscript?: string;
  private verified?: {
    rPath: string;
    source: 'managed' | 'system' | 'custom';
    version: string;
    arch: string;
  };
  private pending?: Promise<typeof this.verified>;
  private generation = 0;
  private platform: NodeJS.Platform;
  private fsLike: FsLike;
  constructor(private deps: RuntimeDeps) {
    this.platform = deps.platform ?? process.platform;
    this.fsLike = deps.fsLike ?? fs;
    this.processes =
      deps.processes ??
      new ProcessManager(
        path.join(deps.userDataDir, 'processes'),
        deps.spawner ?? spawn,
      );
    try {
      const data = JSON.parse(
        fs.readFileSync(path.join(deps.userDataDir, 'runtime.json'), 'utf8'),
      ) as { path?: unknown };
      if (typeof data.path === 'string' && path.isAbsolute(data.path))
        this.customRscript = data.path;
    } catch {
      /* no selection */
    }
  }
  get runtimeDir(): string {
    return path.join(this.deps.userDataDir, 'r-runtime');
  }
  get libraryPath(): string {
    const version =
      this.verified?.version.split('.').slice(0, 2).join('.') ?? 'unresolved';
    const arch = (
      this.verified?.arch ??
      this.deps.arch ??
      process.arch
    ).replace(/[^A-Za-z0-9_-]/g, '_');
    return path.join(this.runtimeDir, 'library', `${version}-${arch}`);
  }
  setCustomRscript(value: string | undefined): void {
    if (value && (!path.isAbsolute(value) || !fs.statSync(value).isFile()))
      throw new Error('Select an existing Rscript executable.');
    writeAtomicJson(path.join(this.deps.userDataDir, 'runtime.json'), {
      path: value,
    });
    this.generation++;
    this.customRscript = value;
    this.verified = undefined;
    this.pending = undefined;
  }
  resolveRscript():
    | { rPath: string; source: 'managed' | 'system' | 'custom' }
    | undefined {
    if (this.customRscript)
      return this.fsLike.existsSync(this.customRscript)
        ? { rPath: this.customRscript, source: 'custom' }
        : undefined;
    const managed = resolveManagedRscript(
      this.runtimeDir,
      this.platform,
      this.fsLike,
    );
    if (managed) return { rPath: managed, source: 'managed' };
    const sys =
      this.deps.systemRscript?.() ??
      (this.deps.systemRscript
        ? undefined
        : findSystemRscript(this.platform, process.env, this.fsLike));
    return sys ? { rPath: sys, source: 'system' } : undefined;
  }
  async queryVersion(rPath: string): Promise<string | undefined> {
    const child = this.processes.start(rPath, ['--version'], {
      owner: 'runtime',
      timeoutMs: this.platform === 'win32' ? 30_000 : 10_000,
    });
    const result = await child.done;
    return result.code === 0
      ? parseRVersion(result.stdout + result.stderr)
      : undefined;
  }
  async ready(signal?: AbortSignal): Promise<typeof this.verified> {
    if (signal?.aborted) throw new Error('Operation cancelled.');
    const resolved = this.resolveRscript();
    if (!resolved) return undefined;
    if (this.verified?.rPath === resolved.rPath) return this.verified;
    if (!this.pending) {
      const generation = this.generation;
      const pending = (async () => {
        const child = this.processes.startScript(
          resolved.rPath,
          RUNTIME_SCRIPT,
          { owner: 'runtime', timeoutMs: this.platform === 'win32' ? 30_000 : 10_000 },
        );
        const result = await child.done;
        const match = result.stdout.match(
          /^SLR_RUNTIME:([0-9.]+):([A-Za-z0-9_-]+)$/m,
        );
        if (
          result.error ||
          result.code !== 0 ||
          !match ||
          !meetsMinimum(match[1]!)
        )
          throw new Error(
            'Rscript must run R ≥ 4.2. Select a supported R installation.',
          );
        const verified = { ...resolved, version: match[1]!, arch: match[2]! };
        // A runtime switch cannot adopt a stale verification result.
        if (
          this.generation !== generation ||
          this.resolveRscript()?.rPath !== resolved.rPath
        )
          throw new Error(
            'R runtime changed during verification; retry the operation.',
          );
        this.verified = verified;
        return verified;
      })().finally(() => {
        if (this.pending === pending) this.pending = undefined;
      });
      this.pending = pending;
    }
    const result = await this.pending;
    if (signal?.aborted) throw new Error('Operation cancelled.');
    return result;
  }
  async status(): Promise<RStatus> {
    try {
      const resolved = await this.ready();
      if (!resolved)
        return {
          found: false,
          managed: false,
          libraryPath: this.libraryPath,
          message:
            'R not found. Install R ≥ 4.2 and point to its Rscript executable.',
        };
      return {
        found: true,
        managed: resolved.source === 'managed',
        ...resolved,
        libraryPath: this.libraryPath,
      };
    } catch (e) {
      return {
        found: false,
        managed: false,
        libraryPath: this.libraryPath,
        message: String(e),
      };
    }
  }
  ensureLibrary(): string {
    fs.mkdirSync(this.libraryPath, { recursive: true });
    return this.libraryPath;
  }
  childEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      R_LIBS_USER: this.ensureLibrary(),
    };
    delete env.GITHUB_PAT;
    delete env.GH_TOKEN;
    return { ...env, ...extra };
  }
}
