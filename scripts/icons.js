'use strict';

/**
 * Renders the app icons as PNGs with no image dependencies: a plum ground with
 * a gold marquise stone, drawn straight into an RGBA raster and PNG-encoded.
 * Run with `npm run icons` after changing the mark.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'img');
fs.mkdirSync(OUT, { recursive: true });

const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // truecolour with alpha
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0; // no filter
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const PLUM = [0x36, 0x1c, 0x2a];
const GOLD = [0xd2, 0xa2, 0x44];
const GOLD_DEEP = [0xa8, 0x79, 0x1f];

/** Signed distance helpers keep the mark smooth at every size. */
function draw(size, inset) {
  const buf = Buffer.alloc(size * size * 4);
  const c = size / 2;
  const rx = (size / 2) * (1 - inset) * 0.62;   // marquise half-width
  const ry = (size / 2) * (1 - inset);          // marquise half-height
  const aa = size / 220;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4;
      const dx = (x + 0.5 - c) / rx;
      const dy = (y + 0.5 - c) / ry;
      // A marquise (pointed oval): two circular arcs meeting at top and bottom.
      const d = Math.abs(dx) + (dy * dy) - 1 + Math.abs(dy) * 0.12;
      const edge = 1 - Math.min(1, Math.max(0, (d + aa * 0.02) / (aa * 0.03)));
      const facet = Math.min(1, Math.max(0, 0.5 + (dy * 0.5 - Math.abs(dx) * 0.35)));
      const stone = GOLD.map((g, k) => Math.round(g * facet + GOLD_DEEP[k] * (1 - facet)));

      buf[i] = Math.round(PLUM[0] * (1 - edge) + stone[0] * edge);
      buf[i + 1] = Math.round(PLUM[1] * (1 - edge) + stone[1] * edge);
      buf[i + 2] = Math.round(PLUM[2] * (1 - edge) + stone[2] * edge);
      buf[i + 3] = 255;
    }
  }
  return buf;
}

// Maskable icons need the mark inside the safe zone; the plain ones can breathe.
const ICONS = [
  ['icon-192.png', 192, 0.34],
  ['icon-512.png', 512, 0.34],
  ['icon-maskable-512.png', 512, 0.48],
  ['apple-touch-icon.png', 180, 0.34],
];

for (const [name, size, inset] of ICONS) {
  fs.writeFileSync(path.join(OUT, name), png(size, size, draw(size, inset)));
  console.log(`wrote public/img/${name} (${size}×${size})`);
}
