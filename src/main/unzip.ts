/*
 * Copyright 2026 Raban Heller
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A minimal, dependency-free ZIP extractor built on Node's built-in `zlib`.
 *
 * The project keeps a zero-runtime-dependency footprint, so rather than pull in
 * a third-party unzip library we parse the central directory ourselves and
 * inflate each entry with `zlib.inflateRawSync`. Only the two compression
 * methods real-world app zips use are supported: 0 (stored) and 8 (deflate).
 *
 * Security: every entry name is resolved against the destination directory and
 * rejected if it would escape it ("zip-slip"), if it is absolute, or if it
 * contains a drive letter. We fail closed — a single malicious entry aborts the
 * whole extraction rather than being silently skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const SIG_EOCD = 0x06054b50; // end of central directory
const SIG_CEN = 0x02014b50; // central directory file header
const SIG_LOC = 0x04034b50; // local file header
const ZIP64_SENTINEL = 0xffffffff;
const MAX_ENTRY_BYTES = 512 * 1024 * 1024; // per-entry uncompressed sanity cap

export class ZipError extends Error {}

/**
 * Resolve `entryName` inside `destDir`, throwing if the result escapes `destDir`
 * (zip-slip), is absolute, or carries a drive letter. Pure and exported so the
 * traversal guard can be unit-tested in isolation.
 */
export function safeJoin(destDir: string, entryName: string): string {
  const norm = entryName.replace(/\\/g, '/');
  if (norm.startsWith('/') || /^[A-Za-z]:/.test(norm)) {
    throw new ZipError(`unsafe absolute path in archive: ${entryName}`);
  }
  if (norm.split('/').some((seg) => seg === '..')) {
    throw new ZipError(`path traversal in archive: ${entryName}`);
  }
  const resolvedRoot = path.resolve(destDir);
  const target = path.resolve(resolvedRoot, norm);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new ZipError(`entry escapes target directory: ${entryName}`);
  }
  return target;
}

interface CentralEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

function findEocd(buf: Buffer): number {
  // The EOCD is at the end, but may be followed by a comment up to 65535 bytes.
  const minOffset = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= minOffset; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new ZipError('not a zip file (no end-of-central-directory record)');
}

function readCentralDirectory(buf: Buffer): CentralEntry[] {
  const eocd = findEocd(buf);
  const total = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === ZIP64_SENTINEL || total === 0xffff) {
    throw new ZipError('ZIP64 archives are not supported');
  }

  const entries: CentralEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== SIG_CEN) {
      throw new ZipError('corrupt central directory');
    }
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const uncompressedSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    if (
      compressedSize === ZIP64_SENTINEL ||
      uncompressedSize === ZIP64_SENTINEL ||
      localHeaderOffset === ZIP64_SENTINEL
    ) {
      throw new ZipError('ZIP64 archives are not supported');
    }
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function inflateEntry(buf: Buffer, entry: CentralEntry): Buffer {
  if (buf.readUInt32LE(entry.localHeaderOffset) !== SIG_LOC) {
    throw new ZipError(`corrupt local header for ${entry.name}`);
  }
  // The local header's name/extra lengths can differ from the central record's,
  // so read them here to locate the compressed data precisely.
  const nameLen = buf.readUInt16LE(entry.localHeaderOffset + 26);
  const extraLen = buf.readUInt16LE(entry.localHeaderOffset + 28);
  const dataStart = entry.localHeaderOffset + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data); // stored
  if (entry.method === 8) return zlib.inflateRawSync(data); // deflate
  throw new ZipError(`unsupported compression method ${entry.method} for ${entry.name}`);
}

/**
 * Extract `buf` (the bytes of a .zip) into `destDir`. Directories are created as
 * needed; existing files are overwritten. Throws `ZipError` on any unsafe entry
 * or unsupported feature. Returns the list of relative file paths written.
 */
export function extractZipBuffer(buf: Buffer, destDir: string): string[] {
  const entries = readCentralDirectory(buf);
  const written: string[] = [];
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of entries) {
    // safeJoin validates the name *before* we touch the filesystem.
    const target = safeJoin(destDir, entry.name);
    const isDir = entry.name.endsWith('/');
    if (isDir) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
      throw new ZipError(`entry too large: ${entry.name}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const contents = inflateEntry(buf, entry);
    fs.writeFileSync(target, contents);
    written.push(entry.name.replace(/\\/g, '/'));
  }
  return written;
}

/** Read a .zip from disk and extract it into `destDir`. */
export function extractZipFile(zipPath: string, destDir: string): string[] {
  return extractZipBuffer(fs.readFileSync(zipPath), destDir);
}
