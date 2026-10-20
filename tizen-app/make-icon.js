'use strict';

// Draws icon.png (512x512): dark tile with a blue play triangle and a red "no" ring.
// Pure Node (zlib) so the build needs no image libraries.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SIZE = 512;
const pixels = Buffer.alloc(SIZE * SIZE * 4);

function put(x, y, [r, g, b, a]) {
  const i = (y * SIZE + x) * 4;
  pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
}

const BG = [12, 17, 27, 255];
const BLUE = [31, 128, 224, 255];
const RED = [235, 64, 52, 255];
const c = SIZE / 2;

for (let y = 0; y < SIZE; y += 1) {
  for (let x = 0; x < SIZE; x += 1) {
    // Rounded tile.
    const rx = Math.max(0, Math.abs(x - c + 0.5) - (c - 80));
    const ry = Math.max(0, Math.abs(y - c + 0.5) - (c - 80));
    if (Math.hypot(rx, ry) > 80) { put(x, y, [0, 0, 0, 0]); continue; }
    let color = BG;
    // Play triangle.
    const tx = x - 190;
    if (tx >= 0 && tx <= 170 && Math.abs(y - c) <= (170 - tx) * 0.62) color = BLUE;
    // "No" ring and slash.
    const d = Math.hypot(x - c, y - c);
    const slash = Math.abs((x - c) - (y - c)) / Math.SQRT2;
    if ((d >= 165 && d <= 200) || (slash <= 18 && d <= 182)) color = RED;
    put(x, y, color);
  }
}

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let k = 0; k < 8; k += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header[8] = 8; // bit depth
header[9] = 6; // RGBA
const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y += 1) {
  pixels.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);
fs.writeFileSync(path.join(__dirname, 'icon.png'), png);
console.log('wrote icon.png');
