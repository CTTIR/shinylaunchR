/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Persisted application settings (theme, defaults, sources). Electron-free;
 * initialised with a directory by main.ts. Reads are tolerant of a missing or
 * corrupt file — defaults are returned and the file is rewritten on next save.
 */
import { readAtomicJson, writeAtomicJson } from './atomic-store';
import path from 'node:path';
import { DEFAULT_SETTINGS, type AppSettings } from '@shared/types';

let filePath: string | null = null;
let cache: AppSettings = { ...DEFAULT_SETTINGS };

function coerce(raw: unknown): AppSettings {
  const merged: AppSettings = { ...DEFAULT_SETTINGS };
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
      const value = r[key];
      if (
        value !== undefined &&
        typeof value === typeof DEFAULT_SETTINGS[key]
      ) {
        (merged as any)[key] = value;
      }
    }
  }
  for (const key of [
    'defaultWindowWidth',
    'defaultWindowHeight',
    'portRangeStart',
    'portRangeEnd',
  ] as const) {
    if (!Number.isInteger(merged[key])) merged[key] = DEFAULT_SETTINGS[key];
  }
  if (
    merged.portRangeStart < 1 ||
    merged.portRangeEnd > 65535 ||
    merged.portRangeStart > merged.portRangeEnd
  ) {
    merged.portRangeStart = DEFAULT_SETTINGS.portRangeStart;
    merged.portRangeEnd = DEFAULT_SETTINGS.portRangeEnd;
  }
  // sanity clamps
  if (!['dark', 'light', 'system'].includes(merged.theme))
    merged.theme = 'system';
  if (!['auto', 'range'].includes(merged.portBehavior))
    merged.portBehavior = 'auto';
  merged.defaultWindowWidth = Math.max(
    400,
    Math.min(4000, merged.defaultWindowWidth),
  );
  merged.defaultWindowHeight = Math.max(
    300,
    Math.min(4000, merged.defaultWindowHeight),
  );
  // Match the installer policy: HTTPS without embedded credentials or controls.
  try {
    const u = new URL(merged.cranMirror);
    if (
      u.protocol !== 'https:' ||
      !!u.username ||
      !!u.password ||
      /["\\\n\r]/.test(merged.cranMirror)
    ) {
      throw new Error('bad mirror');
    }
  } catch {
    merged.cranMirror = DEFAULT_SETTINGS.cranMirror;
  }
  return merged;
}

export function initSettings(userDataDir: string): AppSettings {
  filePath = path.join(userDataDir, 'settings.json');
  cache = readAtomicJson(filePath, coerce, () => ({ ...DEFAULT_SETTINGS }));
  persist();
  return cache;
}

function persist(): void {
  if (!filePath) return;
  writeAtomicJson(filePath, cache);
}

export function getSettings(): AppSettings {
  return { ...cache };
}

export function setSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...cache, ...patch };
  for (const [key, min, max] of [
    ['defaultWindowWidth', 400, 4000],
    ['defaultWindowHeight', 300, 4000],
    ['portRangeStart', 1, 65535],
    ['portRangeEnd', 1, 65535],
  ] as const) {
    if (!Number.isInteger(next[key]) || next[key] < min || next[key] > max)
      throw new Error(`Invalid ${key}`);
  }
  if (next.portRangeStart > next.portRangeEnd)
    throw new Error('Port range start must not exceed end');
  if (
    !['dark', 'light', 'system'].includes(next.theme) ||
    !['auto', 'range'].includes(next.portBehavior)
  )
    throw new Error('Invalid settings choice');
  if (
    typeof next.preferPak !== 'boolean' ||
    typeof next.startupLaunchLast !== 'boolean'
  )
    throw new Error('Invalid boolean setting');
  const clean = coerce(next);
  if (clean.cranMirror !== next.cranMirror)
    throw new Error('Invalid CRAN mirror');
  const previous = cache;
  cache = clean;
  try {
    persist();
  } catch (err) {
    cache = previous;
    throw err;
  }
  return getSettings();
}
