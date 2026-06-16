import { describe, expect, it } from 'vitest';
import { PidLedger, type LedgerFs } from '../src/main/pid-ledger';

/** In-memory ledger file backing, optionally made to throw on read or write. */
function memFs(initial?: string, opts: { failRead?: boolean; failWrite?: boolean } = {}): LedgerFs {
  let content = initial;
  return {
    existsSync: () => content !== undefined,
    readFileSync: () => {
      if (opts.failRead) throw new Error('EACCES');
      return content ?? '';
    },
    writeFileSync: (_p, data) => {
      if (opts.failWrite) throw new Error('EROFS');
      content = data;
    },
  };
}

describe('PidLedger', () => {
  it('round-trips added PIDs and dedupes', () => {
    const fs = memFs();
    const led = new PidLedger('/tmp/pids.json', fs);
    led.add(100);
    led.add(200);
    led.add(100);
    expect(led.list().sort((a, b) => a - b)).toEqual([100, 200]);
  });

  it('removes a PID and clears all', () => {
    const fs = memFs('[1,2,3]');
    const led = new PidLedger('/tmp/pids.json', fs);
    led.remove(2);
    expect(led.list().sort((a, b) => a - b)).toEqual([1, 3]);
    led.clear();
    expect(led.list()).toEqual([]);
  });

  it('returns [] for missing, corrupt, or non-array files', () => {
    expect(new PidLedger('/x', memFs()).list()).toEqual([]);
    expect(new PidLedger('/x', memFs('not json')).list()).toEqual([]);
    expect(new PidLedger('/x', memFs('{"a":1}')).list()).toEqual([]);
  });

  it('drops non-positive / non-integer entries', () => {
    expect(new PidLedger('/x', memFs('[0,-5,1.5,42,"7"]')).list()).toEqual([42]);
  });

  it('rejects invalid PIDs on add and never throws on I/O failure', () => {
    const led = new PidLedger('/x', memFs(undefined, { failWrite: true }));
    expect(() => led.add(-1)).not.toThrow();
    expect(() => led.add(123)).not.toThrow();
    const readLed = new PidLedger('/x', memFs('[1]', { failRead: true }));
    expect(readLed.list()).toEqual([]);
  });
});
