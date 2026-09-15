/* Draws the app icons and writes them as PNGs. Bare Node — zlib and nothing else,
   no dependency and no build step. The PNGs are committed; this never runs at
   deploy time. It exists so the icons can be regenerated rather than being five
   binaries nobody can edit.

   Full-bleed and opaque on purpose: iOS masks the apple-touch-icon corners itself
   and Android clips a "maskable" icon to a circle, so anything that matters has to
   sit inside the middle ~80%.

   The mark is the routing code, because that is what this app is: a navy field, the
   amber identity rule, and a QR finder pattern — the three nested corner squares a
   scanner locks onto. Deliberately not a sheet of paper or a tick, both of which
   would read as any other classroom app.

   Run:  node make-icons.mjs */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'app', 'icons');

/* decisions.md §10's palette: the navy the sheet header uses, and the amber rule
   that carries the identity at almost no ink. */
const NAVY = [13, 33, 55];
const AMBER = [230, 126, 34];
const WHITE = [255, 255, 255];

/* ── PNG ────────────────────────────────────────────────────────────────────
   Truecolour, 8-bit, one IDAT, filter 0 on every scanline. The whole format for
   an image this simple is three chunks and a CRC. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;        // bit depth
  ihdr[9] = 2;        // colour type 2 = truecolour
  const raw = Buffer.alloc(size * (size * 3 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;     // filter: none
    for (let x = 0; x < size; x++) {
      const px = pixels[y * size + x];
      raw[p++] = px[0]; raw[p++] = px[1]; raw[p++] = px[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ── The mark ───────────────────────────────────────────────────────────────
   Drawn in fractions of the icon so every size is the same picture rather than
   the same pixels scaled. */
function draw(size) {
  const px = new Array(size * size);
  const u = size / 100;                      // one "unit" = 1% of the icon
  const rect = (x, y, w, h, colour) => {
    for (let j = Math.round(y * u); j < Math.round((y + h) * u); j++) {
      for (let i = Math.round(x * u); i < Math.round((x + w) * u); i++) {
        if (i >= 0 && i < size && j >= 0 && j < size) px[j * size + i] = colour;
      }
    }
  };

  for (let i = 0; i < size * size; i++) px[i] = NAVY;

  /* The amber rule, across the top third — the sheet's own identity mark. */
  rect(18, 22, 64, 5, AMBER);

  /* A finder pattern: outer ring, gap, solid core. The thing a scanner locks
     onto, and the only part of a QR code that is recognisable at 152px. */
  const X = 30, Y = 40, S = 40;
  rect(X, Y, S, S, WHITE);
  rect(X + 6, Y + 6, S - 12, S - 12, NAVY);
  rect(X + 12, Y + 12, S - 24, S - 24, WHITE);

  return px;
}

mkdirSync(OUT, { recursive: true });
for (const size of [152, 167, 180, 192, 512]) {
  const file = join(OUT, 'icon-' + size + '.png');
  writeFileSync(file, png(size, draw(size)));
  console.log('icon-' + size + '.png');
}
console.log('\n' + OUT);
