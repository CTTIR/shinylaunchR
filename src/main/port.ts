/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Free-port discovery and HTTP readiness polling.
 *
 * Side effects (net/http) are wrapped in small functions so tests can drive
 * the polling loop against a stub server without mocking the whole module.
 */
import net from 'node:net';
import http from 'node:http';

/** Resolve a free TCP port chosen by the OS, bound to a host (default loopback). */
export function getFreePort(host = '127.0.0.1'): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, host, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        const { port } = addr;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error('Could not determine a free port')));
      }
    });
  });
}

/** True if `port` on `host` is currently accepting TCP connections. */
export function isPortOpen(port: number, host = '127.0.0.1', timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (open: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/** Find the first free port at or after `start`, within an inclusive range. */
export async function findFreePortInRange(
  start: number,
  end: number,
  host = '127.0.0.1',
): Promise<number> {
  for (let candidate = start; candidate <= end; candidate++) {
    const open = await isPortOpen(candidate, host, 200);
    if (!open) return candidate;
  }
  throw new Error(`No free port available in range ${start}-${end}`);
}

export interface WaitOptions {
  host?: string;
  timeoutMs?: number;
  intervalMs?: number;
  /** Injectable probe — defaults to a real HTTP GET. Returns true when ready. */
  probe?: (port: number, host: string) => Promise<boolean>;
  /** Injectable sleep — defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock — defaults to Date.now. */
  now?: () => number;
}

/** Default readiness probe: an HTTP response (any status) on the port. */
export function httpProbe(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: '/', timeout: 1500 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Poll until an HTTP server answers on the port, or the timeout elapses.
 * Returns true on ready, false on timeout.
 */
export async function waitForPort(port: number, options: WaitOptions = {}): Promise<boolean> {
  const host = options.host ?? '127.0.0.1';
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? 400;
  const probe = options.probe ?? httpProbe;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;

  const deadline = now() + timeoutMs;
  while (now() < deadline) {
    if (await probe(port, host)) return true;
    await sleep(intervalMs);
  }
  // one last probe right at the boundary
  return probe(port, host);
}
