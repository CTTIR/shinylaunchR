/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Application context: owns the service instances and implements the
 * high-level operations (add / install / launch / stop / manage) that both the
 * IPC layer and the native Menu delegate to. Keeps business logic in one place.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  nativeTheme,
  shell,
  safeStorage,
  type IpcMainInvokeEvent,
} from 'electron';
import { ProcessManager } from './process-manager';
import { OperationCoordinator } from './operation-coordinator';
import {
  restrictSession,
  restrictWindow,
  sameOrigin,
  trustedSender,
  openHttps,
} from './window-policy';
import { pathToFileURL } from 'node:url';
import {
  IPC,
  type AppEntry,
  type AppEntryInput,
  type AppInfo,
  type AppSettings,
  type AppStatus,
  type CredentialStatus,
  type InstallResult,
  type LaunchResult,
  type LogEvent,
  type OkResult,
  type RStatus,
  type TokenTestResult,
} from '@shared/types';
import { logger } from './logger';
import { Registry } from './registry';
import { RRuntimeManager } from './r-runtime';
import { ShinySupervisor } from './shiny-supervisor';
import { removeInstalledPackage } from './library';
import { IconManager } from './icons';
import { installPackage, installSourceDeps } from './installer';
import {
  removeStaged,
  scanDependencyModel,
  prepareSource,
} from './source-apps';
import { getSettings, initSettings, setSettings } from './settings';
import * as credentials from './credentials';
import { createLegacyBackend } from './legacy-credentials';
import { resourcePath } from './resources';

export class AppContext {
  readonly registry: Registry;
  readonly runtime: RRuntimeManager;
  readonly supervisor: ShinySupervisor;
  readonly icons: IconManager;

  readonly processes: ProcessManager;
  private operations: OperationCoordinator;
  private windows = new Map<string, BrowserWindow>();
  private mainWindow: BrowserWindow | null = null;
  private selectedId: string | null = null;
  private installing = new Set<string>();
  private errors = new Map<string, string>();
  private menuRebuilder: (() => void) | null = null;

  constructor(
    private readonly userDataDir: string,
    options: { smoke?: boolean } = {},
  ) {
    initSettings(userDataDir);
    this.registry = new Registry(path.join(userDataDir, 'registry.json'));
    this.processes = new ProcessManager(path.join(userDataDir, 'processes'));
    this.processes.enableLedger(path.join(userDataDir, 'running-pids.json'));
    this.runtime = new RRuntimeManager({
      userDataDir,
      processes: this.processes,
    });
    this.supervisor = new ShinySupervisor();
    this.operations = new OperationCoordinator(() => this.broadcastStatus());
    credentials.initCredentials(
      userDataDir,
      options.smoke
        ? {
            isEncryptionAvailable: () => false,
            encryptString: () => {
              throw new Error('Smoke credentials disabled');
            },
            decryptString: () => {
              throw new Error('Smoke credentials disabled');
            },
          }
        : safeStorage,
      options.smoke ? undefined : createLegacyBackend(),
    );
    this.icons = new IconManager(path.join(userDataDir, 'icons'));

    this.supervisor.setStatusListener(() => {
      for (const [id, win] of this.windows) {
        const entry = this.registry.get(id);
        if (entry?.source.kind !== 'url' && !this.supervisor.isRunning(id)) {
          this.windows.delete(id);
          if (!win.isDestroyed()) win.close();
        }
      }
      this.broadcastStatus();
    });
    logger.on('log', (e: LogEvent) => this.send(IPC.evtLog, e));

    const settings = getSettings();
    this.applyTheme(settings.theme);
    nativeTheme.on('updated', () => {
      if (getSettings().theme === 'system') this.broadcastStatus();
    });
  }

  // -- window wiring -------------------------------------------------------

  isTrustedSender(
    event: Pick<IpcMainInvokeEvent, 'sender' | 'senderFrame'>,
  ): boolean {
    const dev = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
    const expected =
      dev ?? pathToFileURL(path.join(__dirname, '../renderer/index.html')).href;
    return trustedSender(event, this.mainWindow, expected, !!dev);
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  setSelected(id: string | null): void {
    this.selectedId = id;
    this.menuRebuilder?.();
  }

  getSelected(): string | null {
    return this.selectedId;
  }

  /** Register a callback that rebuilds the native menu (enabled-state refresh). */
  setMenuRebuilder(fn: () => void): void {
    this.menuRebuilder = fn;
  }

  /** True if any app currently has a running R/Shiny process. */
  anyRunning(): boolean {
    return this.supervisor.statuses().length > 0 || this.windows.size > 0;
  }

  /**
   * Reap R processes orphaned by a previous session that crashed or was force
   * -killed (skipping the normal `stopAll`). Those leftovers keep ports bound
   * and — on Windows — hold compiled-package DLLs locked, which blocks the next
   * reinstall. Run once at startup, before the user can trigger an install.
   */
  async reapOrphanProcesses(): Promise<void> {
    await this.processes.reap();
  }

  private send(channel: string, payload: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, payload);
    }
  }

  broadcastStatus(): void {
    this.send(IPC.evtStatus, this.statuses());
    this.menuRebuilder?.();
  }

  applyTheme(theme: AppSettings['theme']): void {
    nativeTheme.themeSource = theme;
  }

  // -- status --------------------------------------------------------------

  statuses(): AppStatus[] {
    const running = new Map(this.supervisor.statuses().map((s) => [s.id, s]));
    return this.registry.list().map((entry) => {
      if (this.installing.has(entry.id))
        return { id: entry.id, state: 'installing' };
      if (this.operations.has(entry.id))
        return {
          id: entry.id,
          state:
            this.operations.kind(entry.id) === 'launch'
              ? 'launching'
              : 'queued',
        };
      const status = running.get(entry.id);
      if (status) return status;
      if (this.windows.has(entry.id)) return { id: entry.id, state: 'running' };
      if (this.errors.has(entry.id))
        return {
          id: entry.id,
          state: 'error',
          message: this.errors.get(entry.id),
        };
      return {
        id: entry.id,
        state: entry.installed ? 'ready' : 'not-installed',
      };
    });
  }

  // -- registry CRUD -------------------------------------------------------

  listApps(): AppEntry[] {
    return this.registry
      .list()
      .map((entry) => ({ ...entry, iconPath: this.icons.url(entry.iconPath) }));
  }

  async addApp(input: AppEntryInput): Promise<AppEntry> {
    const entry = this.registry.add({ ...input, iconPath: undefined });
    try {
      if (input.iconPath)
        this.registry.patch(entry.id, {
          iconPath: this.icons.copyUserIcon(input.iconPath, entry.id),
        });
      if (entry.source.kind === 'url')
        this.registry.patch(entry.id, { installed: true });
    } catch (e) {
      this.registry.remove(entry.id);
      throw e;
    }
    this.broadcastStatus();
    return this.listApps().find((e) => e.id === entry.id)!;
  }

  async updateApp(id: string, input: AppEntryInput): Promise<AppEntry> {
    return this.operations.replace(id, 'update', async (signal) => {
      await this.stopRunning(id);
      signal.throwIfAborted();
      const previous = this.registry.get(id);
      if (!previous) throw new Error('Unknown app.');
      let iconPath = input.iconPath;
      if (iconPath === this.icons.url(previous.iconPath))
        iconPath = previous.iconPath;
      else if (iconPath) iconPath = this.icons.copyUserIcon(iconPath, id);
      this.registry.update(id, { ...input, iconPath });
      if (input.source.kind === 'url')
        this.registry.patch(id, { installed: true });
      this.errors.delete(id);
      this.broadcastStatus();
      return this.listApps().find((e) => e.id === id)!;
    });
  }

  async removeApp(id: string, alsoUninstall: boolean): Promise<OkResult> {
    return this.operations.replace(id, 'remove', async (signal) => {
      await this.stopRunning(id);
      signal.throwIfAborted();
      const entry = this.registry.get(id);
      if (!entry) throw new Error('Unknown app.');
      signal.throwIfAborted();
      if (alsoUninstall && entry.pkg) {
        const other = this.registry
          .list()
          .filter((e) => e.id !== id && e.source.kind !== 'url');
        if (other.length)
          throw new Error(
            'Keep the package: other apps share this library and may depend on it.',
          );
        await this.supervisor.stopAll();
        if (!(await this.runtime.ready(signal)))
          throw new Error(
            'Select the R runtime used for this installation before uninstalling its package.',
          );
        if (entry.libraryPath && entry.libraryPath !== this.runtime.libraryPath)
          throw new Error(
            'Select the original R runtime to uninstall this package, or remove only the launcher entry.',
          );
        const result = removeInstalledPackage(
          this.runtime.libraryPath,
          entry.pkg,
        );
        if (result.failed.length)
          throw new Error(
            'Could not remove the package; close other R sessions and retry.',
          );
      }
      this.registry.remove(id);
      this.errors.delete(id);
      if (entry.iconPath) this.deleteCachedIcon(entry.iconPath);
      removeStaged(this.userDataDir, id);
      if (this.selectedId === id) this.selectedId = null;
      this.broadcastStatus();
      return { ok: true };
    });
  }

  async install(id: string): Promise<InstallResult> {
    try {
      return await this.operations.run(id, 'install', async (signal) => {
        const entry = this.registry.get(id);
        if (!entry) return { ok: false, id, message: 'Unknown app.' };
        this.errors.delete(id);
        if (entry.source.kind === 'url') {
          this.registry.patch(id, { installed: true });
          return { ok: true, id };
        }
        // Shared compiled dependencies cannot be replaced while another owned R app has them loaded.
        await this.supervisor.stopAll();
        signal.throwIfAborted();
        this.installing.add(id);
        this.broadcastStatus();
        try {
          if (!(await this.runtime.ready(signal)))
            throw new Error(
              'R not found. Select a supported Rscript in R Runtime.',
            );
          const libraryPath = this.runtime.libraryPath;
          const needsGithub =
            entry.source.kind === 'github' ||
            (entry.source.kind === 'source' &&
              (['github', 'gist'].includes(entry.source.origin.from) ||
                (entry.source.origin.from === 'zip' &&
                  !!entry.source.origin.url)));
          const token = needsGithub ? await credentials.getToken() : null;
          signal.throwIfAborted();
          let result: InstallResult;
          if (entry.source.kind === 'source') {
            const staged = await prepareSource(entry, {
              userDataDir: this.userDataDir,
              token,
              signal,
            });
            if (!staged.ok || !staged.appDir)
              throw new Error(staged.message ?? 'Staging failed.');
            try {
              const dependencies = scanDependencyModel(staged.appDir);
              result = await installSourceDeps(entry, dependencies.required, {
                runtime: this.runtime,
                settings: getSettings(),
                token,
                signal,
                advisory: dependencies.advisory,
              });
              signal.throwIfAborted();
              if (!result.ok)
                throw new Error(
                  result.message ?? 'Dependency installation failed.',
                );
              const finalDir = staged.commit();
              this.registry.patch(id, {
                stagedPath: finalDir,
                installed: true,
                libraryPath,
              });
              staged.finalize();
              if (!entry.iconPath) {
                try {
                  const icon = this.icons.resolveSourceIcon(finalDir, id);
                  if (icon) this.registry.patch(id, { iconPath: icon });
                } catch {
                  logger.warn(
                    'icons',
                    'App installed; optional icon could not be cached.',
                    id,
                  );
                }
              }
            } catch (e) {
              staged.rollback();
              throw e;
            }
          } else {
            result = await installPackage(entry, {
              runtime: this.runtime,
              settings: getSettings(),
              token,
              signal,
            });
            signal.throwIfAborted();
            if (!result.ok)
              throw new Error(result.message ?? 'Installation failed.');
            this.registry.patch(id, { installed: true, libraryPath });
            if (!entry.iconPath) {
              try {
                const icon = await this.icons.resolvePackageIcon(
                  entry,
                  this.runtime,
                  signal,
                );
                if (icon) this.registry.patch(id, { iconPath: icon });
              } catch {
                logger.warn(
                  'icons',
                  'App installed; optional icon could not be cached.',
                  id,
                );
              }
            }
          }
          return result;
        } finally {
          this.installing.delete(id);
          this.broadcastStatus();
        }
      });
    } catch (e) {
      const message = logger.redact(e instanceof Error ? e.message : String(e));
      this.errors.set(id, message);
      logger.error('installer', message, id);
      this.broadcastStatus();
      return { ok: false, id, message };
    }
  }

  async launch(id: string): Promise<LaunchResult> {
    const current = this.windows.get(id);
    if (current && !current.isDestroyed()) {
      if (current.isMinimized()) current.restore();
      current.focus();
      return { ok: true, id };
    }
    if (this.operations.kind(id) === 'install')
      return {
        ok: false,
        id,
        message: 'Installation is still in progress. Wait or cancel it.',
      };
    try {
      return await this.operations.run(id, 'launch', async (signal) => {
        const entry = this.registry.get(id);
        if (!entry) throw new Error('Unknown app.');
        if (entry.source.kind === 'url') {
          this.openAppWindow(entry, entry.source.url, true);
          this.registry.patch(id, { lastLaunchedAt: new Date().toISOString() });
          return { ok: true, id, url: entry.source.url };
        }
        if (!entry.installed)
          throw new Error('App is not installed yet. Use Install / Update.');
        await this.runtime.ready(signal);
        if (entry.libraryPath && entry.libraryPath !== this.runtime.libraryPath)
          throw new Error(
            'R runtime changed. Reinstall this app into the selected runtime library.',
          );
        if (
          entry.source.kind === 'source' &&
          (!entry.stagedPath || !fs.existsSync(entry.stagedPath))
        )
          throw new Error('Staged app is missing. Reinstall it.');
        const result = await this.supervisor.launch(
          entry,
          this.runtime,
          getSettings(),
          signal,
        );
        if (!result.ok) throw new Error(result.message ?? 'Launch failed.');
        signal.throwIfAborted();
        this.errors.delete(id);
        this.registry.patch(id, { lastLaunchedAt: new Date().toISOString() });
        this.openAppWindow(entry, result.url!, false);
        this.broadcastStatus();
        return result;
      });
    } catch (e) {
      const message = logger.redact(e instanceof Error ? e.message : String(e));
      this.errors.set(id, message);
      logger.error('shiny', message, id);
      this.broadcastStatus();
      return { ok: false, id, message };
    }
  }

  private openAppWindow(entry: AppEntry, url: string, remote: boolean): void {
    const existing = this.windows.get(entry.id);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return;
    }
    const settings = getSettings();
    const win = new BrowserWindow({
      width: settings.defaultWindowWidth,
      height: settings.defaultWindowHeight,
      title: entry.name,
      icon: entry.iconPath ?? this.defaultIconPath(),
      backgroundColor: '#1a1a1d',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInWorker: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        partition: `${remote ? 'remote' : 'local'}:${entry.id}`,
      },
    });
    this.windows.set(entry.id, win);
    win.setMenuBarVisibility(false);
    restrictSession(win.webContents.session);
    restrictWindow(win, (target) => sameOrigin(target, url));
    win.on('closed', () => {
      if (this.windows.get(entry.id) !== win) return;
      this.windows.delete(entry.id);
      void this.supervisor
        .stop(entry.id)
        .catch((e) => logger.error('shiny', String(e)));
      this.broadcastStatus();
    });
    void win.loadURL(url).catch((e) => {
      if (this.windows.get(entry.id) !== win) return;
      this.errors.set(entry.id, logger.redact(String(e)));
      win.close();
      this.broadcastStatus();
    });
  }

  async stop(id: string): Promise<OkResult> {
    return this.operations.replace(id, 'stop', async () => {
      await this.stopRunning(id);
      return { ok: true };
    });
  }
  private async stopRunning(id: string): Promise<void> {
    await this.supervisor.stop(id);
    const win = this.windows.get(id);
    this.windows.delete(id);
    if (win && !win.isDestroyed()) win.close();
    this.errors.delete(id);
    this.broadcastStatus();
  }
  async stopAll(): Promise<OkResult> {
    await Promise.all(this.registry.list().map((entry) => this.stop(entry.id)));
    return { ok: true };
  }
  async shutdown(): Promise<void> {
    await this.operations.shutdown();
    await this.supervisor.stopAll();
    await this.processes.shutdown();
    for (const win of this.windows.values())
      if (!win.isDestroyed()) win.close();
    this.windows.clear();
  }
  async launchLast(): Promise<void> {
    if (!getSettings().startupLaunchLast) return;
    const last = this.registry
      .list()
      .filter((e) => e.installed && e.lastLaunchedAt)
      .sort((a, b) => b.lastLaunchedAt!.localeCompare(a.lastLaunchedAt!))[0];
    if (last) await this.launch(last.id);
  }

  // -- icons ---------------------------------------------------------------

  async pickIcon(): Promise<string | undefined> {
    const res = await dialog.showOpenDialog(this.mainWindow ?? undefined!, {
      title: 'Choose an icon',
      properties: ['openFile'],
      filters: [
        {
          name: 'Images',
          extensions: ['png', 'svg', 'jpg', 'jpeg', 'gif', 'ico'],
        },
      ],
    });
    if (res.canceled || res.filePaths.length === 0) return undefined;
    return res.filePaths[0];
  }

  /** File picker for a Shiny app .zip archive (SHINY FILE family). */
  async pickZipFile(): Promise<string | undefined> {
    const res = await dialog.showOpenDialog(this.mainWindow ?? undefined!, {
      title: 'Choose a Shiny app .zip',
      properties: ['openFile'],
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return undefined;
    return res.filePaths[0];
  }

  /** Directory picker for a local Shiny app folder (SHINY FILE family). */
  async pickFolder(): Promise<string | undefined> {
    const res = await dialog.showOpenDialog(this.mainWindow ?? undefined!, {
      title: 'Choose a Shiny app folder',
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return undefined;
    return res.filePaths[0];
  }

  /**
   * Delete a cached icon, but ONLY if it resolves to a file inside the per-user
   * icon cache directory. An imported registry could carry an attacker-chosen
   * iconPath; this guard prevents arbitrary file deletion on app removal.
   */
  private deleteCachedIcon(iconPath: string): void {
    try {
      const cacheReal = fs.realpathSync(path.join(this.userDataDir, 'icons'));
      const real = fs.realpathSync(iconPath);
      if (real === cacheReal || real.startsWith(cacheReal + path.sep)) {
        fs.rmSync(real, { force: true });
      }
    } catch {
      // missing path / outside cache — leave it untouched
    }
  }

  private defaultIconPath(): string {
    return resourcePath('icon.png');
  }

  // -- registry import / export -------------------------------------------

  async exportRegistry(): Promise<OkResult> {
    const res = await dialog.showSaveDialog(this.mainWindow ?? undefined!, {
      title: 'Export registry',
      defaultPath: 'shinylaunchR-registry.json',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (res.canceled || !res.filePath)
      return { ok: false, message: 'Cancelled' };
    fs.writeFileSync(
      res.filePath,
      JSON.stringify(this.registry.exportData(), null, 2),
      'utf-8',
    );
    return { ok: true, message: `Exported to ${res.filePath}` };
  }

  async importRegistry(): Promise<OkResult> {
    const res = await dialog.showOpenDialog(this.mainWindow ?? undefined!, {
      title: 'Import registry',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    const sourcePath = res.filePaths[0];
    if (res.canceled || !sourcePath) return { ok: false, message: 'Cancelled' };
    try {
      const payload = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
      if (
        this.statuses().some((s) =>
          ['queued', 'installing', 'launching'].includes(s.state),
        )
      )
        throw new Error('Wait for active operations before importing.');
      const n = this.registry.importFrom(payload);
      this.broadcastStatus();
      return { ok: true, message: `Imported ${n} app(s).` };
    } catch (err) {
      return { ok: false, message: `Import failed: ${String(err)}` };
    }
  }

  // -- R runtime -----------------------------------------------------------

  async rStatus(): Promise<RStatus> {
    return this.runtime.status();
  }

  async rPointTo(): Promise<RStatus> {
    return this.operations.runExclusive(async () => {
      if (this.supervisor.statuses().length)
        throw new Error('Stop running R apps before changing the runtime.');
      const res = await dialog.showOpenDialog(this.mainWindow ?? undefined!, {
        title: 'Locate Rscript executable',
        properties: ['openFile'],
      });
      if (!res.canceled && res.filePaths[0]) {
        this.runtime.setCustomRscript(res.filePaths[0]);
        logger.info('r-runtime', `Using custom Rscript: ${res.filePaths[0]}`);
      }
      return this.runtime.status();
    });
  }

  async rOpenLibrary(): Promise<OkResult> {
    const lib = this.runtime.ensureLibrary();
    await shell.openPath(lib);
    return { ok: true };
  }

  // -- settings ------------------------------------------------------------

  getSettings(): AppSettings {
    return getSettings();
  }

  setSettings(patch: Partial<AppSettings>): AppSettings {
    const next = setSettings(patch);
    if (patch.theme) this.applyTheme(next.theme);
    return next;
  }

  async openUserData(): Promise<OkResult> {
    await shell.openPath(this.userDataDir);
    return { ok: true };
  }

  clearIconCache(): OkResult {
    const n = this.icons.clearCache();
    for (const entry of this.registry.list())
      if (entry.iconPath && !this.icons.url(entry.iconPath))
        this.registry.patch(entry.id, { iconPath: undefined });
    this.broadcastStatus();
    return { ok: true, message: `Cleared ${n} cached icon(s).` };
  }

  // -- credentials ---------------------------------------------------------

  credStatus(): Promise<CredentialStatus> {
    return credentials.getStatus();
  }

  credSet(token: string): Promise<CredentialStatus> {
    return credentials.setToken(token);
  }

  credRemove(): Promise<CredentialStatus> {
    return credentials.removeToken();
  }

  credTest(): Promise<TokenTestResult> {
    return credentials.testToken();
  }

  // -- misc ----------------------------------------------------------------

  appInfo(): AppInfo {
    return {
      version: app.getVersion(),
      electron: process.versions.electron ?? '',
      node: process.versions.node ?? '',
      chrome: process.versions.chrome ?? '',
      author: 'Raban Heller',
      orcid: '0000-0001-8006-9742',
      repo: 'https://github.com/cttir/shinylaunchR',
      userDataPath: this.userDataDir,
    };
  }

  async openExternal(url: string): Promise<OkResult> {
    // Only https — never file:/javascript:/http: from a renderer-supplied string.
    await openHttps(url);
    return { ok: true };
  }
}
