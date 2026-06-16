import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Registry, RegistryError, validateInput } from '../src/main/registry';
import type { AppEntryInput } from '@shared/types';

let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-reg-'));
  file = path.join(dir, 'registry.json');
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const cranInput: AppEntryInput = {
  name: 'Demo',
  pkg: 'molpathR',
  fun: 'mp_run_app',
  source: { kind: 'cran' },
};

describe('validateInput', () => {
  it('accepts a valid CRAN entry', () => {
    expect(() => validateInput(cranInput)).not.toThrow();
  });

  it('rejects an invalid package name', () => {
    expect(() => validateInput({ ...cranInput, pkg: '1bad; rm -rf' })).toThrow(RegistryError);
  });

  it('rejects an invalid function name', () => {
    expect(() => validateInput({ ...cranInput, fun: 'do$omething' })).toThrow(RegistryError);
  });

  it('rejects a malformed github repo', () => {
    expect(() =>
      validateInput({ ...cranInput, source: { kind: 'github', repo: 'not-a-repo' } }),
    ).toThrow(RegistryError);
  });

  it('accepts org/repo@ref', () => {
    expect(() =>
      validateInput({ ...cranInput, source: { kind: 'github', repo: 'cttir/molpathR@dev' } }),
    ).not.toThrow();
  });

  it('rejects an out-of-range fixed port', () => {
    expect(() => validateInput({ ...cranInput, fixedPort: 99999 })).toThrow(RegistryError);
  });
});

describe('Registry CRUD', () => {
  it('creates the file and round-trips an add', () => {
    const reg = new Registry(file);
    expect(reg.list()).toHaveLength(0);
    const e = reg.add(cranInput);
    expect(e.id).toBeTruthy();
    expect(e.installed).toBe(false);

    const reloaded = new Registry(file);
    expect(reloaded.list()).toHaveLength(1);
    expect(reloaded.get(e.id)?.pkg).toBe('molpathR');
  });

  it('updates and patches entries', () => {
    const reg = new Registry(file);
    const e = reg.add(cranInput);
    const updated = reg.update(e.id, { ...cranInput, name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    const patched = reg.patch(e.id, { installed: true });
    expect(patched?.installed).toBe(true);
  });

  it('removes entries', () => {
    const reg = new Registry(file);
    const e = reg.add(cranInput);
    expect(reg.remove(e.id)).toBe(true);
    expect(reg.remove(e.id)).toBe(false);
    expect(reg.list()).toHaveLength(0);
  });

  it('imports a registry payload, merging by id', () => {
    const reg = new Registry(file);
    const e = reg.add(cranInput);
    const payload = {
      version: 1,
      apps: [
        { ...e, name: 'Imported' },
        {
          id: 'xyz',
          name: 'Second',
          pkg: 'phenoscapR',
          fun: 'run_app',
          source: { kind: 'cran' },
          installed: true,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    const n = reg.importFrom(payload);
    expect(n).toBe(2);
    expect(reg.list()).toHaveLength(2);
    expect(reg.get(e.id)?.name).toBe('Imported');
  });
});

describe('corrupt-file recovery', () => {
  it('backs up a corrupt file and resets to empty', () => {
    fs.writeFileSync(file, '{ this is not json ');
    const reg = new Registry(file);
    expect(reg.list()).toHaveLength(0);
    const backups = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
    expect(backups.length).toBe(1);
  });

  it('drops entries that fail schema validation', () => {
    const payload = {
      version: 1,
      apps: [
        { id: 'ok', name: 'Good', pkg: 'goodpkg', fun: 'run', source: { kind: 'cran' }, installed: false, createdAt: 'x' },
        { id: 'bad', name: 'Bad', pkg: '9!!', fun: 'run', source: { kind: 'cran' } },
      ],
    };
    fs.writeFileSync(file, JSON.stringify(payload));
    const reg = new Registry(file);
    expect(reg.list()).toHaveLength(1);
    expect(reg.get('ok')).toBeTruthy();
  });
});
