/* Proves the encoder without printing anything.

   The load-bearing test is the round trip: encode each student's real payload, then
   decode it with jsQR — an independent implementation that locates the finders, reads
   the format bits, un-masks, de-interleaves, runs Reed-Solomon correction and
   reassembles the bytes. If the generator polynomial, the interleaving, the zigzag
   order, the mask or the format BCH were wrong, correction would fail and the decode
   would come back null or garbled. Getting 54 bytes back on five payloads across
   several mask choices is not something a broken encoder does by accident.

   Run:  node qr-selftest.mjs --roster ../data/roster-sample.json   (from tools/) */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import jsQR from 'jsqr';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { parseArgs } from './lib/cli.mjs';
import { loadRoster } from './lib/roster.mjs';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const QR = require(join(HERE, '..', 'app', 'qr.js'));

const args = parseArgs(process.argv.slice(2), {
  flags: ['roster'],
  usage: 'node qr-selftest.mjs --roster <roster.json>'
});
const { roster } = loadRoster(args.get('roster'));
const RUN_ID = 'SRE1-2026-09-18';

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const decode = (result, scale = 8) => {
  const img = QR.toImageData(result, scale);
  return jsQR(img.data, img.width, img.height);
};

console.log(`\nQR encoder self-test\n${'-'.repeat(60)}`);
console.log(`${roster.students.length} students · run ${RUN_ID}\n`);

/* ── The round trip ──────────────────────────────────────────────────────────
   The budget is what is asserted here, not the version. A real Drive folder ID
   is 33 characters and lands on v4 — but this now runs against whatever roster
   it is given, and a class printed on *placeholder* folder IDs (the whole point
   of deferring Drive) has a shorter payload and legitimately picks v3. Asserting
   v4 here would fail on a correct roster. What must never happen is a payload
   over the 62-byte budget, or a step up past v4 to a denser symbol with a worse
   scan margin at the same 2cm — see decisions.md §4. A synthetic Drive-length
   payload pins v4 exactly, below. */
for (const s of roster.students) {
  const payload = [s.folderId, RUN_ID, s.id].join('|');
  const result = QR.encode(payload);
  const got = decode(result);

  console.log(`${s.last}, ${s.first} — ${payload.length} bytes, v${result.version}, ` +
    `${result.size}×${result.size}, mask ${result.mask}`);
  check(payload.length <= 62, 'within the 62-byte budget', `${payload.length} bytes`);
  check(result.version <= 4, 'version 4 or below', `got v${result.version}`);
  check(got !== null, 'jsQR finds a code');
  check(got?.data === payload, 'round-trips byte for byte',
    got && got.data !== payload ? `got "${got.data}"` : '');
  console.log('');
}

/* A real Drive folder ID is 33 characters, so the symbol a real class prints is
   fixed regardless of which roster this test was handed. */
console.log(`A Drive-length payload\n${'-'.repeat(60)}`);
const drivePayload = ['1tmJcPxdvSeqe6EBHSIx4zCRRM9kt0EL3', RUN_ID, '1001'].join('|');
const driveResult = QR.encode(drivePayload);
check(drivePayload.length === 54, '54 bytes', `got ${drivePayload.length}`);
check(driveResult.version === 4, 'version 4', `got v${driveResult.version}`);
check(driveResult.size === 33, '33×33 modules', `got ${driveResult.size}`);
check(decode(driveResult)?.data === drivePayload, 'round-trips byte for byte');

/* ── Decode margin at realistic scan resolutions ─────────────────────────────
   Measured on the Drive-length payload rather than the roster's, so the margin
   this reports is the one a real class actually prints. */
console.log(`\nDecode margin\n${'-'.repeat(60)}`);
const marginPayload = drivePayload;
const marginResult = QR.encode(marginPayload);
for (const [scale, note] of [[3, 'below any real scan'], [4, ''],
                             [5, '≈ 200 DPI scan'], [7, '≈ 300 DPI scan']]) {
  check(decode(marginResult, scale)?.data === marginPayload,
    `${scale} px per module`, note);
}

/* ── Format information, anchored on the spec's own constants ────────────────── */
console.log(`\nFormat information (EC level M)\n${'-'.repeat(60)}`);
const EXPECTED_FORMAT = [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0];
let formatOk = true;
for (let mask = 0; mask < 8; mask++) {
  if (QR.formatBits(mask) !== EXPECTED_FORMAT[mask]) {
    formatOk = false;
    console.log(`        mask ${mask}: got 0x${QR.formatBits(mask).toString(16)}, ` +
      `want 0x${EXPECTED_FORMAT[mask].toString(16)}`);
  }
}
check(formatOk, 'all 8 masks match the published values');
check(QR.formatBits(0) === 0x5412,
  'mask 0 is exactly the XOR constant', 'its BCH remainder is zero, so it must be');

/* ── Capacity and refusal ────────────────────────────────────────────────────── */
console.log(`\nCapacity\n${'-'.repeat(60)}`);
check(QR.byteCapacity(4) === 62, 'v4 level M holds 62 bytes', `got ${QR.byteCapacity(4)}`);
check(QR.encode('x'.repeat(42)).version === 3, '42 bytes picks v3');
check(QR.encode('x'.repeat(43)).version === 4, '43 bytes picks v4');
let refused = false;
try { QR.encode('x'.repeat(63)); } catch { refused = true; }
check(refused, '63 bytes is refused', 'never silently steps up to v5');

/* ── UTF-8, in case a name ever reaches the code ─────────────────────────────── */
console.log(`\nEncoding\n${'-'.repeat(60)}`);
const unicode = 'Ana Lucía Silva · café';
check(decode(QR.encode(unicode))?.data === unicode, 'utf-8 round-trips', unicode);

/* ── SVG geometry ────────────────────────────────────────────────────────────── */
console.log(`\nSVG output\n${'-'.repeat(60)}`);
const svg = QR.toSvg(marginResult);
check(/viewBox="0 0 41 41"/.test(svg), 'viewBox is in module units', '41 = 33 + 2×4 quiet');
check(/width="94"/.test(svg), 'box is 94px', 'symbol = 94 × 33/41 = 75.7px = 20.0mm');
check((svg.match(/<path/g) || []).length === 1, 'exactly one <path>',
  'adjacent runs fill as one region, so no anti-aliased seams');
check(/fill="#000"/.test(svg), 'pure black, not the house navy');
check(!/\d\.\d/.test(svg.match(/ d="[^"]*"/)[0]), 'every path coordinate is an integer');

/* ── The printed artefact ─────────────────────────────────────────────────────
   Everything above reads the module matrix. This reads the SVG itself, the way a
   scanner eventually will: rasterize at 300 DPI and decode. It is the only check
   that covers toSvg's geometry rather than the encoder's output, and it is what
   caught `data-qr` being a bare attribute — legal HTML, invalid XML, and enough to
   make a strict SVG renderer refuse the file. */
console.log(`\nSVG rasterized at 300 DPI\n${'-'.repeat(60)}`);
const dim = Math.round(94 / 96 * 300);
let rasterOk = false;
let rasterNote = '';
try {
  const image = await loadImage(Buffer.from(svg));
  const canvas = createCanvas(dim, dim);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, dim, dim);
  ctx.drawImage(image, 0, 0, dim, dim);
  const pixels = ctx.getImageData(0, 0, dim, dim);
  rasterOk = jsQR(pixels.data, dim, dim)?.data === marginPayload;
  rasterNote = `${dim}×${dim} px, ${(dim / 41).toFixed(2)} px per module`;
} catch (err) {
  rasterNote = err.message;
}
check(rasterOk, 'the real SVG decodes after rasterizing', rasterNote);

console.log(`\n${'-'.repeat(60)}`);
console.log(`${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure${failures === 1 ? '' : 's'}\n`);
process.exit(failures === 0 ? 0 : 1);
