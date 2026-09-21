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
    expect(() =>
      setSettings({ defaultWindowWidth: 99999, defaultWindowHeight: 1 }),
    ).toThrow();
  });

  it('repairs an invalid CRAN mirror back to the default', () => {
    initSettings(dir);
    expect(() =>
      setSettings({ cranMirror: 'not a url; system("x")' }),
    ).toThrow();
  });

  it('rejects a non-http mirror', () => {
    initSettings(dir);
    expect(() => setSettings({ cranMirror: 'file:///etc/passwd' })).toThrow();
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

it('rejects reversed, nonfinite, fractional and out-of-range ports without saving', () => {
  initSettings(dir);
  for (const patch of [
    { portRangeStart: 9000, portRangeEnd: 8000 },
    { portRangeStart: NaN },
    { portRangeEnd: Infinity },
    { portRangeStart: 1.5 },
    { portRangeEnd: 65536 },
  ]) {
    expect(() => setSettings(patch)).toThrow();
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
  }
});
it('rejects HTTP and URL credentials before persisting CRAN settings', () => {
  initSettings(dir);
  for (const cranMirror of [
    'http://cran.example.org',
    'https://user:password@cran.example.org',
    'https://cran.example.org\n',
  ]) {
    expect(() => setSettings({ cranMirror })).toThrow(/CRAN mirror/);
    expect(getSettings().cranMirror).toBe(DEFAULT_SETTINGS.cranMirror);
  }
});
