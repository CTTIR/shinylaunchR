import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { safeJoin, extractZipBuffer, extractZipFile, ZipError } from '../src/main/unzip';

/** Build a minimal ZIP in memory. method 0 = stored, 8 = deflate. */
function makeZip(entries: { name: string; content: string; method?: 0 | 8 }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const method = e.method ?? 0;
    const raw = Buffer.from(e.content, 'utf8');
    const data = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(e.name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 14); // crc (ignored by our extractor)
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const localBlock = Buffer.concat([local, nameBuf, data]);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuf]));

    locals.push(localBlock);
    offset += localBlock.length;
  }

  const cd = Buffer.concat(centrals);
  const localAll = Buffer.concat(locals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(localAll.length, 16);
  return Buffer.concat([localAll, cd, eocd]);
}

describe('safeJoin (zip-slip guard)', () => {
  const dest = path.resolve('/tmp/app-stage');
  it('resolves a normal nested entry inside the target', () => {
    expect(safeJoin(dest, 'sub/app.R')).toBe(path.resolve(dest, 'sub/app.R'));
  });
  it('rejects parent-directory traversal', () => {
    expect(() => safeJoin(dest, '../evil.txt')).toThrow(ZipError);
    expect(() => safeJoin(dest, 'a/../../evil.txt')).toThrow(ZipError);
  });
  it('rejects absolute and drive-letter paths', () => {
    expect(() => safeJoin(dest, '/etc/passwd')).toThrow(ZipError);
    expect(() => safeJoin(dest, 'C:\\Windows\\x')).toThrow(ZipError);
  });
});

describe('extractZipBuffer', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unzip-test-'));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('extracts stored and deflated entries, creating subdirectories', () => {
    const zip = makeZip([
      { name: 'app.R', content: 'shinyApp(ui, server)', method: 0 },
      { name: 'R/helpers.R', content: 'f <- function() 42', method: 8 },
      { name: 'www/', content: '' },
    ]);
    const written = extractZipBuffer(zip, dir);
    expect(fs.readFileSync(path.join(dir, 'app.R'), 'utf8')).toBe('shinyApp(ui, server)');
    expect(fs.readFileSync(path.join(dir, 'R/helpers.R'), 'utf8')).toBe('f <- function() 42');
    expect(fs.existsSync(path.join(dir, 'www'))).toBe(true);
    expect(written).toContain('app.R');
  });

  it('fails closed on a zip-slip entry without writing the escaping file', () => {
    const zip = makeZip([{ name: '../escape.txt', content: 'pwned' }]);
    expect(() => extractZipBuffer(zip, dir)).toThrow(ZipError);
    expect(fs.existsSync(path.join(path.dirname(dir), 'escape.txt'))).toBe(false);
  });

  it('rejects a non-zip buffer', () => {
    expect(() => extractZipBuffer(Buffer.from('not a zip'), dir)).toThrow(ZipError);
  });

  it('extractZipFile reads from disk', () => {
    const zipPath = path.join(dir, 'a.zip');
    fs.writeFileSync(zipPath, makeZip([{ name: 'app.R', content: 'x' }]));
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'unzip-out-'));
    try {
      extractZipFile(zipPath, out);
      expect(fs.readFileSync(path.join(out, 'app.R'), 'utf8')).toBe('x');
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });
});
