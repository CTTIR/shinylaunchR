import { describe, expect, it } from 'vitest';
import http from 'node:http';
import {
  findFreePortInRange,
  getFreePort,
  httpProbe,
  isPortOpen,
  waitForPort,
} from '../src/main/port';

describe('getFreePort', () => {
  it('returns a usable, currently-closed port', async () => {
    const port = await getFreePort();
    expect(port).toBeGreaterThan(0);
    expect(await isPortOpen(port, '127.0.0.1', 200)).toBe(false);
  });
});

describe('findFreePortInRange', () => {
  it('returns a port within the range', async () => {
    const port = await findFreePortInRange(49200, 49260);
    expect(port).toBeGreaterThanOrEqual(49200);
    expect(port).toBeLessThanOrEqual(49260);
  });

  it('throws when the range is exhausted (empty range)', async () => {
    await expect(findFreePortInRange(50000, 49999)).rejects.toThrow();
  });
});

describe('waitForPort', () => {
  it('resolves true once the injected probe reports ready', async () => {
    let calls = 0;
    const ok = await waitForPort(1234, {
      timeoutMs: 1000,
      intervalMs: 1,
      now: () => calls * 10, // virtual clock advances each probe
      sleep: async () => {
        calls++;
      },
      probe: async () => calls >= 3,
    });
    expect(ok).toBe(true);
    expect(calls).toBeGreaterThanOrEqual(3);
  });

  it('resolves false when the deadline passes without readiness', async () => {
    let t = 0;
    const ok = await waitForPort(1234, {
      timeoutMs: 50,
      intervalMs: 10,
      now: () => (t += 30),
      sleep: async () => {},
      probe: async () => false,
    });
    expect(ok).toBe(false);
  });

  it('detects a real server with the default http probe', async () => {
    const server = http.createServer((_req, res) => res.end('ok'));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    try {
      expect(await httpProbe(port, '127.0.0.1')).toBe(true);
      expect(await waitForPort(port, { timeoutMs: 2000, intervalMs: 50 })).toBe(true);
    } finally {
      server.close();
    }
  });
});
