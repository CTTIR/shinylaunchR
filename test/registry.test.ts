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

  it('ignores the retired frameless field in legacy input and persisted entries', () => {
    const legacy = { ...cranInput, frameless: true };
    expect(validateInput(legacy)).not.toHaveProperty('frameless');
    const registry = new Registry(file);
    const added = registry.add(legacy);
    const persisted = JSON.parse(fs.readFileSync(file, 'utf8'));
    persisted.apps[0].frameless = true;
    fs.writeFileSync(file, JSON.stringify(persisted));
    expect(new Registry(file).get(added.id)).not.toHaveProperty('frameless');
  });
  it('rejects an invalid package name', () => {
    expect(() => validateInput({ ...cranInput, pkg: '1bad; rm -rf' })).toThrow(
      RegistryError,
    );
  });

  it('rejects an invalid function name', () => {
    expect(() => validateInput({ ...cranInput, fun: 'do$omething' })).toThrow(
      RegistryError,
    );
  });

  it('rejects a malformed github repo', () => {
    expect(() =>
      validateInput({
        ...cranInput,
        source: { kind: 'github', repo: 'not-a-repo' },
      }),
    ).toThrow(RegistryError);
  });

  it('accepts org/repo@ref', () => {
    expect(() =>
      validateInput({
        ...cranInput,
        source: { kind: 'github', repo: 'cttir/molpathR@dev' },
      }),
    ).not.toThrow();
  });

  it('rejects an out-of-range fixed port', () => {
    expect(() => validateInput({ ...cranInput, fixedPort: 99999 })).toThrow(
      RegistryError,
    );
  });
});

describe('validateInput — non-package families', () => {
  it('accepts a hosted https URL with no pkg/fun', () => {
    const v = validateInput({
      name: 'Hosted',
      source: { kind: 'url', url: 'https://x.shinyapps.io/a/' },
    });
    expect(v.pkg).toBeUndefined();
    expect(v.fun).toBeUndefined();
    expect(v.source).toEqual({ kind: 'url', url: 'https://x.shinyapps.io/a/' });
  });

  it('rejects a non-https URL', () => {
    expect(() =>
      validateInput({
        name: 'Hosted',
        source: { kind: 'url', url: 'http://insecure/' },
      }),
    ).toThrow(RegistryError);
  });

  it('accepts an uploaded-zip source app', () => {
    expect(() =>
      validateInput({
        name: 'Zipped',
        source: {
          kind: 'source',
          origin: { from: 'zip', filePath: path.join(dir, 'app.zip') },
        },
      }),
    ).not.toThrow();
  });

  it('accepts a local-folder source app with a safe appDir', () => {
    expect(() =>
      validateInput({
        name: 'Local',
        source: {
          kind: 'source',
          origin: { from: 'local', path: path.join(dir, 'app') },
          appDir: 'inst/shiny',
        },
      }),
    ).not.toThrow();
  });

  it('rejects a traversal appDir', () => {
    expect(() =>
      validateInput({
        name: 'Bad',
        source: {
          kind: 'source',
          origin: { from: 'local', path: path.join(dir, 'app') },
          appDir: '../etc',
        },
      }),
    ).toThrow(RegistryError);
  });

  it('rejects a zip source with neither url nor filePath', () => {
    expect(() =>
      validateInput({
        name: 'Bad',
        source: { kind: 'source', origin: { from: 'zip' } },
      }),
    ).toThrow(RegistryError);
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

  it('imports portable specs with fresh IDs and reset state', () => {
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
    expect(reg.list()).toHaveLength(3);
    expect(reg.get(e.id)?.name).toBe('Demo');
    expect(
      reg
        .list()
        .slice(1)
        .every((a) => !a.installed && a.id !== e.id),
    ).toBe(true);
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

  it('backs up the entire malformed registry visibly', () => {
    const payload = {
      version: 1,
      apps: [
        {
          id: 'ok',
          name: 'Good',
          pkg: 'goodpkg',
          fun: 'run',
          source: { kind: 'cran' },
          installed: false,
          createdAt: 'x',
        },
        {
          id: 'bad',
          name: 'Bad',
          pkg: '9!!',
          fun: 'run',
          source: { kind: 'cran' },
        },
      ],
    };
    fs.writeFileSync(file, JSON.stringify(payload));
    const reg = new Registry(file);
    expect(reg.list()).toHaveLength(0);
    expect(fs.readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true);
  });

  it('migrates: existing cran/github entries (with pkg+fun) keep loading; url/source need none', () => {
    const payload = {
      version: 1,
      apps: [
        {
          id: '12345678-1234-1234-1234-123456789ab0',
          name: 'Pkg',
          pkg: 'molpathR',
          fun: 'mp_run_app',
          source: { kind: 'cran' },
          installed: true,
          createdAt: 'x',
        },
        {
          id: '12345678-1234-1234-1234-123456789ab1',
          name: 'Url',
          source: { kind: 'url', url: 'https://x.io/a/' },
          installed: true,
          createdAt: 'x',
        },
        {
          id: '12345678-1234-1234-1234-123456789ab2',
          name: 'Src',
          source: {
            kind: 'source',
            origin: { from: 'zip', filePath: path.join(dir, 'a.zip') },
          },
          installed: false,
          createdAt: 'x',
        },
      ],
    };
    fs.writeFileSync(file, JSON.stringify(payload));
    const reg = new Registry(file);
    expect(reg.list()).toHaveLength(3);
    expect(reg.get('12345678-1234-1234-1234-123456789ab0')?.pkg).toBe(
      'molpathR',
    );
    expect(reg.get('12345678-1234-1234-1234-123456789ab1')?.source.kind).toBe(
      'url',
    );
    expect(reg.get('12345678-1234-1234-1234-123456789ab2')?.source.kind).toBe(
      'source',
    );
  });
});

it('rejects malformed imports atomically and never trusts imported machine paths', () => {
  const reg = new Registry(file);
  const original = reg.add(cranInput);
  expect(() => reg.importFrom([cranInput, { name: 'broken' }])).toThrow(
    /entry 2/,
  );
  expect(reg.list()).toHaveLength(1);
  reg.importFrom([
    {
      ...original,
      id: '../escape',
      installed: true,
      stagedPath: '/outside',
      iconPath: '/outside',
    },
  ]);
  const imported = reg.list()[1]!;
  expect(imported.id).not.toBe('../escape');
  expect(imported.installed).toBe(false);
  expect(imported.stagedPath).toBeUndefined();
  expect(imported.iconPath).toBeUndefined();
});
it('execution edits invalidate installed state and detached reads cannot mutate source', () => {
  const reg = new Registry(file);
  const original = reg.add(cranInput);
  reg.patch(original.id, { installed: true, stagedPath: path.join(dir, 'old') });
  const edited = reg.update(original.id, { ...cranInput, fun: 'different' });
  expect(edited.installed).toBe(false);
  expect(edited.stagedPath).toBeUndefined();
  const fetched = reg.get(original.id)!;
  fetched.source.kind = 'github';
  expect(reg.get(original.id)?.source.kind).toBe('cran');
});

it('rejects embedded URL credentials before they can be persisted or included in errors', () => {
  const registry = new Registry(file);
  for (const source of [
    { kind: 'url', url: 'https://user:private-value@example.org' },
    {
      kind: 'source',
      origin: {
        from: 'zip',
        url: 'https://user:private-value@example.org/app.zip',
      },
    },
  ] as const) {
    expect(() => registry.add({ name: 'Invalid', source })).toThrow(
      /without embedded credentials/,
    );
    try {
      registry.add({ name: 'Invalid', source });
    } catch (error) {
      expect(String(error)).not.toContain('private-value');
    }
  }
  expect(registry.list()).toEqual([]);
});
