import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readAtomicJson, writeAtomicJson } from '../src/main/atomic-store';
import { assertInside } from '../src/main/safe-path';
let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-test-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});
it('preserves last good JSON and recovers after corruption', () => {
  const file = path.join(dir, 'state.json');
  writeAtomicJson(file, { version: 1 });
  writeAtomicJson(file, { version: 2 });
  fs.writeFileSync(file, '{bad');
  expect(
    readAtomicJson(
      file,
      (value) => value,
      () => null,
    ),
  ).toEqual({ version: 1 });
  expect(fs.readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true);
});
it('rename failure leaves original readable and no partial temporary file', () => {
  const file = path.join(dir, 'state.json');
  writeAtomicJson(file, { old: true });
  vi.spyOn(fs, 'renameSync').mockImplementation(() => {
    throw new Error('disk failure');
  });
  expect(() => writeAtomicJson(file, { old: false })).toThrow('disk failure');
  expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ old: true });
  expect(fs.readdirSync(dir).some((f) => f.endsWith('.tmp'))).toBe(false);
});
it('rejects traversal and symlink parents, leaves the linked file untouched', () => {
  const outside = path.join(dir, 'outside');
  fs.mkdirSync(outside);
  const root = path.join(dir, 'root');
  fs.mkdirSync(root);
  fs.symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  expect(() => assertInside(root, path.join(root, '../outside'))).toThrow();
  expect(() =>
    writeAtomicJson(path.join(root, 'linked', 'state.json'), {}),
  ).toThrow(/Symlink/);
  expect(fs.readdirSync(outside)).toEqual([]);
});
it('does not overwrite valid recovery state with schema-invalid JSON', () => {
  const file = path.join(dir, 'state.json');
  writeAtomicJson(file, { good: true });
  writeAtomicJson(file, { good: true });
  fs.writeFileSync(file, JSON.stringify({ malformed: true }));
  const recovered = readAtomicJson(
    file,
    (raw) => {
      if (!(raw as { good?: boolean }).good) throw new Error('schema mismatch');
      return raw;
    },
    () => null,
  );
  writeAtomicJson(file, recovered);
  expect(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'))).toEqual({
    good: true,
  });
});

it('opens the recovery copy writable before flushing it', () => {
  const file = path.join(dir, 'state.json');
  writeAtomicJson(file, { version: 1 });
  const open = vi.spyOn(fs, 'openSync');
  writeAtomicJson(file, { version: 2 });
  expect(open.mock.calls.some(([name, flags]) =>
    String(name).endsWith('.bak.tmp') && flags === 'r+',
  )).toBe(true);
  expect(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'))).toEqual({ version: 1 });
});
