import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { PidLedger, type ProcessIdentity } from '../src/main/pid-ledger';

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'slr-ledger-test-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
const identity = (pid: number): ProcessIdentity => ({
  pid,
  started: '12345',
  executable: '/fixture/R',
  marker: randomUUID(),
});

describe('identity ledger', () => {
  it('persists identities, replaces reused PID records and removes only the requested record', () => {
    const file = path.join(root, 'pids.json');
    const ledger = new PidLedger(file);
    const first = identity(100),
      second = identity(200),
      replacement = identity(100);
    ledger.add(first);
    ledger.add(second);
    ledger.add(replacement);
    expect(new PidLedger(file).list()).toEqual([second, replacement]);
    ledger.remove(200);
    expect(new PidLedger(file).list()).toEqual([replacement]);
    expect(fs.readdirSync(root).some((name) => name.endsWith('.tmp'))).toBe(
      false,
    );
  });
  it('discards legacy bare PIDs and malformed identities rather than trusting executable names', () => {
    const file = path.join(root, 'pids.json');
    const valid = identity(42);
    fs.writeFileSync(
      file,
      JSON.stringify([
        42,
        '42',
        null,
        {},
        { ...valid, pid: -1 },
        { ...valid, pid: 1.5 },
        { ...valid, started: '' },
        { ...valid, executable: '' },
        { ...valid, marker: 'not-a-marker' },
        valid,
      ]),
    );
    expect(new PidLedger(file).list()).toEqual([valid]);
  });
  it('treats missing, malformed and non-array storage as having no verified owners', () => {
    const file = path.join(root, 'pids.json');
    const ledger = new PidLedger(file);
    expect(ledger.list()).toEqual([]);
    for (const value of ['broken json', '{}', 'null']) {
      fs.writeFileSync(file, value);
      expect(ledger.list()).toEqual([]);
    }
  });
  it('reports persistence failure instead of claiming a recorded identity', () => {
    const directory = path.join(root, 'directory');
    fs.mkdirSync(directory);
    expect(() => new PidLedger(directory).add(identity(42))).toThrow();
  });
});
it('recovers verified owners from the atomic backup and preserves corrupt primary evidence', () => {
  const file = path.join(root, 'pids.json');
  const ledger = new PidLedger(file);
  const first = identity(100);
  ledger.add(first);
  ledger.add(identity(200));
  fs.writeFileSync(file, '{broken');
  expect(ledger.list()).toEqual([first]);
  expect(fs.readdirSync(root).some((name) => name.includes('.corrupt-'))).toBe(
    true,
  );
  ledger.add(identity(300));
  expect(ledger.list().map((record) => record.pid)).toEqual([100, 300]);
});
it('falls back from schema-invalid primary to a validated backup', () => {
  const file = path.join(root, 'pids.json');
  const ledger = new PidLedger(file);
  const first = identity(100);
  ledger.add(first);
  ledger.add(identity(200));
  fs.writeFileSync(file, '{}');
  expect(ledger.list()).toEqual([first]);
});
