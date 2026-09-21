import { Worker } from 'node:worker_threads';

export interface StageTask {
  dest: string;
  source?: string;
  zip?: Uint8Array;
  zipFile?: string;
  maxBytes?: number;
  maxEntries?: number;
  timeoutMs?: number;
}

/** Self-contained to run identically in a worker and in synchronous archive tests. */
export function executeStageTask(task: StageTask): string[] {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const zlib = require('node:zlib') as typeof import('node:zlib');
  const root = path.resolve(task.dest);
  const max = task.maxBytes ?? 256 * 1024 * 1024;
  const maxEntries = task.maxEntries ?? 10000;
  const deadline = Date.now() + (task.timeoutMs ?? 60000);
  let bytes = 0;
  let count = 0;
  const written: string[] = [];
  function check(size = 0): void {
    bytes += size;
    if (bytes > max || ++count > maxEntries || Date.now() > deadline)
      throw new Error('Staging resource budget exceeded');
  }
  function guarded(target: string): string {
    const base = target.startsWith(root + path.sep) ? root : target;
    let cursor = base;
    for (const part of ['', ...path.relative(base, target).split(path.sep)]) {
      cursor = path.join(cursor, part);
      try {
        if (fs.lstatSync(cursor).isSymbolicLink())
          throw new Error('Symlink refused');
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    return target;
  }
  function targetFor(name: string): string {
    const norm = name.replace(/\\/g, '/');
    if (
      !norm ||
      norm.startsWith('/') ||
      norm.includes('\0') ||
      norm.includes(':') ||
      norm.split('/').includes('..')
    )
      throw new Error('Unsafe archive path');
    const target = path.resolve(root, norm);
    if (!target.startsWith(root + path.sep))
      throw new Error('Unsafe archive path');
    return guarded(target);
  }
  guarded(root);
  fs.mkdirSync(root, { recursive: true });
  if (task.source) {
    const source = path.resolve(task.source);
    guarded(source);
    if (root === source || root.startsWith(source + path.sep))
      throw new Error('Destination cannot be inside source');
    function copy(dir: string, relative: string): void {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (
          ['.git', 'renv', 'node_modules', '.Rproj.user'].includes(entry.name)
        )
          continue;
        const src = path.join(dir, entry.name);
        const name = path.join(relative, entry.name);
        const target = targetFor(name);
        const stat = fs.lstatSync(src);
        if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
          throw new Error('Source contains a symlink or special file');
        check(stat.isFile() ? stat.size : 0);
        if (stat.isDirectory()) {
          fs.mkdirSync(target);
          copy(src, name);
        } else {
          // Recheck after opening; bounded reads avoid copying a growing file without limit.
          const fd = fs.openSync(
            src,
            fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
          );
          try {
            const data = Buffer.alloc(stat.size);
            let n = 0;
            while (n < data.length) {
              const read = fs.readSync(fd, data, n, data.length - n, n);
              if (!read) break;
              n += read;
            }
            if (n !== stat.size || fs.fstatSync(fd).size !== stat.size)
              throw new Error('Source changed during staging');
            fs.writeFileSync(target, data, { flag: 'wx' });
          } finally {
            fs.closeSync(fd);
          }
          written.push(name);
        }
      }
    }
    copy(source, '');
    return written;
  }
  if (task.zipFile && fs.statSync(task.zipFile).size > max)
    throw new Error('Archive exceeds byte budget');
  const buf = task.zipFile
    ? fs.readFileSync(task.zipFile)
    : Buffer.from(task.zip ?? []);
  if (buf.length > max) throw new Error('Archive exceeds byte budget');
  function bound(pos: number, len: number): void {
    if (pos < 0 || pos + len > buf.length) throw new Error('Truncated ZIP');
  }
  let end = -1;
  for (let p = buf.length - 22; p >= Math.max(0, buf.length - 65557); p--) {
    if (
      buf.readUInt32LE(p) === 0x06054b50 &&
      p + 22 + buf.readUInt16LE(p + 20) === buf.length
    ) {
      end = p;
      break;
    }
  }
  if (end < 0) throw new Error('Invalid ZIP');
  const total = buf.readUInt16LE(end + 10);
  let pos = buf.readUInt32LE(end + 16);
  if (total === 65535 || pos === 0xffffffff)
    throw new Error('ZIP64 unsupported');
  if (buf.readUInt16LE(end + 4) || buf.readUInt16LE(end + 6))
    throw new Error('Multi-disk ZIP unsupported');
  if (total > maxEntries) throw new Error('Archive entry budget exceeded');
  for (let i = 0; i < total; i++) {
    check();
    bound(pos, 46);
    if (buf.readUInt32LE(pos) !== 0x02014b50)
      throw new Error('Invalid central directory');
    const flags = buf.readUInt16LE(pos + 8);
    const method = buf.readUInt16LE(pos + 10);
    const expectedCrc = buf.readUInt32LE(pos + 16);
    const compressed = buf.readUInt32LE(pos + 20);
    const length = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extra = buf.readUInt16LE(pos + 30) + buf.readUInt16LE(pos + 32);
    const offset = buf.readUInt32LE(pos + 42);
    if (flags & 1 || ((buf.readUInt32LE(pos + 38) >>> 16) & 0xf000) === 0xa000)
      throw new Error('Encrypted or symlink ZIP entry refused');
    bound(pos + 46, nameLen + extra);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    const target = targetFor(name);
    pos += 46 + nameLen + extra;
    if (length > max - bytes) throw new Error('Archive output budget exceeded');
    bound(offset, 30);
    if (
      buf.readUInt32LE(offset) !== 0x04034b50 ||
      buf.readUInt16LE(offset + 8) !== method
    )
      throw new Error('Invalid local header');
    const start =
      offset +
      30 +
      buf.readUInt16LE(offset + 26) +
      buf.readUInt16LE(offset + 28);
    bound(start, compressed);
    const data = buf.subarray(start, start + compressed);
    const output =
      method === 0
        ? data
        : method === 8
          ? zlib.inflateRawSync(data, {
              maxOutputLength: Math.max(1, Math.min(length, max - bytes)),
            })
          : undefined;
    if (!output || output.length !== length)
      throw new Error('ZIP output length mismatch');
    let crc = 0xffffffff;
    for (const byte of output) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    if ((crc ^ 0xffffffff) >>> 0 !== expectedCrc)
      throw new Error('ZIP CRC mismatch');
    bytes += output.length;
    if (name.endsWith('/')) fs.mkdirSync(target, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      guarded(target);
      fs.writeFileSync(target, output, { flag: 'wx' });
      written.push(name);
    }
  }
  return written;
}

export function runStageTask(
  task: StageTask,
  signal?: AbortSignal,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Staging cancelled'));
      return;
    }
    const worker = new Worker(
      `const {parentPort,workerData}=require('node:worker_threads'); try { parentPort.postMessage({files:(${executeStageTask.toString()})(workerData)}); } catch(e) { parentPort.postMessage({error:e.message}); }`,
      { eval: true, workerData: task },
    );
    let settled = false;
    const finish = (err?: Error, files?: string[]): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      void worker.terminate().then(() => {
        if (err) reject(err);
        else resolve(files ?? []);
      });
    };
    const abort = (): void => finish(new Error('Staging cancelled'));
    const timer = setTimeout(
      () => finish(new Error('Staging deadline exceeded')),
      task.timeoutMs ?? 60000,
    );
    signal?.addEventListener('abort', abort, { once: true });
    worker.on('message', (msg) =>
      finish(msg.error ? new Error(msg.error) : undefined, msg.files),
    );
    worker.on('error', finish);
    worker.on('exit', (code) => {
      if (!settled) finish(new Error(`Staging worker exited ${code}`));
    });
  });
}
