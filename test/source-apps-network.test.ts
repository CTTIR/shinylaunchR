import { afterEach, expect, it, vi } from 'vitest';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { httpsGet } from '../src/main/source-apps';

afterEach(() => vi.restoreAllMocks());
function response(chunks: Buffer[], status = 200, location?: string): void {
  vi.spyOn(https, 'get').mockImplementation(((
    _url: URL,
    _opts: unknown,
    cb: (res: IncomingMessage) => void,
  ) => {
    const req = new EventEmitter() as ClientRequest;
    req.destroy = ((err: Error) => {
      queueMicrotask(() => req.emit('error', err));
      return req;
    }) as typeof req.destroy;
    queueMicrotask(() => {
      const res = new EventEmitter() as IncomingMessage;
      res.statusCode = status;
      res.headers = location ? { location } : {};
      res.resume = (() => res) as typeof res.resume;
      res.destroy = ((err: Error) => {
        res.emit('error', err);
        return res;
      }) as typeof res.destroy;
      cb(res);
      for (const chunk of chunks) res.emit('data', chunk);
      res.emit('end');
    });
    return req;
  }) as typeof https.get);
}
it('limits actual download bytes even without a Content-Length', async () => {
  response([Buffer.from('123'), Buffer.from('456')]);
  await expect(
    httpsGet('https://example.test/app.zip', null, undefined, 5),
  ).rejects.toThrow(/byte budget/);
});
it('rejects redirects to HTTP and expired deadlines', async () => {
  response([], 302, 'http://example.test/insecure.zip');
  await expect(httpsGet('https://example.test/app.zip', null)).rejects.toThrow(
    /HTTPS/,
  );
  await expect(
    httpsGet(
      'https://example.test/app.zip',
      null,
      undefined,
      100,
      Date.now() - 1,
    ),
  ).rejects.toThrow(/deadline/);
});
it('aborts downloads when cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    httpsGet('https://example.test/app.zip', null, controller.signal),
  ).rejects.toThrow(/cancelled/);
});

it('honors GitHub subdir inside the archive wrapper', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { prepareSource } = await import('../src/main/source-apps');
  const name = Buffer.from('repo-main/examples/demo/app.R');
  const data = Buffer.from('shiny');
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt32LE((crc ^ 0xffffffff) >>> 0, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(30 + name.length + data.length, 16);
  response([Buffer.concat([local, name, data, central, name, end])]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'github-subdir-'));
  try {
    const prepared = await prepareSource(
      {
        id: '12345678-1234-1234-1234-123456789abc',
        name: 'Nested',
        source: {
          kind: 'source',
          origin: {
            from: 'github',
            repo: 'owner/repo',
            subdir: 'examples/demo',
          },
        },
        installed: false,
        createdAt: '',
      },
      { userDataDir: dir },
    );
    expect(prepared.ok, prepared.message).toBe(true);
    expect(prepared.appDir?.endsWith(path.join('examples', 'demo'))).toBe(true);
    prepared.rollback();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it('rejects malformed redirect locations through the promise without escaping the callback', async () => {
  response([], 302, 'https://[malformed');
  await expect(httpsGet('https://example.test/app.zip', null)).rejects.toThrow(
    /Invalid download redirect/,
  );
});
