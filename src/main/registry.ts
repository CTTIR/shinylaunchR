/**
 * Persisted app registry (CRUD + schema validation + corrupt-file recovery).
 *
 * Electron-free and constructed with an explicit file path so it can be unit
 * tested against a temp directory. A corrupt registry is backed up (never
 * silently dropped) and reset to an empty, valid file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  isValidName,
  isValidRepo,
  type AppEntry,
  type AppEntryInput,
  type AppSource,
  type RegistryFile,
} from '@shared/types';

export class RegistryError extends Error {}

function nowIso(): string {
  return new Date().toISOString();
}

function validateSource(source: unknown): AppSource {
  if (!source || typeof source !== 'object') throw new RegistryError('source is required');
  const s = source as Record<string, unknown>;
  if (s.kind === 'cran') return { kind: 'cran' };
  if (s.kind === 'github') {
    if (typeof s.repo !== 'string' || !isValidRepo(s.repo)) {
      throw new RegistryError(`invalid GitHub repo: ${String(s.repo)}`);
    }
    return { kind: 'github', repo: s.repo };
  }
  throw new RegistryError(`invalid source kind: ${String(s.kind)}`);
}

/** Validate user-supplied input and normalise it. Throws RegistryError. */
export function validateInput(input: AppEntryInput): AppEntryInput {
  if (!input || typeof input !== 'object') throw new RegistryError('input required');
  const name = String(input.name ?? '').trim();
  if (!name) throw new RegistryError('name is required');
  if (!isValidName(String(input.pkg ?? ''))) {
    throw new RegistryError(`invalid package name: ${String(input.pkg)}`);
  }
  if (!isValidName(String(input.fun ?? ''))) {
    throw new RegistryError(`invalid launcher function: ${String(input.fun)}`);
  }
  const source = validateSource(input.source);
  let fixedPort: number | undefined;
  if (input.fixedPort !== undefined && input.fixedPort !== null) {
    const p = Number(input.fixedPort);
    if (!Number.isInteger(p) || p < 1 || p > 65535) {
      throw new RegistryError(`invalid fixed port: ${String(input.fixedPort)}`);
    }
    fixedPort = p;
  }
  return {
    name,
    pkg: input.pkg,
    fun: input.fun,
    source,
    iconPath: input.iconPath ? String(input.iconPath) : undefined,
    fixedPort,
    frameless: Boolean(input.frameless),
  };
}

function isAppEntry(value: unknown): value is AppEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  if (typeof e.id !== 'string' || typeof e.name !== 'string') return false;
  if (typeof e.pkg !== 'string' || !isValidName(e.pkg)) return false;
  if (typeof e.fun !== 'string' || !isValidName(e.fun)) return false;
  try {
    validateSource(e.source);
  } catch {
    return false;
  }
  return true;
}

export class Registry {
  private apps: AppEntry[] = [];

  constructor(private readonly filePath: string) {
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.filePath)) {
      this.apps = [];
      this.persist();
      return;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as RegistryFile;
      if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.apps)) {
        throw new RegistryError('schema mismatch');
      }
      this.apps = parsed.apps.filter(isAppEntry);
    } catch {
      this.backupCorrupt();
      this.apps = [];
      this.persist();
    }
  }

  private backupCorrupt(): void {
    try {
      const backup = `${this.filePath}.corrupt-${Date.now()}.bak`;
      fs.copyFileSync(this.filePath, backup);
    } catch {
      // best effort
    }
  }

  private persist(): void {
    const data: RegistryFile = { version: 1, apps: this.apps };
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  list(): AppEntry[] {
    return this.apps.map((a) => ({ ...a }));
  }

  get(id: string): AppEntry | undefined {
    const found = this.apps.find((a) => a.id === id);
    return found ? { ...found } : undefined;
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
      frameless: v.frameless,
      installed: false,
      createdAt: nowIso(),
    };
    this.apps.push(entry);
    this.persist();
    return { ...entry };
  }

  update(id: string, input: AppEntryInput): AppEntry {
    const idx = this.apps.findIndex((a) => a.id === id);
    if (idx < 0) throw new RegistryError(`unknown app: ${id}`);
    const v = validateInput(input);
    const prev = this.apps[idx];
    const next: AppEntry = {
      ...prev,
      name: v.name,
      pkg: v.pkg,
      fun: v.fun,
      source: v.source,
      iconPath: v.iconPath ?? prev.iconPath,
      fixedPort: v.fixedPort,
      frameless: v.frameless,
    };
    this.apps[idx] = next;
    this.persist();
    return { ...next };
  }

  /** Partial patch for server-managed fields (installed flag, timestamps, icon). */
  patch(id: string, patch: Partial<AppEntry>): AppEntry | undefined {
    const idx = this.apps.findIndex((a) => a.id === id);
    if (idx < 0) return undefined;
    this.apps[idx] = { ...this.apps[idx], ...patch, id };
    this.persist();
    return { ...this.apps[idx] };
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
    if (payload && typeof payload === 'object' && Array.isArray((payload as RegistryFile).apps)) {
      incoming = (payload as RegistryFile).apps;
    } else if (Array.isArray(payload)) {
      incoming = payload;
    } else {
      throw new RegistryError('import payload is not a registry');
    }
    const valid = incoming.filter(isAppEntry) as AppEntry[];
    // Merge by id, preferring incoming.
    const byId = new Map(this.apps.map((a) => [a.id, a]));
    for (const a of valid) byId.set(a.id, a);
    this.apps = [...byId.values()];
    this.persist();
    return valid.length;
  }

  exportData(): RegistryFile {
    return { version: 1, apps: this.list() };
  }
}
