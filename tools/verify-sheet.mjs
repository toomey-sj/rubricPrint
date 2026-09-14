/* Checks a printed PDF before any paper is spent.

   The browser's pre-flight checks the DOM. This checks the actual rendered output,
   which is the thing the copier will see:

     · exactly 2 pages per student, so duplex can never shear
     · every FRONT carries exactly one code, and it matches a roster student
     · every BACK carries none — a second code would start a phantom packet
     · every code lands inside the rectangle the splitter crops to

   That last one is what lets you trust the splitter before you own a scan.

   Run:  node verify-sheet.mjs ../data/out/sheets.pdf --roster ../data/class.json
                                                      [--run SRE1-2026-09-18] */
import { resolve } from 'node:path';
import { openPdf, renderPage, readCode, parsePayload, CROP, DPI } from './lib/pdf.mjs';
import { parseArgs } from './lib/cli.mjs';
import { loadRoster } from './lib/roster.mjs';

const USAGE = 'node verify-sheet.mjs <sheets.pdf> --roster <roster.json> [--run <runId>]';

const args = parseArgs(process.argv.slice(2), {
  flags: ['roster', 'run'],
  usage: USAGE
});
const pdfPath = resolve(args.positionals[0] || '../data/out/sheets.pdf');
const expectedRun = args.get('run');

const { roster } = loadRoster(args.get('roster'));
const byStudentId = new Map(roster.students.map((s) => [s.id, s]));

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};

console.log(`\nSheet verification\n${'-'.repeat(64)}`);
console.log(`${pdfPath}\n`);

const doc = await openPdf(pdfPath);
const expectedPages = roster.students.length * 2;

check(doc.numPages === expectedPages,
  `${expectedPages} pages for ${roster.students.length} students`,
  `got ${doc.numPages}` + (doc.numPages === expectedPages * 2
    ? ' — twice the expected count means a blank page after every sheet: ' +
      'trim .sheet height by 2px for page-box rounding'
    : ''));

/* Read every page through the same crop the splitter will use. If a code is
   readable here it is readable there, because it is literally the same call. */
const pages = [];
for (let n = 1; n <= doc.numPages; n++) {
  const cropped = await renderPage(doc, n, { dpi: DPI, crop: CROP });
  const found = readCode(cropped);
  pages.push({ n, side: n % 2 ? 'front' : 'back', found });
}

const fronts = pages.filter((p) => p.side === 'front');
const backs = pages.filter((p) => p.side === 'back');

console.log('');
check(fronts.every((p) => p.found), 'every front carries a readable code',
  fronts.filter((p) => !p.found).map((p) => 'page ' + p.n).join(', ') || undefined);
check(backs.every((p) => !p.found), 'no back carries a code',
  backs.filter((p) => p.found).map((p) => 'page ' + p.n).join(', ') ||
    'a second code per sheet would start a phantom packet');

/* Every code parses, names a roster student, and each student appears once. */
const seen = new Map();
let malformed = 0;
for (const p of fronts) {
  if (!p.found) continue;
  const parsed = parsePayload(p.found.payload);
  if (!parsed.ok) { malformed++; continue; }
  if (expectedRun && parsed.runId !== expectedRun) { malformed++; continue; }
  const student = byStudentId.get(parsed.studentId);
  if (!student) { malformed++; continue; }
  seen.set(parsed.studentId, (seen.get(parsed.studentId) || 0) + 1);
  p.student = student;
  p.parsed = parsed;
}
check(malformed === 0, 'every code parses and names a roster student ID',
  malformed ? `${malformed} did not` : undefined);
check(seen.size === roster.students.length,
  `all ${roster.students.length} students appear`,
  seen.size !== roster.students.length
    ? roster.students.filter((s) => !seen.has(s.id))
        .map((s) => s.last).join(', ') + ' missing'
    : undefined);
check([...seen.values()].every((n) => n === 1), 'no student appears twice');

/* The same condition buildPackets treats as a warning is a failure here, and the
   difference is which side of the paper you are on.

   At split time a stale folder ID means the sheets were printed before the real
   folders existed — the deferral working as designed, and the run goes ahead.
   At verify time this PDF was generated from this roster minutes ago, so a
   mismatch means you are about to spend thirty sheets of paper carrying IDs you
   have already replaced, and nothing recovers from that except reprinting. */
const stale = fronts.filter((p) => p.student && p.parsed &&
  p.parsed.folderId !== p.student.folderId);
check(stale.length === 0, 'every code carries the folder ID the roster holds now',
  stale.length
    ? `${stale.map((p) => p.student.last).join(', ')} — regenerate the sheets before printing`
    : undefined);

/* Position. The crop is a fraction of the page, so a code near its edge means the
   layout drifted and a real scan — with feeder skew on top — would start missing. */
const inset = fronts.filter((p) => p.found).map((p) => {
  const xs = [p.found.corners.topLeftCorner.x, p.found.corners.topRightCorner.x,
              p.found.corners.bottomLeftCorner.x, p.found.corners.bottomRightCorner.x];
  const ys = [p.found.corners.topLeftCorner.y, p.found.corners.topRightCorner.y,
              p.found.corners.bottomLeftCorner.y, p.found.corners.bottomRightCorner.y];
  const cropW = (CROP.x1 - CROP.x0) * 8.5 * DPI;
  const cropH = (CROP.y1 - CROP.y0) * 11 * DPI;
  return {
    page: p.n,
    left: Math.round(Math.min(...xs)), right: Math.round(Math.max(...xs)),
    top: Math.round(Math.min(...ys)), bottom: Math.round(Math.max(...ys)),
    marginLeft: Math.round(Math.min(...xs)),
    marginRight: Math.round(cropW - Math.max(...xs)),
    marginBottom: Math.round(cropH - Math.max(...ys)),
    size: Math.round(Math.max(...xs) - Math.min(...xs))
  };
});
const identical = inset.every((p) =>
  Math.abs(p.left - inset[0].left) <= 2 && Math.abs(p.top - inset[0].top) <= 2);
check(identical, 'the code sits in the same place on every sheet',
  identical ? undefined : JSON.stringify(inset.map((p) => [p.left, p.top])));

const tightest = Math.min(...inset.map((p) => Math.min(p.marginLeft, p.marginRight, p.marginBottom)));
check(tightest >= 40, 'the code is comfortably inside the crop window',
  `${tightest}px of slack at 300 DPI ≈ ${(tightest / DPI * 25.4).toFixed(1)}mm ` +
  `of feeder skew before it starts to clip`);

const symbolMm = inset.length ? (inset[0].size / DPI * 25.4).toFixed(1) : '?';
check(Number(symbolMm) > 18 && Number(symbolMm) < 22, 'the printed symbol is about 2cm',
  `${symbolMm}mm — if this is well under, the print dialog scaled the page`);

console.log(`\n${'-'.repeat(64)}`);
if (failures === 0) {
  console.log('PASS — safe to print on paper.\n');
} else {
  console.log(`FAIL — ${failures} problem${failures === 1 ? '' : 's'}. Do not print yet.\n`);
}
process.exit(failures === 0 ? 0 : 1);
