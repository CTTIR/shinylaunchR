/**
 * Persisted application settings (theme, defaults, sources). Electron-free;
 * initialised with a directory by main.ts. Reads are tolerant of a missing or
 * corrupt file — defaults are returned and the file is rewritten on next save.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types';
import { logger } from './logger';

let filePath: string | null = null;
let cache: AppSettings = { ...DEFAULT_SETTINGS };

function coerce(raw: unknown): AppSettings {
  const merged: AppSettings = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
      const value = r[key];
      if (value !== undefined && typeof value === typeof DEFAULT_SETTINGS[key]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (merged as any)[key] = value;
      }
    }
  }
  // sanity clamps
  if (!['dark', 'light', 'system'].includes(merged.theme)) merged.theme = 'system';
  if (!['auto', 'range'].includes(merged.portBehavior)) merged.portBehavior = 'auto';
  merged.defaultWindowWidth = Math.max(400, Math.min(4000, merged.defaultWindowWidth));
  merged.defaultWindowHeight = Math.max(300, Math.min(4000, merged.defaultWindowHeight));
  return merged;
}

export function initSettings(userDataDir: string): AppSettings {
  filePath = path.join(userDataDir, 'settings.json');
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      cache = coerce(parsed);
    } else {
      cache = { ...DEFAULT_SETTINGS };
      persist();
    }
  } catch (err) {
    logger.warn('settings', `Could not read settings, using defaults: ${String(err)}`);
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

function persist(): void {
  if (!filePath) return;
  try {
    fs.writeFileSync(filePath, JSON.stringify(cache, null, 2), 'utf-8');
  } catch (err) {
    logger.error('settings', `Could not write settings: ${String(err)}`);
  }
}

export function getSettings(): AppSettings {
  return { ...cache };
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  cache = coerce({ ...cache, ...patch });
  persist();
  return getSettings();
}
