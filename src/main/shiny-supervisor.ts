/* Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0 */
import {
  isValidName,
  isValidPkg,
  type AppEntry,
  type AppSettings,
  type LaunchResult,
  type AppStatus,
} from '@shared/types';
import type { RRuntimeManager } from './r-runtime';
import type { ManagedProcess } from './process-manager';
import { LAUNCH_SCRIPT } from './r-scripts';
import { getFreePort, isPortOpen, waitForPort } from './port';
import { logger } from './logger';
interface Running {
  id: string;
  controller: AbortController;
  promise: Promise<LaunchResult>;
  process?: ManagedProcess;
  port?: number;
  url?: string;
  ready: boolean;
}
export class ShinySupervisor {
  private running = new Map<string, Running>();
  private ports = new Set<number>();
  private portQueue: Promise<void> = Promise.resolve();
  private changed = () => {};
  setStatusListener(fn: () => void): void {
    this.changed = fn;
  }
  isRunning(id: string): boolean {
    return this.running.has(id);
  }
  getRunning(id: string): { port: number; url: string } | undefined {
    const r = this.running.get(id);
    return r?.port && r.url ? { port: r.port, url: r.url } : undefined;
  }
  statuses(): AppStatus[] {
    return [...this.running.values()].map((r) => ({
      id: r.id,
      state: r.ready ? 'running' : 'launching',
      port: r.port,
      url: r.url,
    }));
  }
  launch(
    entry: AppEntry,
    runtime: RRuntimeManager,
    settings: AppSettings,
    signal?: AbortSignal,
  ): Promise<LaunchResult> {
    const existing = this.running.get(entry.id);
    if (existing) return existing.promise;
    const record: Running = {
      id: entry.id,
      controller: new AbortController(),
      promise: Promise.resolve({ ok: false, id: entry.id }),
      ready: false,
    };
    this.running.set(entry.id, record);
    const abort = () => record.controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    record.promise = this.start(record, entry, runtime, settings).finally(() =>
      signal?.removeEventListener('abort', abort),
    );
    this.changed();
    return record.promise;
  }
  private async choosePort(
    entry: AppEntry,
    settings: AppSettings,
    signal: AbortSignal,
  ): Promise<number> {
    let release!: () => void;
    const previous = this.portQueue;
    this.portQueue = new Promise<void>((r) => {
      release = r;
    });
    await previous;
    try {
      signal.throwIfAborted();
      const candidates = entry.fixedPort
        ? [entry.fixedPort]
        : settings.portBehavior === 'range'
          ? Array.from(
              { length: settings.portRangeEnd - settings.portRangeStart + 1 },
              (_, i) => settings.portRangeStart + i,
            )
          : [];
      for (let i = 0; i < (candidates.length || 32); i++) {
        signal.throwIfAborted();
        const port = candidates[i] ?? (await getFreePort());
        if (!Number.isInteger(port) || port < 1 || port > 65535)
          throw new Error('Invalid port.');
        if (!this.ports.has(port) && !(await isPortOpen(port))) {
          this.ports.add(port);
          return port;
        }
      }
      throw new Error(
        'No free port available. Choose a different port or range.',
      );
    } finally {
      release();
    }
  }
  private async start(
    r: Running,
    entry: AppEntry,
    runtime: RRuntimeManager,
    settings: AppSettings,
  ): Promise<LaunchResult> {
    let tail = '';
    try {
      const resolved = await runtime.ready(r.controller.signal);
      if (!resolved) throw new Error('R is not available. Open R Runtime.');
      if (
        entry.source.kind !== 'source' &&
        (!entry.pkg ||
          !entry.fun ||
          !isValidPkg(entry.pkg) ||
          !isValidName(entry.fun))
      )
        throw new Error('Invalid package launcher.');
      if (entry.source.kind === 'source' && !entry.stagedPath)
        throw new Error('Source app is not installed.');
      r.port = await this.choosePort(entry, settings, r.controller.signal);
      r.url = `http://127.0.0.1:${r.port}`;
      r.controller.signal.throwIfAborted();
      r.process = runtime.processes.startScript(resolved.rPath, LAUNCH_SCRIPT, {
        owner: entry.id,
        signal: r.controller.signal,
        env: runtime.childEnv({
          SLR_PORT: String(r.port),
          SLR_KIND: entry.source.kind,
          SLR_APP_DIR: entry.stagedPath ?? '',
          SLR_PACKAGE: entry.pkg ?? '',
          SLR_FUNCTION: entry.fun ?? '',
        }),
        onLine: (line, stream) => {
          if (stream === 'stderr') tail = (tail + line + '\n').slice(-4000);
          logger.log(
            stream === 'stderr' ? 'warn' : 'info',
            'shiny',
            line,
            entry.id,
          );
        },
      });
      const child = r.process;
      void child.done.then(() => {
        if (this.running.get(entry.id) === r) {
          this.running.delete(entry.id);
          if (r.port) this.ports.delete(r.port);
          this.changed();
        }
        r.controller.abort();
      });
      const ready = await Promise.race([
        waitForPort(r.port, { timeoutMs: 60_000, signal: r.controller.signal }),
        child.done.then(() => false),
      ]);
      if (!ready || !child.running() || r.controller.signal.aborted)
        throw new Error(
          `App did not start. Check dependencies or reinstall.${tail ? '\n' + tail.trim() : ''}`,
        );
      r.ready = true;
      this.changed();
      return { ok: true, id: entry.id, port: r.port, url: r.url };
    } catch (e) {
      r.controller.abort();
      if (r.process) await r.process.stop();
      if (this.running.get(entry.id) === r) {
        this.running.delete(entry.id);
        if (r.port) this.ports.delete(r.port);
        this.changed();
      }
      return {
        ok: false,
        id: entry.id,
        message: logger.redact(e instanceof Error ? e.message : String(e)),
      };
    }
  }
  async stop(id: string): Promise<void> {
    const r = this.running.get(id);
    if (!r) return;
    r.controller.abort();
    if (r.process) await r.process.stop();
    await r.promise;
    if (this.running.get(id) === r) {
      this.running.delete(id);
      if (r.port) this.ports.delete(r.port);
      this.changed();
    }
  }
  async stopAll(): Promise<void> {
    await Promise.all([...this.running.keys()].map((id) => this.stop(id)));
  }
}
