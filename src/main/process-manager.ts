/* Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  spawn,
  spawnSync,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';
import { LineReader, logger } from './logger';
import { PidLedger, type ProcessIdentity } from './pid-ledger';
import { windowsJobScript } from './windows-job';

export type Spawner = (
  cmd: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;
export interface ProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
}
export interface ManagedProcess {
  child: ChildProcess;
  done: Promise<ProcessResult>;
  stop(): Promise<void>;
  running(): boolean;
}
export interface RunOptions {
  owner: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
}
const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Read OS identity, never infer ownership from the executable name alone. */
export function processIdentity(
  pid: number,
  marker: string,
): ProcessIdentity | undefined {
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    if (process.platform === 'linux') {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const started = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]!;
      const env = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
      if (!env.includes(`SLR_PROCESS_MARKER=${marker}`)) return undefined;
      return {
        pid,
        started,
        executable: fs.readlinkSync(`/proc/${pid}/exe`),
        marker,
      };
    }
    if (process.platform === 'darwin') {
      const command = spawnSync(
        'ps',
        ['eww', '-p', String(pid), '-o', 'command='],
        {
          encoding: 'utf8',
          timeout: 2000,
        },
      ).stdout.trim();
      if (!command.split(/\s+/).includes(`SLR_PROCESS_MARKER=${marker}`))
        return undefined;
      const started = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], {
        encoding: 'utf8',
        timeout: 2000,
      }).stdout.trim();
      const executable = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], {
        encoding: 'utf8',
        timeout: 2000,
      }).stdout.trim();
      return started && executable
        ? { pid, started, executable, marker }
        : undefined;
    }
    const script = `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if($p){@{started=$p.CreationDate.ToString('o');executable=$p.ExecutablePath;command=$p.CommandLine}|ConvertTo-Json -Compress}`;
    const out = spawnSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', timeout: 3000, windowsHide: true },
    );
    const r = JSON.parse(out.stdout) as {
      started?: string;
      executable?: string;
      command?: string;
    };
    if (!r.command?.includes(marker) || !r.started || !r.executable)
      return undefined;
    return { pid, started: r.started, executable: r.executable, marker };
  } catch {
    return undefined;
  }
}
export function matchesIdentity(record: ProcessIdentity): boolean {
  const live = processIdentity(record.pid, record.marker);
  return (
    !!live &&
    live.started === record.started &&
    live.executable === record.executable
  );
}
export async function killTree(pid: number, force: boolean): Promise<void> {
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const c = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
        timeout: 3000,
      });
      const timer = setTimeout(() => {
        c.kill();
        resolve();
      }, 3500);
      c.on('error', () => {
        clearTimeout(timer);
        resolve();
      });
      c.on('close', () => {
        clearTimeout(timer);
        resolve();
      });
    });
  } else {
    try {
      process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
    } catch {
      try {
        process.kill(pid, force ? 'SIGKILL' : 'SIGTERM');
      } catch {
        /* exited */
      }
    }
  }
}

function cleanEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GITHUB_PAT;
  delete env.GH_TOKEN;
  return env;
}
/** An inherited marker identifies descendants even if their original parent has exited. */
async function finishDescendants(
  marker: string,
  rootPid: number | undefined,
): Promise<void> {
  let candidates: number[];
  if (process.platform === 'linux') {
    candidates = fs.readdirSync('/proc').map(Number);
  } else if (process.platform === 'darwin') {
    // eww includes the inherited environment without terminal-width truncation.
    // Filter once before doing the more expensive complete identity checks.
    const listing = spawnSync('ps', ['eww', '-axo', 'pid=,command='], {
      encoding: 'utf8',
      timeout: 3000,
      maxBuffer: 16 * 1024 * 1024,
    });
    candidates = (listing.stdout ?? '')
      .split('\n')
      .filter((line) =>
        line.split(/\s+/).includes(`SLR_PROCESS_MARKER=${marker}`),
      )
      .map((line) => Number(line.trim().split(/\s+/)[0]));
  } else return; // Windows owns descendants through a kernel Job Object.
  for (const pid of candidates) {
    if (!Number.isInteger(pid) || pid <= 0 || pid === rootPid) continue;
    const identity = processIdentity(pid, marker);
    if (identity && matchesIdentity(identity)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* exited */
      }
    }
  }
}

export class ProcessManager {
  private active = new Set<ManagedProcess>();
  private closing = false;
  private ledger?: PidLedger;
  constructor(
    private directory = path.join(os.tmpdir(), 'shinylaunchR-processes'),
    private spawner: Spawner = spawn,
  ) {}
  enableLedger(file: string): void {
    this.ledger = new PidLedger(file);
  }
  async reap(): Promise<void> {
    if (!this.ledger) return;
    for (const record of this.ledger.list()) {
      if (matchesIdentity(record)) {
        await killTree(record.pid, false);
        await delay(200);
        if (matchesIdentity(record)) await killTree(record.pid, true);
      }
      // Keep unresolved, positively-owned survivors for next startup.
      if (!matchesIdentity(record)) this.ledger.remove(record.pid);
    }
  }
  startScript(
    command: string,
    script: string,
    options: RunOptions,
  ): ManagedProcess {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const marker = randomUUID();
    const file = path.join(this.directory, `${marker}.R`);
    fs.writeFileSync(file, script, { mode: 0o600, flag: 'wx' });
    try {
      return this.start(
        command,
        ['--vanilla', file],
        {
          ...options,
          env: {
            ...cleanEnvironment(),
            ...options.env,
            SLR_PROCESS_MARKER: marker,
          },
        },
        marker,
        () => fs.rmSync(file, { force: true }),
      );
    } catch (err) {
      fs.rmSync(file, { force: true });
      throw err;
    }
  }
  start(
    command: string,
    args: string[],
    options: RunOptions,
    marker = randomUUID(),
    cleanup = () => {},
  ): ManagedProcess {
    if (this.closing || options.signal?.aborted)
      throw new Error('Operation cancelled.');
    const windows = process.platform === 'win32';
    let wrapper: string | undefined;
    let child: ChildProcess;
    try {
      if (windows) {
        fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        wrapper = path.join(this.directory, `${marker}.ps1`);
        fs.writeFileSync(wrapper, windowsJobScript(command, args, marker), {
          mode: 0o600,
          flag: 'wx',
        });
      }
      child = this.spawner(
        windows
          ? path.join(
              process.env.SystemRoot ?? 'C:/Windows',
              'System32',
              'WindowsPowerShell',
              'v1.0',
              'powershell.exe',
            )
          : command,
        windows
          ? [
              '-NoLogo',
              '-NoProfile',
              '-NonInteractive',
              '-ExecutionPolicy',
              'Bypass',
              '-File',
              wrapper!,
            ]
          : args,
        {
          env: {
            ...cleanEnvironment(),
            ...options.env,
            SLR_PROCESS_MARKER: marker,
          },
          // Windows stdin is an ownership lease; app input is NUL in the wrapper.
          stdio: [windows ? 'pipe' : 'ignore', 'pipe', 'pipe'],
          windowsHide: true,
          detached: !windows,
        },
      );
    } catch (error) {
      if (wrapper) fs.rmSync(wrapper, { force: true });
      throw error;
    }
    let jobReady = !windows;
    let startupTimer: ReturnType<typeof setTimeout> | undefined;
    let alive = true,
      error: string | undefined,
      stdout = '',
      stderr = '';
    let resolve!: (result: ProcessResult) => void;
    const done = new Promise<ProcessResult>((r) => {
      resolve = r;
    });
    let stopping: Promise<void> | undefined;
    const record = () => {
      if (child.pid && this.ledger) {
        const identity = processIdentity(child.pid, marker);
        if (identity) {
          try {
            this.ledger.add(identity);
          } catch (e) {
            logger.warn(
              'process',
              `Could not persist process identity: ${String(e)}`,
            );
          }
        }
      }
    };
    const line = (stream: 'stdout' | 'stderr') => (value: string) => {
      if (
        windows &&
        stream === 'stdout' &&
        value === `SLR_JOB_READY_${marker}`
      ) {
        jobReady = true;
        if (startupTimer) clearTimeout(startupTimer);
        return;
      }
      const safe = logger.redact(value);
      if (stream === 'stdout') stdout = (stdout + safe + '\n').slice(-65536);
      else stderr = (stderr + safe + '\n').slice(-65536);
      options.onLine?.(safe, stream);
    };
    const out = new LineReader(line('stdout')),
      err = new LineReader(line('stderr'));
    child.stdin?.on('error', () => {
      /* ownership pipe already closed */
    });
    child.stdout?.on('data', (b: Buffer) => out.push(b));
    child.stderr?.on('data', (b: Buffer) => err.push(b));
    const managed: ManagedProcess = {
      child,
      done,
      running: () => alive,
      stop: () =>
        (stopping ??= (async () => {
          if (!alive) return;
          if (windows) child.stdin?.end();
          else if (child.pid) await killTree(child.pid, false);
          else {
            try {
              child.kill();
            } catch {
              /* spawn failed */
            }
          }
          await Promise.race([done, delay(1500)]);
          if (alive && child.pid) {
            // Also stop a startup compiler if cancellation precedes job creation.
            await killTree(child.pid, true);
          }
          await Promise.race([done, delay(1500)]);
          if (alive)
            throw new Error(
              `Could not confirm termination of process ${child.pid ?? 'unknown'}.`,
            );
        })()),
    };
    this.active.add(managed);
    if (windows) {
      // PowerShell compilation/startup must not leave an unbounded pending launch.
      startupTimer = setTimeout(() => {
        error = 'Windows process supervisor did not start within 15000ms.';
        void managed.stop().catch((e) => logger.error('process', String(e)));
      }, 15000);
    }
    const abort = () => {
      error = 'Operation cancelled.';
      void managed.stop().catch((e) => logger.error('process', String(e)));
    };
    const timer = options.timeoutMs
      ? setTimeout(() => {
          error = `Operation timed out after ${options.timeoutMs}ms.`;
          void managed.stop().catch((e) => logger.error('process', String(e)));
        }, options.timeoutMs)
      : undefined;
    let finishing = false;
    const finish = async (code: number | null) => {
      if (!alive || finishing) return;
      finishing = true;
      await finishDescendants(marker, child.pid);
      alive = false;
      if (timer) clearTimeout(timer);
      if (startupTimer) clearTimeout(startupTimer);
      if (!jobReady && !error) {
        error =
          'Could not start managed process (executable not found or Windows Job Object setup failed).';
      }
      options.signal?.removeEventListener('abort', abort);
      out.end();
      err.end();
      this.active.delete(managed);
      if (child.pid) {
        try {
          this.ledger?.remove(child.pid);
        } catch (e) {
          logger.warn('process', String(e));
        }
      }
      try {
        if (wrapper) fs.rmSync(wrapper, { force: true });
        cleanup();
      } catch (e) {
        logger.warn('process', String(e));
      }
      resolve({ code, stdout, stderr, error });
    };
    child.on('error', (e: Error) => {
      error = logger.redact(e.message);
      if (!child.pid) void finish(null);
    });
    child.on('exit', () => {
      void finishDescendants(marker, child.pid);
    });
    child.on('close', (code: number | null) => {
      void finish(code);
    });
    child.on('spawn', record);
    // Rscript can exec the real R binary after the spawn event. Refresh the identity.
    const refresh = setTimeout(() => {
      if (alive) record();
    }, 150);
    void done.then(() => clearTimeout(refresh));
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    return managed;
  }
  async shutdown(): Promise<void> {
    this.closing = true;
    const results = await Promise.allSettled(
      [...this.active].map((p) => p.stop()),
    );
    const failed = results.find((r) => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
  }
  get size(): number {
    return this.active.size;
  }
}
