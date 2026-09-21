/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Persisted app registry (CRUD + schema validation + corrupt-file recovery).
 *
 * Electron-free and constructed with an explicit file path so it can be unit
 * tested against a temp directory. A corrupt registry is backed up (never
 * silently dropped) and reset to an empty, valid file.
 */
import { readAtomicJson, writeAtomicJson } from './atomic-store';
import { assertAppId } from './safe-path';
import { randomUUID } from 'node:crypto';
import {
  appFamily,
  isValidGist,
  isValidHttpsUrl,
  isValidName,
  isValidPkg,
  isValidRepo,
  isSafeRelPath,
  type AppEntry,
  type AppEntryInput,
  type AppSource,
  type RegistryFile,
  type SourceOrigin,
} from '@shared/types';

function withoutRetiredFields(entry: AppEntry): AppEntry {
  const clean = { ...entry } as AppEntry & { frameless?: unknown };
  delete clean.frameless;
  return clean;
}

export class RegistryError extends Error {}

function nowIso(): string {
  return new Date().toISOString();
}

/** A non-empty trimmed string, or throw. Used for trusted (picker-chosen) paths. */
function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string')
    throw new RegistryError(`${label} must be text`);
  const s = value.trim();
  if (!s) throw new RegistryError(`${label} is required`);
  return s;
}

function validateOrigin(origin: unknown): SourceOrigin {
  if (!origin || typeof origin !== 'object')
    throw new RegistryError('source origin is required');
  const o = origin as Record<string, unknown>;
  switch (o.from) {
    case 'github': {
      if (typeof o.repo !== 'string' || !isValidRepo(o.repo)) {
        throw new RegistryError(
          `invalid GitHub source repo: ${String(o.repo)}`,
        );
      }
      if (
        o.subdir !== undefined &&
        o.subdir !== null &&
        !isSafeRelPath(String(o.subdir))
      ) {
        throw new RegistryError(`invalid subdir: ${String(o.subdir)}`);
      }
      const subdir = o.subdir ? String(o.subdir) : undefined;
      return subdir
        ? { from: 'github', repo: o.repo, subdir }
        : { from: 'github', repo: o.repo };
    }
    case 'zip': {
      const hasUrl = o.url !== undefined && o.url !== null && o.url !== '';
      const hasFile =
        o.filePath !== undefined && o.filePath !== null && o.filePath !== '';
      if (!hasUrl && !hasFile)
        throw new RegistryError('zip needs a url or filePath');
      const url = hasUrl ? requireHttps(o.url) : undefined;
      const filePath = hasFile
        ? requireNonEmpty(o.filePath, 'zip filePath')
        : undefined;
      return url ? { from: 'zip', url } : { from: 'zip', filePath: filePath! };
    }
    case 'gist': {
      if (typeof o.id !== 'string' || !isValidGist(o.id)) {
        throw new RegistryError(`invalid gist id: ${String(o.id)}`);
      }
      return { from: 'gist', id: o.id };
    }
    case 'local': {
      return { from: 'local', path: requireNonEmpty(o.path, 'local path') };
    }
    default:
      throw new RegistryError(`invalid source origin: ${String(o.from)}`);
  }
}

function requireHttps(value: unknown): string {
  const s = String(value ?? '');
  if (!isValidHttpsUrl(s))
    throw new RegistryError(
      'Must be an HTTPS URL without embedded credentials.',
    );
  return s;
}

function validateSource(source: unknown): AppSource {
  if (!source || typeof source !== 'object')
    throw new RegistryError('source is required');
  const s = source as Record<string, unknown>;
  switch (s.kind) {
    case 'cran':
      return { kind: 'cran' };
    case 'github':
      if (typeof s.repo !== 'string' || !isValidRepo(s.repo)) {
        throw new RegistryError(`invalid GitHub repo: ${String(s.repo)}`);
      }
      return { kind: 'github', repo: s.repo };
    case 'url':
      return { kind: 'url', url: requireHttps(s.url) };
    case 'source': {
      const origin = validateOrigin(s.origin);
      if (
        s.appDir !== undefined &&
        s.appDir !== null &&
        !isSafeRelPath(String(s.appDir))
      ) {
        throw new RegistryError(`invalid appDir: ${String(s.appDir)}`);
      }
      const appDir = s.appDir ? String(s.appDir) : undefined;
      return appDir
        ? { kind: 'source', origin, appDir }
        : { kind: 'source', origin };
    }
    default:
      throw new RegistryError(`invalid source kind: ${String(s.kind)}`);
  }
}

/** Validate user-supplied input and normalise it. Throws RegistryError. */
export function validateInput(input: AppEntryInput): AppEntryInput {
  if (!input || typeof input !== 'object')
    throw new RegistryError('input required');
  if (typeof input.name !== 'string')
    throw new RegistryError('name must be text');
  if (input.iconPath !== undefined && typeof input.iconPath !== 'string')
    throw new RegistryError('iconPath must be text');
  const name = input.name.trim();
  if (!name) throw new RegistryError('name is required');
  const source = validateSource(input.source);
  // pkg/fun are meaningful (and required) only for the PACKAGE family.
  let pkg: string | undefined;
  let fun: string | undefined;
  if (appFamily(source) === 'package') {
    if (!isValidPkg(String(input.pkg ?? ''))) {
      throw new RegistryError(`invalid package name: ${String(input.pkg)}`);
    }
    if (!isValidName(String(input.fun ?? ''))) {
      throw new RegistryError(
        `invalid launcher function: ${String(input.fun)}`,
      );
    }
    pkg = input.pkg;
    fun = input.fun;
  }
  let fixedPort: number | undefined;
  if (input.fixedPort !== undefined && input.fixedPort !== null) {
    const p = input.fixedPort;
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      throw new RegistryError(`invalid fixed port: ${String(input.fixedPort)}`);
    }
    fixedPort = p;
  }
  return {
    name,
    pkg,
    fun,
    source,
    iconPath: input.iconPath ? String(input.iconPath) : undefined,
    fixedPort,
  };
}

function isAppEntry(value: unknown): value is AppEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  if (
    typeof e.id !== 'string' ||
    typeof e.name !== 'string' ||
    typeof e.installed !== 'boolean' ||
    typeof e.createdAt !== 'string'
  )
    return false;
  try {
    assertAppId(e.id);
    validateInput(value as AppEntryInput);
  } catch {
    return false;
  }
  let source: AppSource;
  try {
    source = validateSource(e.source);
  } catch {
    return false;
  }
  // pkg/fun are required only for the PACKAGE family; existing cran/github
  // entries (which always carried pkg+fun) keep validating and map to PACKAGE.
  if (appFamily(source) === 'package') {
    if (typeof e.pkg !== 'string' || !isValidPkg(e.pkg)) return false;
    if (typeof e.fun !== 'string' || !isValidName(e.fun)) return false;
  }
  return true;
}

export class Registry {
  private apps: AppEntry[] = [];

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    this.apps = readAtomicJson(
      this.filePath,
      (raw) => {
        const parsed = raw as RegistryFile;
        if (
          !parsed ||
          parsed.version !== 1 ||
          !Array.isArray(parsed.apps) ||
          !parsed.apps.every(isAppEntry) ||
          new Set(parsed.apps.map((a) => a.id)).size !== parsed.apps.length
        ) {
          throw new RegistryError('Invalid registry schema');
        }
        return parsed.apps.map(withoutRetiredFields);
      },
      () => [],
    );
    this.persist();
  }

  private persist(): void {
    try {
      writeAtomicJson(this.filePath, { version: 1, apps: this.apps });
    } catch (err) {
      this.apps = readAtomicJson(
        this.filePath,
        (raw) => {
          const data = raw as RegistryFile;
          if (!Array.isArray(data.apps) || !data.apps.every(isAppEntry))
            throw new RegistryError('Invalid recovery state');
          return data.apps.map(withoutRetiredFields);
        },
        () => [],
      );
      throw err;
    }
  }

  list(): AppEntry[] {
    return this.apps.map((a) => structuredClone(a));
  }

  get(id: string): AppEntry | undefined {
    const found = this.apps.find((a) => a.id === id);
    return found ? structuredClone(found) : undefined;
  }

  add(input: AppEntryInput): AppEntry {
    const v = validateInput(input);
    const entry: AppEntry = {
      id: randomUUID(),
      name: v.name,
      pkg: v.pkg,
      fun: v.fun,
      source: v.source,
      iconPath: v.iconPath,
      fixedPort: v.fixedPort,
      installed: false,
      createdAt: nowIso(),
    };
    this.apps.push(entry);
    this.persist();
    return structuredClone(entry);
  }

  update(id: string, input: AppEntryInput): AppEntry {
    const idx = this.apps.findIndex((a) => a.id === id);
    const prev = this.apps[idx];
    if (idx < 0 || !prev) throw new RegistryError(`unknown app: ${id}`);
    const v = validateInput(input);
    const next: AppEntry = {
      ...prev,
      name: v.name,
      pkg: v.pkg,
      fun: v.fun,
      source: v.source,
      iconPath: v.iconPath,
      fixedPort: v.fixedPort,
    };
    if (
      JSON.stringify(prev.source) !== JSON.stringify(next.source) ||
      prev.pkg !== next.pkg ||
      prev.fun !== next.fun
    ) {
      next.installed = false;
      next.stagedPath = undefined;
      next.libraryPath = undefined;
    }
    this.apps[idx] = next;
    this.persist();
    return structuredClone(next);
  }

  /** Partial patch for server-managed fields (installed flag, timestamps, icon). */
  patch(id: string, patch: Partial<AppEntry>): AppEntry | undefined {
    const idx = this.apps.findIndex((a) => a.id === id);
    const prev = this.apps[idx];
    if (idx < 0 || !prev) return undefined;
    const next: AppEntry = { ...prev, ...patch, id };
    if (
      JSON.stringify(prev.source) !== JSON.stringify(next.source) ||
      prev.pkg !== next.pkg ||
      prev.fun !== next.fun
    ) {
      next.installed = false;
      next.stagedPath = undefined;
      next.libraryPath = undefined;
    }
    this.apps[idx] = next;
    this.persist();
    return structuredClone(next);
  }

  remove(id: string): boolean {
    const before = this.apps.length;
    this.apps = this.apps.filter((a) => a.id !== id);
    const changed = this.apps.length !== before;
    if (changed) this.persist();
    return changed;
  }

  /** Replace the whole set from an imported file payload. Returns count imported. */
  importFrom(payload: unknown): number {
    let incoming: unknown[];
    if (
      payload &&
      typeof payload === 'object' &&
      Array.isArray((payload as RegistryFile).apps)
    ) {
      incoming = (payload as RegistryFile).apps;
    } else if (Array.isArray(payload)) {
      incoming = payload;
    } else {
      throw new RegistryError('import payload is not a registry');
    }
    const valid = incoming.map((raw, index) => {
      try {
        const spec = validateInput(raw as AppEntryInput);
        return {
          ...spec,
          iconPath: undefined,
          id: randomUUID(),
          installed: false,
          createdAt: nowIso(),
        };
      } catch (err) {
        throw new RegistryError(
          `Invalid imported entry ${index + 1}: ${String(err)}`,
        );
      }
    });
    this.apps.push(...valid);
    this.persist();
    return valid.length;
  }

  exportData(): RegistryFile {
    return { version: 1, apps: this.list() };
  }
}
