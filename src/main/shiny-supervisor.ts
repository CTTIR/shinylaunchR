/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Supervises one child Rscript process per launched Shiny app, tracks the
 * (window ↔ process ↔ port) triple, and guarantees the whole process tree is
 * killed on stop/quit — no orphaned R processes ever.
 */
import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'node:child_process';
import type { BrowserWindow } from 'electron';
import {
  isValidName,
  isValidPkg,
  type AppEntry,
  type AppSettings,
  type AppStatus,
  type LaunchResult,
} from '@shared/types';
import { logger } from './logger';
import type { RRuntimeManager } from './r-runtime';
import type { PidLedger } from './pid-ledger';
import { findFreePortInRange, getFreePort, isPortOpen, waitForPort } from './port';

interface RunningApp {
  id: string;
  pid?: number;
  port: number;
  url: string;
  child: ChildProcess;
  window?: BrowserWindow;
}

/** Build the R expression that starts a PACKAGE app headless on a fixed port. */
export function buildLaunchScript(pkg: string, fun: string, port: number): string {
  if (!isValidPkg(pkg)) throw new Error(`invalid package: ${pkg}`);
  if (!isValidName(fun)) throw new Error(`invalid function: ${fun}`);
  return [
    `options(shiny.port = ${port}, shiny.host = "127.0.0.1", shiny.launch.browser = FALSE)`,
    `library(${pkg})`,
    `${pkg}::${fun}()`,
  ].join('; ');
}

/**
 * Build the R expression that runs a SHINY FILE / `source` app from its staged
 * directory headless on a fixed port. `appDir` is an absolute on-disk path; it
 * is emitted as a forward-slash R string literal (R accepts these on Windows)
 * and rejected if it could break out of the literal.
 */
export function buildRunAppScript(appDir: string, port: number): string {
  const safe = appDir.replace(/\\/g, '/');
  if (!safe || /["\n\r]/.test(safe)) throw new Error(`invalid app directory: ${appDir}`);
  return [
    `options(shiny.port = ${port}, shiny.host = "127.0.0.1", shiny.launch.browser = FALSE)`,
    `shiny::runApp("${safe}")`,
  ].join('; ');
}

export interface SupervisorDeps {
  spawner?: (cmd: string, args: string[], options: SpawnOptions) => ChildProcess;
  /** Injectable kill-tree (defaults to a cross-platform implementation). */
  killTree?: (pid: number, platform?: NodeJS.Platform) => void;
  /** Crash-safe PID store; when set, enables orphan reaping across restarts. */
  ledger?: PidLedger;
  /** Identity guard for reaping: is `pid` still one of *our* R processes? */
  isOrphan?: (pid: number) => boolean;
}

/**
 * Best-effort check that `pid` is still alive AND is an R-family process, so a
 * recycled PID (the OS reusing it for an unrelated program after our R crashed)
 * is never killed during orphan reaping. Uses `tasklist` on Windows and `ps`
 * elsewhere; any failure is treated as "not ours" (safer to skip than to kill).
 */
export function defaultIsOrphanRProcess(
  pid: number,
  platform: NodeJS.Platform = process.platform,
): boolean {
  try {
    if (platform === 'win32') {
      const out =
        spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], {
          encoding: 'utf8',
          windowsHide: true,
        }).stdout ?? '';
      return /^"(Rterm|Rscript|R)\.exe"/im.test(out);
    }
    const out = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).stdout ?? '';
    return /(^|\/)(R|Rscript)$/m.test(out.trim());
  } catch {
    return false;
  }
}

export interface KillTreeDeps {
  spawnFn?: (cmd: string, args: string[], options: SpawnOptions) => ChildProcess;
  killFn?: (pid: number, signal?: NodeJS.Signals | number) => void;
}

/**
 * Kill a child process and its descendants on any OS. On Windows a parent kill
 * does NOT reap children, so use `taskkill /T`; on POSIX, signal the process
 * group (negative pid — children share the group via the detached spawn).
 * Primitives are injectable so both branches are unit-tested without real procs.
 */
export function defaultKillTree(
  pid: number,
  platform: NodeJS.Platform = process.platform,
  deps: KillTreeDeps = {},
): void {
  const spawnFn = deps.spawnFn ?? spawn;
  const killFn = deps.killFn ?? ((p, s) => process.kill(p, s));
  try {
    if (platform === 'win32') {
      spawnFn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      // negative pid kills the whole process group (see detached spawn below)
      try {
        killFn(-pid, 'SIGTERM');
      } catch {
        killFn(pid, 'SIGTERM');
      }
    }
  } catch {
    // already gone
  }
}

export class ShinySupervisor {
  private running = new Map<string, RunningApp>();
  private spawner: (cmd: string, args: string[], options: SpawnOptions) => ChildProcess;
  private killTree: (pid: number, platform?: NodeJS.Platform) => void;
  private ledger?: PidLedger;
  private isOrphan: (pid: number) => boolean;
  private onStatusChange?: () => void;

  constructor(deps: SupervisorDeps = {}) {
    this.spawner = deps.spawner ?? spawn;
    this.killTree = deps.killTree ?? defaultKillTree;
    this.ledger = deps.ledger;
    this.isOrphan = deps.isOrphan ?? defaultIsOrphanRProcess;
  }

  /**
   * Kill R processes left over from a previous session that crashed without a
   * clean `stopAll` (so their PIDs are still in the ledger). Each is verified to
   * still be a live R process before being killed, guarding against PID reuse.
   * Returns the number reaped. The ledger is cleared afterwards.
   */
  reapOrphans(): number {
    if (!this.ledger) return 0;
    let killed = 0;
    for (const pid of this.ledger.list()) {
      if (this.isOrphan(pid)) {
        this.killTree(pid);
        killed++;
      }
    }
    this.ledger.clear();
    return killed;
  }

  setStatusListener(fn: () => void): void {
    this.onStatusChange = fn;
  }

  isRunning(id: string): boolean {
    return this.running.has(id);
  }

  getRunning(id: string): { port: number; url: string } | undefined {
    const r = this.running.get(id);
    return r ? { port: r.port, url: r.url } : undefined;
  }

  statuses(): AppStatus[] {
    return [...this.running.values()].map((r) => ({
      id: r.id,
      state: 'running' as const,
      port: r.port,
      url: r.url,
    }));
  }

  private async choosePort(entry: AppEntry, settings: AppSettings): Promise<number> {
    if (entry.fixedPort) {
      const open = await isPortOpen(entry.fixedPort);
      if (open) throw new Error(`Fixed port ${entry.fixedPort} is already in use.`);
      return entry.fixedPort;
    }
    if (settings.portBehavior === 'range') {
      return findFreePortInRange(settings.portRangeStart, settings.portRangeEnd);
    }
    return getFreePort();
  }

  /** Spawn R, wait for the Shiny server to answer, return the URL. */
  async launch(
    entry: AppEntry,
    runtime: RRuntimeManager,
    settings: AppSettings,
  ): Promise<LaunchResult> {
    if (this.running.has(entry.id)) {
      const r = this.running.get(entry.id)!;
      return { ok: true, id: entry.id, port: r.port, url: r.url };
    }
    const resolved = runtime.resolveRscript();
    if (!resolved) {
      return { ok: false, id: entry.id, message: 'R is not available.' };
    }

    let port: number;
    try {
      port = await this.choosePort(entry, settings);
    } catch (err) {
      return { ok: false, id: entry.id, message: String(err) };
    }

    let script: string;
    let what: string;
    try {
      if (entry.source.kind === 'source') {
        if (!entry.stagedPath) throw new Error('source app is not staged yet');
        script = buildRunAppScript(entry.stagedPath, port);
        what = `runApp("${entry.stagedPath}")`;
      } else {
        script = buildLaunchScript(entry.pkg!, entry.fun!, port);
        what = `${entry.pkg}::${entry.fun}()`;
      }
    } catch (err) {
      return { ok: false, id: entry.id, message: String(err) };
    }

    const url = `http://127.0.0.1:${port}`;
    logger.info('shiny', `Launching ${what} on ${url}`, entry.id);

    const child = this.spawner(resolved.rPath, ['--vanilla', '-e', script], {
      env: runtime.childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    let stderrTail = '';
    child.stdout?.on('data', (b: Buffer) => {
      for (const line of b.toString().split(/\r?\n/)) {
        if (line.trim()) logger.info('shiny', line, entry.id);
      }
    });
    child.stderr?.on('data', (b: Buffer) => {
      const text = b.toString();
      stderrTail = (stderrTail + text).slice(-4000);
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) logger.warn('shiny', line, entry.id);
      }
    });

    const record: RunningApp = { id: entry.id, pid: child.pid, port, url, child };
    this.running.set(entry.id, record);
    if (record.pid) this.ledger?.add(record.pid);

    child.on('close', (code) => {
      logger.info('shiny', `Process exited (code ${code}).`, entry.id);
      const r = this.running.get(entry.id);
      this.running.delete(entry.id);
      if (record.pid) this.ledger?.remove(record.pid);
      this.onStatusChange?.();
      if (r?.window && !r.window.isDestroyed()) {
        r.window.close();
      }
    });

    const ready = await waitForPort(port, { timeoutMs: 60_000 });
    if (!ready) {
      this.stop(entry.id);
      return {
        ok: false,
        id: entry.id,
        message: `Shiny app did not become ready within 60s.${
          stderrTail ? `\n--- R stderr ---\n${stderrTail.trim()}` : ''
        }`,
      };
    }

    this.onStatusChange?.();
    return { ok: true, id: entry.id, port, url };
  }

  /** Associate a BrowserWindow so closing one stops the other. */
  attachWindow(id: string, window: BrowserWindow): void {
    const r = this.running.get(id);
    if (r) r.window = window;
  }

  stop(id: string): void {
    const r = this.running.get(id);
    if (!r) return;
    logger.info('shiny', 'Stopping app.', id);
    if (r.pid) {
      this.killTree(r.pid);
      this.ledger?.remove(r.pid);
    }
    try {
      r.child.kill();
    } catch {
      // ignore
    }
    if (r.window && !r.window.isDestroyed()) {
      r.window.close();
    }
    this.running.delete(id);
    this.onStatusChange?.();
  }

  stopAll(): void {
    for (const id of [...this.running.keys()]) this.stop(id);
  }
}
