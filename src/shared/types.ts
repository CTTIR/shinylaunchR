/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared type contracts between the Electron main process and the renderer.
 * This module must remain free of any Node or Electron imports so it can be
 * bundled into the (sandboxed) renderer as well as the main process.
 */

// ---------------------------------------------------------------------------
// Validation regexes — single source of truth, used by both ends.
// ---------------------------------------------------------------------------

/**
 * A valid R object name (e.g. a launcher function). Never interpolated into a
 * shell — only into a fully-qualified `pkg::fun()` call.
 */
export const NAME_REGEX = /^[A-Za-z.][A-Za-z0-9._]*$/;

/**
 * A valid R package name. Stricter than NAME_REGEX: CRAN package names start
 * with a letter and contain only letters, digits and dots — no underscores,
 * no leading dot. Keeps the install/launch injection surface minimal.
 */
export const PKG_REGEX = /^[A-Za-z][A-Za-z0-9.]*$/;

/** A GitHub "org/repo" or "org/repo@ref" spec. */
export const REPO_REGEX = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(@[A-Za-z0-9_./-]+)?$/;

export function isValidName(value: string): boolean {
  return NAME_REGEX.test(value);
}

export function isValidPkg(value: string): boolean {
  return PKG_REGEX.test(value);
}

export function isValidRepo(value: string): boolean {
  return REPO_REGEX.test(value);
}

// ---------------------------------------------------------------------------
// Registry / app model
// ---------------------------------------------------------------------------

export type AppSource =
  | { kind: 'cran' }
  | { kind: 'github'; repo: string }; // "org/repo[@ref]"

export interface AppEntry {
  id: string; // uuid
  name: string; // display name, user-editable
  pkg: string; // R package name
  fun: string; // launcher function, e.g. "mp_run_app"
  source: AppSource;
  iconPath?: string; // cached resolved icon (png/svg)
  installed: boolean; // is the pkg present in the managed library?
  fixedPort?: number; // optional; default = auto
  frameless?: boolean; // launched window chrome preference
  createdAt: string;
  lastLaunchedAt?: string;
}

/** Input shape for creating / editing an app (no server-managed fields). */
export interface AppEntryInput {
  name: string;
  pkg: string;
  fun: string;
  source: AppSource;
  iconPath?: string;
  fixedPort?: number;
  frameless?: boolean;
}

export type RegistryFile = {
  version: 1;
  apps: AppEntry[];
};

// ---------------------------------------------------------------------------
// App runtime status (computed; not persisted)
// ---------------------------------------------------------------------------

export type AppRunState = 'not-installed' | 'installing' | 'ready' | 'running' | 'error';

export interface AppStatus {
  id: string;
  state: AppRunState;
  port?: number;
  url?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// R runtime
// ---------------------------------------------------------------------------

export interface RStatus {
  found: boolean;
  managed: boolean; // is this the app-managed runtime under userData/r-runtime?
  rPath?: string; // absolute path to the R/Rscript executable
  version?: string; // e.g. "4.4.2"
  libraryPath?: string; // managed library path
  source?: 'managed' | 'system' | 'custom';
  message?: string;
}

export interface RSourceEntry {
  url: string;
  sha256?: string;
  kind: 'zip' | 'tar.gz' | 'pkg' | 'exe';
}

export type RSourcesConfig = {
  defaultVersion: string;
  platforms: {
    [platformKey: string]: {
      [version: string]: RSourceEntry;
    };
  };
};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type ThemePreference = 'dark' | 'light' | 'system';
export type PortBehavior = 'auto' | 'range';

export interface AppSettings {
  theme: ThemePreference;
  defaultWindowWidth: number;
  defaultWindowHeight: number;
  portBehavior: PortBehavior;
  portRangeStart: number;
  portRangeEnd: number;
  cranMirror: string;
  preferPak: boolean;
  startupLaunchLast: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  defaultWindowWidth: 1100,
  defaultWindowHeight: 800,
  portBehavior: 'auto',
  portRangeStart: 8000,
  portRangeEnd: 8999,
  cranMirror: 'https://cloud.r-project.org',
  preferPak: true,
  startupLaunchLast: false,
};

// ---------------------------------------------------------------------------
// Credentials (the token value never crosses IPC to the renderer)
// ---------------------------------------------------------------------------

export interface CredentialStatus {
  present: boolean;
  last4?: string;
  backend: 'keytar' | 'unavailable';
}

export interface TokenTestResult {
  ok: boolean;
  login?: string;
  scopes?: string[];
  message?: string;
}

// ---------------------------------------------------------------------------
// Operation results
// ---------------------------------------------------------------------------

export interface LaunchResult {
  ok: boolean;
  id: string;
  port?: number;
  url?: string;
  message?: string;
}

export interface InstallResult {
  ok: boolean;
  id: string;
  message?: string;
}

export interface OkResult {
  ok: boolean;
  message?: string;
}

// ---------------------------------------------------------------------------
// Log streaming
// ---------------------------------------------------------------------------

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEvent {
  ts: string;
  level: LogLevel;
  scope: string; // e.g. "installer", "shiny", appId
  appId?: string;
  message: string;
}

// ---------------------------------------------------------------------------
// IPC channel names — the typed contract surface.
// ---------------------------------------------------------------------------

export const IPC = {
  // registry
  listApps: 'registry:list',
  addApp: 'registry:add',
  updateApp: 'registry:update',
  removeApp: 'registry:remove',
  exportRegistry: 'registry:export',
  importRegistry: 'registry:import',
  // status
  getStatuses: 'status:getAll',
  // install / launch
  install: 'app:install',
  launch: 'app:launch',
  stop: 'app:stop',
  stopAll: 'app:stopAll',
  // icons
  pickIcon: 'icon:pick',
  // R runtime
  rStatus: 'r:status',
  rBootstrap: 'r:bootstrap',
  rPointTo: 'r:pointTo',
  rOpenLibrary: 'r:openLibrary',
  // settings
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  openUserData: 'settings:openUserData',
  clearIconCache: 'settings:clearIconCache',
  // credentials
  credStatus: 'cred:status',
  credSet: 'cred:set',
  credRemove: 'cred:remove',
  credTest: 'cred:test',
  // misc
  appInfo: 'app:info',
  openExternal: 'app:openExternal',
  selectApp: 'app:select',
  // events (main -> renderer)
  evtLog: 'evt:log',
  evtStatus: 'evt:status',
  evtMenu: 'evt:menu',
} as const;

/** Commands the native menu dispatches to the renderer UI. */
export type MenuCommand =
  | 'add-app'
  | 'edit-selected'
  | 'reinstall-selected'
  | 'remove-selected'
  | 'launch-selected'
  | 'stop-selected'
  | 'stop-all'
  | 'toggle-log'
  | 'open-r-panel'
  | 'open-settings'
  | 'open-credentials'
  | 'open-help'
  | 'open-about'
  | 'open-shortcuts'
  | 'theme-dark'
  | 'theme-light'
  | 'theme-system';

export interface AppInfo {
  version: string;
  electron: string;
  node: string;
  chrome: string;
  author: string;
  orcid: string;
  repo: string;
  userDataPath: string;
}

/**
 * The shape exposed to the renderer via contextBridge as `window.shinylaunchR`.
 */
export interface ShinyLaunchAPI {
  listApps(): Promise<AppEntry[]>;
  addApp(input: AppEntryInput): Promise<AppEntry>;
  updateApp(id: string, input: AppEntryInput): Promise<AppEntry>;
  removeApp(id: string, alsoUninstall: boolean): Promise<OkResult>;
  exportRegistry(): Promise<OkResult>;
  importRegistry(): Promise<OkResult>;

  getStatuses(): Promise<AppStatus[]>;

  install(id: string): Promise<InstallResult>;
  launch(id: string): Promise<LaunchResult>;
  stop(id: string): Promise<OkResult>;
  stopAll(): Promise<OkResult>;

  pickIcon(): Promise<string | undefined>;

  rStatus(): Promise<RStatus>;
  rBootstrap(): Promise<RStatus>;
  rPointTo(): Promise<RStatus>;
  rOpenLibrary(): Promise<OkResult>;

  getSettings(): Promise<AppSettings>;
  setSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  openUserData(): Promise<OkResult>;
  clearIconCache(): Promise<OkResult>;

  credStatus(): Promise<CredentialStatus>;
  credSet(token: string): Promise<CredentialStatus>;
  credRemove(): Promise<CredentialStatus>;
  credTest(): Promise<TokenTestResult>;

  appInfo(): Promise<AppInfo>;
  openExternal(url: string): Promise<OkResult>;
  selectApp(id: string | null): void;

  onLog(handler: (e: LogEvent) => void): () => void;
  onStatus(handler: (s: AppStatus[]) => void): () => void;
  onMenu(handler: (cmd: MenuCommand) => void): () => void;
}

declare global {
  interface Window {
    shinylaunchR: ShinyLaunchAPI;
  }
}
