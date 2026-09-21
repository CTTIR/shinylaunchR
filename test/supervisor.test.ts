import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChildProcess } from 'node:child_process';
import { ShinySupervisor } from '../src/main/shiny-supervisor';
import type { RRuntimeManager } from '../src/main/r-runtime';
import type {
  ManagedProcess,
  ProcessResult,
  RunOptions,
} from '../src/main/process-manager';
import { getFreePort, isPortOpen, waitForPort } from '../src/main/port';
import { DEFAULT_SETTINGS, type AppEntry } from '../src/shared/types';

vi.mock('../src/main/port', () => ({
  getFreePort: vi.fn(),
  isPortOpen: vi.fn(),
  waitForPort: vi.fn(),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function processFixture() {
  const completion = deferred<ProcessResult>();
  let alive = true;
  const exit = (code = 0) => {
    alive = false;
    completion.resolve({ code, stdout: '', stderr: '' });
  };
  const stop = vi.fn(async () => {
    exit();
  });
  const managed: ManagedProcess = {
    child: {} as ChildProcess,
    done: completion.promise,
    stop,
    running: () => alive,
  };
  return { managed, exit, stop };
}
function runtimeFixture(children: ReturnType<typeof processFixture>[]) {
  let index = 0;
  const startScript = vi.fn(
    (_path: string, _script: string, _options: RunOptions) =>
      children[index++]!.managed,
  );
  const runtime = {
    ready: vi.fn(async () => ({
      rPath: '/fixture/Rscript',
      source: 'custom',
      version: '4.6.0',
      arch: 'x86_64',
    })),
    childEnv: (env: NodeJS.ProcessEnv) => env,
    processes: { startScript },
  };
  return { runtime: runtime as unknown as RRuntimeManager, startScript };
}
const app: AppEntry = {
  id: 'b80eb97d-4a11-4a56-8b4f-bbc813277461',
  name: 'Fixture',
  pkg: 'shiny',
  fun: 'runApp',
  source: { kind: 'cran' },
  createdAt: '2026-09-21',
  installed: true,
};
beforeEach(() => {
  vi.clearAllMocks();
  let port = 8400;
  vi.mocked(getFreePort).mockImplementation(async () => port++);
  vi.mocked(isPortOpen).mockResolvedValue(false);
  vi.mocked(waitForPort).mockResolvedValue(true);
});

describe('launch generation ownership', () => {
  it('joins repeated launches and starts one process until explicitly stopped', async () => {
    const child = processFixture(),
      { runtime, startScript } = runtimeFixture([child]);
    const supervisor = new ShinySupervisor();
    const first = supervisor.launch(app, runtime, DEFAULT_SETTINGS);
    const second = supervisor.launch(app, runtime, DEFAULT_SETTINGS);
    expect(second).toBe(first);
    expect(await first).toMatchObject({ ok: true, id: app.id, port: 8400 });
    expect(startScript).toHaveBeenCalledTimes(1);
    expect(supervisor.statuses()).toEqual([
      {
        id: app.id,
        state: 'running',
        port: 8400,
        url: 'http://127.0.0.1:8400',
      },
    ]);
    expect(await supervisor.launch(app, runtime, DEFAULT_SETTINGS)).toEqual(
      await first,
    );
    await supervisor.stop(app.id);
    expect(child.stop).toHaveBeenCalled();
    expect(supervisor.statuses()).toEqual([]);
  });
  it('stop during readiness cancels and drains the owned child', async () => {
    const child = processFixture(),
      { runtime, startScript } = runtimeFixture([child]);
    vi.mocked(waitForPort).mockImplementation(
      (_port, options) =>
        new Promise((resolve) => {
          options?.signal?.addEventListener('abort', () => resolve(false), {
            once: true,
          });
        }),
    );
    const supervisor = new ShinySupervisor();
    const launch = supervisor.launch(app, runtime, DEFAULT_SETTINGS);
    await vi.waitFor(() => expect(startScript).toHaveBeenCalledTimes(1));
    await supervisor.stop(app.id);
    expect(await launch).toMatchObject({ ok: false, id: app.id });
    expect(child.managed.running()).toBe(false);
    expect(supervisor.isRunning(app.id)).toBe(false);
  });
  it('detects an early exit and reports stderr without waiting for readiness timeout', async () => {
    const child = processFixture(),
      { runtime, startScript } = runtimeFixture([child]);
    vi.mocked(waitForPort).mockReturnValue(new Promise(() => {}));
    const supervisor = new ShinySupervisor(),
      launch = supervisor.launch(app, runtime, DEFAULT_SETTINGS);
    await vi.waitFor(() => expect(startScript).toHaveBeenCalledTimes(1));
    startScript.mock.calls[0]![2].onLine?.(
      'Package missing: reinstall the app',
      'stderr',
    );
    child.exit(1);
    expect(await launch).toMatchObject({
      ok: false,
      message: expect.stringContaining('Package missing'),
    });
    expect(supervisor.statuses()).toEqual([]);
  });
  it('ignores late readiness from a stopped generation after relaunch', async () => {
    const old = processFixture(),
      current = processFixture();
    const { runtime, startScript } = runtimeFixture([old, current]);
    const staleReadiness = deferred<boolean>();
    vi.mocked(waitForPort)
      .mockReturnValueOnce(staleReadiness.promise)
      .mockResolvedValueOnce(true);
    const supervisor = new ShinySupervisor(),
      previous = supervisor.launch(app, runtime, DEFAULT_SETTINGS);
    await vi.waitFor(() => expect(startScript).toHaveBeenCalledTimes(1));
    await supervisor.stop(app.id);
    expect((await previous).ok).toBe(false);
    const next = await supervisor.launch(app, runtime, DEFAULT_SETTINGS);
    expect(next).toMatchObject({ ok: true, port: 8401 });
    staleReadiness.resolve(false);
    old.exit(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(supervisor.getRunning(app.id)?.port).toBe(8401);
    expect(current.stop).not.toHaveBeenCalled();
    await supervisor.stopAll();
    expect(current.managed.running()).toBe(false);
  });
  it('does not spawn a process when cancellation occurs during runtime verification', async () => {
    const child = processFixture(),
      { runtime, startScript } = runtimeFixture([child]);
    const checked = deferred<{
      rPath: string;
      source: 'custom';
      version: string;
      arch: string;
    }>();
    vi.mocked(runtime.ready).mockReturnValue(checked.promise);
    const supervisor = new ShinySupervisor(),
      controller = new AbortController();
    const launch = supervisor.launch(
      app,
      runtime,
      DEFAULT_SETTINGS,
      controller.signal,
    );
    controller.abort();
    checked.resolve({
      rPath: '/fixture/Rscript',
      source: 'custom',
      version: '4.6.0',
      arch: 'x86_64',
    });
    expect((await launch).ok).toBe(false);
    expect(startScript).not.toHaveBeenCalled();
    expect(supervisor.statuses()).toEqual([]);
  });
  it('reserves a fixed port once across concurrent apps and releases it after stop', async () => {
    const firstChild = processFixture(),
      nextChild = processFixture();
    const { runtime, startScript } = runtimeFixture([firstChild, nextChild]);
    const supervisor = new ShinySupervisor();
    const fixed = { ...app, fixedPort: 8500 };
    expect((await supervisor.launch(fixed, runtime, DEFAULT_SETTINGS)).ok).toBe(
      true,
    );
    expect(
      (
        await supervisor.launch(
          { ...fixed, id: 'second' },
          runtime,
          DEFAULT_SETTINGS,
        )
      ).ok,
    ).toBe(false);
    expect(startScript).toHaveBeenCalledTimes(1);
    await supervisor.stop(app.id);
    expect(
      (
        await supervisor.launch(
          { ...fixed, id: 'second' },
          runtime,
          DEFAULT_SETTINGS,
        )
      ).ok,
    ).toBe(true);
    await supervisor.stopAll();
  });
});
