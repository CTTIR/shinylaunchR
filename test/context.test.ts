import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ManagedProcess,
  ProcessResult,
} from '../src/main/process-manager';
import type { AppEntry, InstallResult } from '../src/shared/types';
const state = vi.hoisted(() => ({
  windows: [] as any[],
  install: vi.fn<(...args: any[]) => Promise<InstallResult>>(),
  wait: vi.fn<(...args: any[]) => Promise<boolean>>(),
  external: vi.fn(),
  load: vi.fn<() => Promise<void>>(),
  openDialog:
    vi.fn<
      (...args: any[]) => Promise<{ canceled: boolean; filePaths: string[] }>
    >(),
}));
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => process.cwd() },
  nativeTheme: { on: vi.fn() },
  dialog: { showOpenDialog: state.openDialog },
  shell: { openExternal: state.external },
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString(),
  },
  BrowserWindow: class extends EventEmitter {
    destroyed = false;
    minimized = false;
    webContents = Object.assign(new EventEmitter(), {
      setWindowOpenHandler: vi.fn(),
      send: vi.fn(),
      session: Object.assign(new EventEmitter(), {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        setDevicePermissionHandler: vi.fn(),
      }),
    });
    focus = vi.fn();
    restore = vi.fn(() => {
      this.minimized = false;
    });
    constructor(readonly options: unknown) {
      super();
      state.windows.push(this);
    }
    setMenuBarVisibility() {}
    loadURL() {
      return state.load();
    }
    isMinimized() {
      return this.minimized;
    }
    isDestroyed() {
      return this.destroyed;
    }
    close() {
      if (!this.destroyed) {
        this.destroyed = true;
        this.emit('closed');
      }
    }
  },
}));
vi.mock('../src/main/legacy-credentials', () => ({
  createLegacyBackend: () => undefined,
}));
vi.mock('../src/main/port', () => ({
  getFreePort: async () => 8123,
  isPortOpen: async () => false,
  waitForPort: state.wait,
}));
vi.mock('../src/main/installer', () => ({
  installPackage: state.install,
  installSourceDeps: state.install,
}));
import { AppContext } from '../src/main/context';
import { logger } from '../src/main/logger';
const directories: string[] = [];
const contexts: AppContext[] = [];
function context() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-context-'));
  directories.push(directory);
  const ctx = new AppContext(directory);
  contexts.push(ctx);
  vi.spyOn(ctx.runtime, 'ready').mockResolvedValue({
    rPath: '/fixture/Rscript',
    source: 'system',
    version: '4.6.0',
    arch: 'x86_64',
  });
  vi.spyOn(ctx.icons, 'resolvePackageIcon').mockResolvedValue(undefined);
  return ctx;
}
function packageApp(ctx: AppContext, name = 'example') {
  return ctx.registry.add({
    name,
    pkg: name,
    fun: 'runApp',
    source: { kind: 'cran' },
  });
}
function processFixture(): ManagedProcess {
  let running = true;
  let finish!: (result: ProcessResult) => void;
  const done = new Promise<ProcessResult>((resolve) => {
    finish = resolve;
  });
  return {
    child: new EventEmitter() as ChildProcess,
    done,
    running: () => running,
    stop: vi.fn(async () => {
      running = false;
      finish({ code: 0, stdout: '', stderr: '' });
    }),
  };
}
beforeEach(() => {
  state.windows.length = 0;
  state.load.mockReset().mockResolvedValue(undefined);
  state.external.mockReset();
  state.openDialog
    .mockReset()
    .mockResolvedValue({ canceled: true, filePaths: [] });
  state.wait.mockReset().mockResolvedValue(true);
  state.install.mockReset().mockImplementation(async (entry: AppEntry) => ({
    ok: true,
    id: entry.id,
  }));
});
afterEach(async () => {
  await Promise.all(contexts.splice(0).map((ctx) => ctx.shutdown()));
  logger.removeAllListeners('log');
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});
describe('application operation ownership', () => {
  it('deduplicates hosted launch, focuses/restores its existing window and closes it on stop', async () => {
    const ctx = context();
    const app = await ctx.addApp({
      name: 'Hosted',
      source: { kind: 'url', url: 'https://example.org' },
    });
    const results = await Promise.all([ctx.launch(app.id), ctx.launch(app.id)]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(state.windows).toHaveLength(1);
    expect(ctx.anyRunning()).toBe(true);
    const win = state.windows[0]!;
    win.minimized = true;
    await ctx.launch(app.id);
    expect(win.restore).toHaveBeenCalledOnce();
    expect(win.focus).toHaveBeenCalledOnce();
    expect(win.options.webPreferences).toMatchObject({
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      partition: `remote:${app.id}`,
    });
    await ctx.stop(app.id);
    expect(win.destroyed).toBe(true);
    expect(ctx.anyRunning()).toBe(false);
    expect(ctx.statuses()[0]?.state).toBe('ready');
  });
  it('launches local R exactly once without a namespace probe and focuses the existing window', async () => {
    const ctx = context();
    const app = packageApp(ctx);
    ctx.registry.patch(app.id, { installed: true });
    const start = vi
      .spyOn(ctx.processes, 'startScript')
      .mockReturnValue(processFixture());
    const results = await Promise.all([ctx.launch(app.id), ctx.launch(app.id)]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(start).toHaveBeenCalledOnce();
    expect(state.windows).toHaveLength(1);
    expect(ctx.statuses()[0]?.state).toBe('running');
    await ctx.launch(app.id);
    expect(start).toHaveBeenCalledOnce();
    expect(state.windows[0]!.focus).toHaveBeenCalledOnce();
    await ctx.stop(app.id);
    expect(state.windows[0]!.destroyed).toBe(true);
    expect(ctx.supervisor.isRunning(app.id)).toBe(false);
  });
  it('ignores a delayed closed event from an old window after a replacement launch', async () => {
    const ctx = context();
    const app = packageApp(ctx);
    ctx.registry.patch(app.id, { installed: true });
    const oldChild = processFixture(),
      newChild = processFixture();
    vi.spyOn(ctx.processes, 'startScript')
      .mockReturnValueOnce(oldChild)
      .mockReturnValueOnce(newChild);
    expect((await ctx.launch(app.id)).ok).toBe(true);
    const oldWindow = state.windows[0]!;
    vi.spyOn(oldWindow, 'close').mockImplementation(() => {
      oldWindow.destroyed = true;
    });
    await ctx.stop(app.id);
    expect(oldChild.running()).toBe(false);
    expect((await ctx.launch(app.id)).ok).toBe(true);
    oldWindow.emit('closed');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(newChild.running()).toBe(true);
    expect(state.windows[1]!.destroyed).toBe(false);
    expect(ctx.statuses()[0]?.state).toBe('running');
  });
  it('relaunches only the latest installed app on startup when explicitly enabled', async () => {
    const ctx = context();
    const older = await ctx.addApp({
      name: 'Older',
      source: { kind: 'url', url: 'https://example.org/older' },
    });
    const latest = await ctx.addApp({
      name: 'Latest',
      source: { kind: 'url', url: 'https://example.org/latest' },
    });
    const absent = packageApp(ctx, 'absent');
    ctx.registry.patch(older.id, { lastLaunchedAt: '2026-09-20T10:00:00Z' });
    ctx.registry.patch(latest.id, { lastLaunchedAt: '2026-09-21T10:00:00Z' });
    ctx.registry.patch(absent.id, { lastLaunchedAt: '2026-09-22T10:00:00Z' });
    const launch = vi.spyOn(ctx, 'launch');
    await ctx.launchLast();
    expect(launch).not.toHaveBeenCalled();
    ctx.setSettings({ startupLaunchLast: true });
    await ctx.launchLast();
    expect(launch).toHaveBeenCalledExactlyOnceWith(latest.id);
    expect(state.windows).toHaveLength(1);
    expect(ctx.registry.get(latest.id)?.lastLaunchedAt).not.toBe(
      '2026-09-21T10:00:00Z',
    );
  });
  it('serializes library mutations and leaves the active installer lock owned until completion', async () => {
    const ctx = context();
    const a = packageApp(ctx, 'first'),
      b = packageApp(ctx, 'second');
    let finish!: (value: InstallResult) => void;
    state.install.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pa = ctx.install(a.id);
    await vi.waitFor(() => expect(state.install).toHaveBeenCalledTimes(1));
    const lock = path.join(ctx.runtime.libraryPath, '00LOCK-first');
    fs.mkdirSync(lock, { recursive: true });
    const pb = ctx.install(b.id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(state.install).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(lock)).toBe(true);
    expect(ctx.statuses().find((s) => s.id === b.id)?.state).toBe('queued');
    finish({ ok: true, id: a.id });
    expect((await pa).ok).toBe(true);
    expect((await pb).ok).toBe(true);
    expect(state.install).toHaveBeenCalledTimes(2);
    expect(ctx.registry.get(b.id)?.installed).toBe(true);
  });
  it('stops loaded R before replacing shared packages', async () => {
    const ctx = context();
    const running = packageApp(ctx, 'running'),
      other = packageApp(ctx, 'other');
    ctx.registry.patch(running.id, { installed: true });
    const child = processFixture();
    vi.spyOn(ctx.processes, 'startScript').mockReturnValue(child);
    await ctx.launch(running.id);
    state.install.mockImplementationOnce(async (entry) => {
      expect(child.running()).toBe(false);
      expect(state.windows[0]!.destroyed).toBe(true);
      return { ok: true, id: entry.id };
    });
    expect((await ctx.install(other.id)).ok).toBe(true);
    expect(child.stop).toHaveBeenCalled();
  });
  it('editing source cancels and awaits installation before changing persisted launch data', async () => {
    const ctx = context();
    const app = packageApp(ctx);
    let signal!: AbortSignal;
    state.install.mockImplementationOnce(
      (_entry, options) =>
        new Promise((_resolve, reject) => {
          signal = options.signal as AbortSignal;
          signal.addEventListener(
            'abort',
            () => reject(new Error('Installation cancelled')),
            { once: true },
          );
        }),
    );
    const pending = ctx.install(app.id);
    await vi.waitFor(() => expect(state.install).toHaveBeenCalledOnce());
    const updated = await ctx.updateApp(app.id, {
      name: 'Hosted now',
      source: { kind: 'url', url: 'https://example.org/new' },
    });
    expect(signal.aborted).toBe(true);
    expect((await pending).ok).toBe(false);
    expect(updated.source).toEqual({
      kind: 'url',
      url: 'https://example.org/new',
    });
    expect(ctx.statuses()[0]?.state).toBe('ready');
    expect(state.windows).toHaveLength(0);
  });
  it('source edits cancel a pending local launch without creating a late app window', async () => {
    const ctx = context();
    const app = packageApp(ctx);
    ctx.registry.patch(app.id, { installed: true });
    const child = processFixture();
    const start = vi.spyOn(ctx.processes, 'startScript').mockReturnValue(child);
    state.wait.mockImplementationOnce(
      (_port, options) =>
        new Promise((resolve) => {
          const signal = options.signal as AbortSignal;
          if (signal.aborted) resolve(false);
          else
            signal.addEventListener('abort', () => resolve(false), {
              once: true,
            });
        }),
    );
    const launching = ctx.launch(app.id);
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
    await ctx.updateApp(app.id, {
      name: 'Changed source',
      pkg: 'example',
      fun: 'runApp',
      source: { kind: 'github', repo: 'owner/new-source' },
    });
    expect((await launching).ok).toBe(false);
    expect(child.running()).toBe(false);
    expect(state.windows).toHaveLength(0);
    expect(ctx.registry.get(app.id)?.installed).toBe(false);
    expect(ctx.statuses()[0]?.state).toBe('not-installed');
  });
  it('stopAll cancels queued work before another installer can start', async () => {
    const ctx = context();
    const first = packageApp(ctx, 'first'),
      second = packageApp(ctx, 'second');
    state.install.mockImplementation(
      (_entry, options) =>
        new Promise((_resolve, reject) => {
          const signal = options.signal as AbortSignal;
          if (signal.aborted) reject(new Error('Cancelled'));
          else
            signal.addEventListener(
              'abort',
              () => reject(new Error('Cancelled')),
              { once: true },
            );
        }),
    );
    const a = ctx.install(first.id);
    await vi.waitFor(() => expect(state.install).toHaveBeenCalledOnce());
    const b = ctx.install(second.id);
    await ctx.stopAll();
    expect((await a).ok).toBe(false);
    expect((await b).ok).toBe(false);
    expect(state.install).toHaveBeenCalledTimes(1);
    expect(
      ctx
        .statuses()
        .every(
          (status) =>
            !['queued', 'installing', 'launching'].includes(status.state),
        ),
    ).toBe(true);
  });
  it('reserves edit ownership before awaiting stop so a late install cannot enter', async () => {
    const ctx = context();
    const app = packageApp(ctx);
    let release!: () => void;
    const stopping = vi.spyOn(ctx.supervisor, 'stop').mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const editing = ctx.updateApp(app.id, {
      name: 'New source',
      pkg: 'example',
      fun: 'runApp',
      source: { kind: 'github', repo: 'owner/changed' },
    });
    await vi.waitFor(() => expect(stopping).toHaveBeenCalled());
    const installing = ctx.install(app.id);
    // Let the attempted install settle before releasing the edit's stop barrier.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const calledDuringEdit = state.install.mock.calls.length;
    release();
    await editing;
    expect((await installing).ok).toBe(false);
    expect(calledDuringEdit).toBe(0);
    expect(state.install).not.toHaveBeenCalled();
    expect(ctx.registry.get(app.id)?.source).toEqual({
      kind: 'github',
      repo: 'owner/changed',
    });
  });
  it.each(['stop', 'remove'] as const)(
    'reserves %s ownership before awaiting stop, rejecting late installs and launches',
    async (action) => {
      const ctx = context();
      const app = packageApp(ctx);
      ctx.registry.patch(app.id, { installed: true });
      let release!: () => void;
      const stopping = vi.spyOn(ctx.supervisor, 'stop').mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const changing =
        action === 'stop' ? ctx.stop(app.id) : ctx.removeApp(app.id, false);
      await vi.waitFor(() => expect(stopping).toHaveBeenCalled());
      const installing = ctx.install(app.id);
      const launching = ctx.launch(app.id);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const calledDuringChange = state.install.mock.calls.length;
      release();
      await changing;
      expect((await installing).ok).toBe(false);
      expect((await launching).ok).toBe(false);
      expect(calledDuringChange).toBe(0);
      expect(state.install).not.toHaveBeenCalled();
      expect(state.windows).toHaveLength(0);
      if (action === 'remove') expect(ctx.registry.get(app.id)).toBeUndefined();
    },
  );
  it('refuses runtime selection during an active install without opening the picker', async () => {
    const ctx = context();
    const app = packageApp(ctx);
    let finish!: (value: InstallResult) => void;
    state.install.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const installing = ctx.install(app.id);
    await vi.waitFor(() => expect(state.install).toHaveBeenCalledOnce());
    const choosing = ctx.rPointTo();
    // Attach immediately so an expected rejection cannot become unhandled.
    const rejected = expect(choosing).rejects.toThrow(
      /wait|operation|install|running|busy/i,
    );
    finish({ ok: true, id: app.id });
    await installing;
    await rejected;
    expect(state.openDialog).not.toHaveBeenCalled();
  });
  it('refuses runtime selection while a local R app is running', async () => {
    const ctx = context();
    const app = packageApp(ctx);
    ctx.registry.patch(app.id, { installed: true });
    vi.spyOn(ctx.processes, 'startScript').mockReturnValue(processFixture());
    expect((await ctx.launch(app.id)).ok).toBe(true);
    await expect(ctx.rPointTo()).rejects.toThrow(/stop|running|busy/i);
    expect(state.openDialog).not.toHaveBeenCalled();
  });
  it('reserves runtime selection while its picker is open, rejecting new installs', async () => {
    const ctx = context();
    const app = packageApp(ctx);
    let closePicker!: (value: {
      canceled: boolean;
      filePaths: string[];
    }) => void;
    state.openDialog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          closePicker = resolve;
        }),
    );
    vi.spyOn(ctx.runtime, 'status').mockResolvedValue({
      found: true,
      managed: false,
    });
    const choosing = ctx.rPointTo();
    await vi.waitFor(() => expect(state.openDialog).toHaveBeenCalledOnce());
    const installing = ctx.install(app.id);
    await new Promise<void>((resolve) => setImmediate(resolve));
    const calledDuringPicker = state.install.mock.calls.length;
    closePicker({ canceled: true, filePaths: [] });
    await choosing;
    expect((await installing).ok).toBe(false);
    expect(calledDuringPicker).toBe(0);
    expect(state.install).not.toHaveBeenCalled();
  });
  it('failed installation clears busy ownership, exposes an error and succeeds on retry', async () => {
    const ctx = context();
    const app = packageApp(ctx);
    state.install.mockRejectedValueOnce(
      new Error('Network unavailable; retry installation.'),
    );
    expect((await ctx.install(app.id)).ok).toBe(false);
    expect(ctx.statuses()[0]).toMatchObject({
      state: 'error',
      message: expect.stringContaining('retry'),
    });
    expect((await ctx.install(app.id)).ok).toBe(true);
    expect(ctx.statuses()[0]?.state).toBe('ready');
  });
  it('failed launch can be retried after its pending ownership is released', async () => {
    const ctx = context();
    const app = packageApp(ctx);
    ctx.registry.patch(app.id, { installed: true });
    const start = vi
      .spyOn(ctx.processes, 'startScript')
      .mockImplementationOnce(() => {
        throw new Error('spawn failed');
      })
      .mockReturnValue(processFixture());
    expect((await ctx.launch(app.id)).ok).toBe(false);
    expect(ctx.statuses()[0]?.state).toBe('error');
    expect((await ctx.launch(app.id)).ok).toBe(true);
    expect(ctx.statuses()[0]?.state).toBe('running');
    expect(start).toHaveBeenCalledTimes(2);
  });
  it('rejects credential-bearing and non-HTTPS external URLs before opening the OS browser', async () => {
    const ctx = context();
    for (const url of [
      'https://user:secret@example.org',
      'file:///tmp/document',
      'javascript:alert(1)',
      'http://example.org',
    ]) {
      const result = await ctx.openExternal(url).catch(() => ({ ok: false }));
      expect(result.ok).toBe(false);
    }
    expect(state.external).not.toHaveBeenCalled();
    expect((await ctx.openExternal('https://example.org/help')).ok).toBe(true);
    expect(state.external).toHaveBeenCalledOnce();
  });
});

it('does not uninstall from a different runtime library', async () => {
  const ctx = context();
  const entry = packageApp(ctx);
  ctx.registry.patch(entry.id, {
    installed: true,
    libraryPath: '/fixture/different-runtime-library',
  });
  await expect(ctx.removeApp(entry.id, true)).rejects.toThrow(
    /original R runtime/,
  );
  expect(ctx.registry.get(entry.id)).toBeDefined();
});

it('ignores a late load failure from an old window after replacement', async () => {
  const ctx = context();
  const entry = packageApp(ctx);
  ctx.registry.patch(entry.id, { installed: true });
  const oldChild = processFixture(),
    newChild = processFixture();
  vi.spyOn(ctx.processes, 'startScript')
    .mockReturnValueOnce(oldChild)
    .mockReturnValueOnce(newChild);
  let rejectLoad!: (reason: Error) => void;
  state.load.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        rejectLoad = reject;
      }),
  );
  expect((await ctx.launch(entry.id)).ok).toBe(true);
  await ctx.stop(entry.id);
  expect((await ctx.launch(entry.id)).ok).toBe(true);
  rejectLoad(new Error('old navigation failed'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(newChild.running()).toBe(true);
  expect(ctx.statuses()[0]?.state).toBe('running');
  expect(state.windows[1]?.destroyed).toBe(false);
});
