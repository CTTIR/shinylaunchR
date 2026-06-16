import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_SETTINGS } from '@shared/types';
import { getSettings, initSettings, setSettings } from '../src/main/settings';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-set-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('settings', () => {
  it('creates a defaults file on first init', () => {
    const s = initSettings(dir);
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(fs.existsSync(path.join(dir, 'settings.json'))).toBe(true);
  });

  it('persists and reloads a patch', () => {
    initSettings(dir);
    setSettings({ theme: 'light', defaultWindowWidth: 1234 });
    initSettings(dir); // reload from disk
    const s = getSettings();
    expect(s.theme).toBe('light');
    expect(s.defaultWindowWidth).toBe(1234);
  });

  it('clamps window dimensions to sane bounds', () => {
    initSettings(dir);
    const s = setSettings({ defaultWindowWidth: 99999, defaultWindowHeight: 1 });
    expect(s.defaultWindowWidth).toBeLessThanOrEqual(4000);
    expect(s.defaultWindowHeight).toBeGreaterThanOrEqual(300);
  });

  it('repairs an invalid CRAN mirror back to the default', () => {
    initSettings(dir);
    const s = setSettings({ cranMirror: 'not a url; system("x")' });
    expect(s.cranMirror).toBe(DEFAULT_SETTINGS.cranMirror);
  });

  it('rejects a non-http mirror', () => {
    initSettings(dir);
    const s = setSettings({ cranMirror: 'file:///etc/passwd' });
    expect(s.cranMirror).toBe(DEFAULT_SETTINGS.cranMirror);
  });

  it('falls back to defaults on a corrupt file', () => {
    fs.writeFileSync(path.join(dir, 'settings.json'), '{ not json');
    const s = initSettings(dir);
    expect(s).toEqual(DEFAULT_SETTINGS);
  });

  it('ignores unknown keys and wrong-typed values', () => {
    fs.writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({ theme: 123, bogus: true, preferPak: false }),
    );
    const s = initSettings(dir);
    expect(s.theme).toBe('system'); // wrong type → default
    expect(s.preferPak).toBe(false); // valid override kept
    expect((s as unknown as Record<string, unknown>).bogus).toBeUndefined();
  });
});
