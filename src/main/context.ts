/**
 * Application context: owns the service instances and implements the
 * high-level operations (add / install / launch / stop / manage) that both the
 * IPC layer and the native Menu delegate to. Keeps business logic in one place.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron';
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
import { IconManager } from './icons';
import { installPackage, verifyPackageLoads } from './installer';
import { getSettings, initSettings, setSettings } from './settings';
import * as credentials from './credentials';
import { resourcePath } from './resources';

export class AppContext {
  readonly registry: Registry;
  readonly runtime: RRuntimeManager;
  readonly supervisor: ShinySupervisor;
  readonly icons: IconManager;

  private mainWindow: BrowserWindow | null = null;
  private selectedId: string | null = null;
  private installing = new Set<string>();
  private errors = new Map<string, string>();
  private menuRebuilder: (() => void) | null = null;

  constructor(private readonly userDataDir: string) {
    initSettings(userDataDir);
    this.registry = new Registry(path.join(userDataDir, 'registry.json'));
    this.runtime = new RRuntimeManager({ userDataDir });
    this.supervisor = new ShinySupervisor();
    this.icons = new IconManager(path.join(userDataDir, 'icons'));

    this.supervisor.setStatusListener(() => this.broadcastStatus());
    logger.on('log', (e: LogEvent) => this.send(IPC.evtLog, e));

    const settings = getSettings();
    this.applyTheme(settings.theme);
    nativeTheme.on('updated', () => {
      if (getSettings().theme === 'system') this.broadcastStatus();
    });
  }

  // -- window wiring -------------------------------------------------------

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
    return this.supervisor.statuses().length > 0;
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
    return this.registry.list().map((entry) => {
      if (this.supervisor.isRunning(entry.id)) {
        const r = this.supervisor.getRunning(entry.id)!;
        return { id: entry.id, state: 'running', port: r.port, url: r.url };
      }
      if (this.installing.has(entry.id)) return { id: entry.id, state: 'installing' };
      if (this.errors.has(entry.id)) {
        return { id: entry.id, state: 'error', message: this.errors.get(entry.id) };
      }
      return { id: entry.id, state: entry.installed ? 'ready' : 'not-installed' };
    });
  }

  // -- registry CRUD -------------------------------------------------------

  listApps(): AppEntry[] {
    return this.registry.list();
  }

  async addApp(input: AppEntryInput): Promise<AppEntry> {
    const entry = this.registry.add(input);
    if (input.iconPath) {
      const cached = this.icons.copyUserIcon(input.iconPath, entry.id);
      if (cached) this.registry.patch(entry.id, { iconPath: cached });
    }
    logger.info('registry', `Added app "${entry.name}" (${entry.pkg}).`, entry.id);
    // Kick off installation in the background.
    void this.install(entry.id);
    return this.registry.get(entry.id)!;
  }

  async updateApp(id: string, input: AppEntryInput): Promise<AppEntry> {
    const updated = this.registry.update(id, input);
    if (input.iconPath && input.iconPath !== updated.iconPath) {
      const cached = this.icons.copyUserIcon(input.iconPath, id);
      if (cached) this.registry.patch(id, { iconPath: cached });
    }
    logger.info('registry', `Updated app "${updated.name}".`, id);
    this.broadcastStatus();
    return this.registry.get(id)!;
  }

  async removeApp(id: string, alsoUninstall: boolean): Promise<OkResult> {
    if (this.supervisor.isRunning(id)) this.supervisor.stop(id);
    const entry = this.registry.get(id);
    this.registry.remove(id);
    this.errors.delete(id);
    if (entry?.iconPath) this.deleteCachedIcon(entry.iconPath);
    if (alsoUninstall && entry) {
      logger.info(
        'registry',
        `Removing app; package uninstall requested for ${entry.pkg} (manual cleanup may be required).`,
        id,
      );
      // Best-effort: leave the managed library intact to avoid breaking shared deps.
    }
    if (this.selectedId === id) this.selectedId = null;
    this.broadcastStatus();
    return { ok: true };
  }

  // -- install / launch ----------------------------------------------------

  async install(id: string): Promise<InstallResult> {
    const entry = this.registry.get(id);
    if (!entry) return { ok: false, id, message: 'Unknown app.' };
    this.errors.delete(id);
    this.installing.add(id);
    this.broadcastStatus();
    let token: string | null = null;
    try {
      token = await credentials.getToken();
    } catch {
      token = null;
    }
    const result = await installPackage(entry, {
      runtime: this.runtime,
      settings: getSettings(),
      token,
    });
    this.installing.delete(id);
    if (result.ok) {
      this.registry.patch(id, { installed: true });
      // Resolve a package icon if the user didn't supply one.
      if (!entry.iconPath) {
        const iconPath = await this.icons.resolvePackageIcon(entry, this.runtime);
        if (iconPath) this.registry.patch(id, { iconPath });
      }
    } else if (result.message) {
      this.errors.set(id, result.message);
    }
    this.broadcastStatus();
    return result;
  }

  async launch(id: string): Promise<LaunchResult> {
    const entry = this.registry.get(id);
    if (!entry) return { ok: false, id, message: 'Unknown app.' };
    if (!entry.installed) {
      return { ok: false, id, message: 'App is not installed yet.' };
    }
    // Pre-launch probe: if the package's namespace won't load (e.g. a missing
    // dependency), surface a clear error instead of spawning R into a halt.
    const loads = await verifyPackageLoads(entry.pkg, { runtime: this.runtime });
    if (!loads) {
      const message =
        `App "${entry.pkg}" can't load — a dependency may be missing. ` +
        `Try Reinstall / Update to install its full dependency tree.`;
      this.errors.set(id, message);
      logger.error('shiny', message, id);
      this.broadcastStatus();
      return { ok: false, id, message };
    }
    const result = await this.supervisor.launch(entry, this.runtime, getSettings());
    if (!result.ok) {
      if (result.message) this.errors.set(id, result.message);
      this.broadcastStatus();
      return result;
    }
    this.errors.delete(id);
    this.registry.patch(id, { lastLaunchedAt: new Date().toISOString() });
    this.openAppWindow(entry, result.url!);
    this.broadcastStatus();
    return result;
  }

  private openAppWindow(entry: AppEntry, url: string): void {
    const settings = getSettings();
    const win = new BrowserWindow({
      width: settings.defaultWindowWidth,
      height: settings.defaultWindowHeight,
      title: entry.name,
      icon: entry.iconPath ?? this.defaultIconPath(),
      frame: !entry.frameless,
      backgroundColor: '#1a1a1d',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    win.setMenuBarVisibility(false);

    // The window may only ever show this app's own supervised loopback server.
    // Block navigation elsewhere; route external links to the system browser.
    const origin = `http://127.0.0.1:${this.supervisor.getRunning(entry.id)?.port ?? ''}`;
    win.webContents.on('will-navigate', (event, target) => {
      if (!target.startsWith(origin)) {
        event.preventDefault();
        if (/^https:\/\//i.test(target)) void shell.openExternal(target);
      }
    });
    win.webContents.setWindowOpenHandler(({ url: target }) => {
      if (/^https:\/\//i.test(target)) void shell.openExternal(target);
      return { action: 'deny' };
    });

    void win.loadURL(url);
    this.supervisor.attachWindow(entry.id, win);
    win.on('closed', () => {
      this.supervisor.stop(entry.id);
    });
  }

  stop(id: string): OkResult {
    this.supervisor.stop(id);
    return { ok: true };
  }

  stopAll(): OkResult {
    this.supervisor.stopAll();
    return { ok: true };
  }

  // -- icons ---------------------------------------------------------------

  async pickIcon(): Promise<string | undefined> {
    const res = await dialog.showOpenDialog(this.mainWindow ?? undefined!, {
      title: 'Choose an icon',
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'svg', 'jpg', 'jpeg', 'gif', 'ico'] }],
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
    if (res.canceled || !res.filePath) return { ok: false, message: 'Cancelled' };
    fs.writeFileSync(res.filePath, JSON.stringify(this.registry.exportData(), null, 2), 'utf-8');
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

  async rBootstrap(): Promise<RStatus> {
    try {
      return await this.runtime.bootstrap();
    } catch (err) {
      const status = await this.runtime.status();
      return { ...status, message: String(err instanceof Error ? err.message : err) };
    }
  }

  async rPointTo(): Promise<RStatus> {
    const res = await dialog.showOpenDialog(this.mainWindow ?? undefined!, {
      title: 'Locate Rscript executable',
      properties: ['openFile'],
    });
    if (!res.canceled && res.filePaths[0]) {
      this.runtime.setCustomRscript(res.filePaths[0]);
      logger.info('r-runtime', `Using custom Rscript: ${res.filePaths[0]}`);
    }
    return this.runtime.status();
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
    if (!/^https:\/\//i.test(url)) return { ok: false, message: 'Only https URLs are allowed' };
    await shell.openExternal(url);
    return { ok: true };
  }
}
