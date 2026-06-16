// Generates placeholder app icons (purple hex motif) without any image deps.
// Produces resources/icon.png (256x256), icon.ico, icon.icns — all PNG-backed.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RES = resolve(__dirname, '..', 'resources');
mkdirSync(RES, { recursive: true });

const SIZE = 256;
const BG = [0x1a, 0x1a, 0x1d]; // near-black
const PURPLE = [0x2b, 0x6c, 0xb0]; // deep R blue (core fill)
const ACCENT = [0x75, 0xaa, 0xdb]; // R blue edge

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

// Point-in-hexagon test (flat-top hexagon centered at cx,cy with radius r).
function inHex(x, y, cx, cy, r) {
  const dx = Math.abs(x - cx) / r;
  const dy = Math.abs(y - cy) / r;
  if (dx > 1 || dy > Math.sqrt(3) / 2) return false;
  return Math.sqrt(3) / 2 - dy >= (Math.sqrt(3) / 2) * (dx - 0.5) && true && dx <= 1
    ? dy <= (Math.sqrt(3) / 2) * (1 - Math.max(0, dx - 0.5) / 0.5) || dx <= 0.5
    : false;
}

function buildPng(size) {
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size * 0.38;
  const rInner = size * 0.30;
  // raw RGBA scanlines, each prefixed by a 0 filter byte
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      let color = BG;
      let alpha = 255;
      if (inHex(x, y, cx, cy, rOuter)) {
        color = inHex(x, y, cx, cy, rInner) ? PURPLE : ACCENT;
      }
      const off = y * stride + 1 + x * 4;
      raw[off] = color[0];
      raw[off + 1] = color[1];
      raw[off + 2] = color[2];
      raw[off + 3] = alpha;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const png = buildPng(SIZE);
writeFileSync(resolve(RES, 'icon.png'), png);

// ICO with a single embedded PNG image entry.
function buildIco(pngBuf, size) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size; // width (0 means 256)
  entry[1] = size >= 256 ? 0 : size; // height
  entry[2] = 0; // palette
  entry[3] = 0;
  entry.writeUInt16LE(1, 4); // planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(6 + 16, 12); // offset
  return Buffer.concat([header, entry, pngBuf]);
}
writeFileSync(resolve(RES, 'icon.ico'), buildIco(png, SIZE));

// ICNS with a single 'ic08' (256x256 PNG) entry.
function buildIcns(pngBuf) {
  const typeBuf = Buffer.from('ic08', 'ascii');
  const entryLen = Buffer.alloc(4);
  entryLen.writeUInt32BE(pngBuf.length + 8, 0);
  const entry = Buffer.concat([typeBuf, entryLen, pngBuf]);
  const magic = Buffer.from('icns', 'ascii');
  const totalLen = Buffer.alloc(4);
  totalLen.writeUInt32BE(entry.length + 8, 0);
  return Buffer.concat([magic, totalLen, entry]);
}
writeFileSync(resolve(RES, 'icon.icns'), buildIcns(png));

console.log('Generated resources/icon.png, icon.ico, icon.icns');
