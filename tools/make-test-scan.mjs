/* Builds a stand-in for a real duplex scan, so the splitter can be exercised before
   anyone owns a photocopier.

   Per student, in the order a duplex feeder produces them:
     1 the sheet front  (carries the routing code)
     2 the sheet back   (the scoring side)
     3 work, side one   (simulated handwriting on ruled paper)
     4 work, side two   (ruled but empty — a blank back, which is KEPT: it is the
                         evidence that the scanner caught the page and the student
                         really did leave it empty)
     5 work, side one
     6 work, side two

   --break <kind> mutates the output to rehearse a failure:
     leading      two stray pages before the first code
     missed       one student's code scribbled over, so it cannot decode
     duplicate    the first student's sheet fed twice

   Run:  node make-test-scan.mjs --roster ../data/class.json
                                 [--sheets ../data/out/sheets.pdf]
                                 [--break leading|missed|duplicate] */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import { parseArgs, fail } from './lib/cli.mjs';
import { loadRoster } from './lib/roster.mjs';

const USAGE = 'node make-test-scan.mjs --roster <roster.json> [--sheets <sheets.pdf>] ' +
  '[--break leading|missed|duplicate]';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'data', 'out');
const args = parseArgs(process.argv.slice(2), {
  flags: ['roster', 'sheets', 'break'],
  usage: USAGE
});
const breakKind = args.get('break');

const { roster } = loadRoster(args.get('roster'));
const sheetsPath = resolve(args.get('sheets', join(OUT, 'sheets.pdf')));
const sheets = await PDFDocument.load(await readFile(sheetsPath));

/* The sheets PDF and the roster have to be the same class. Without this, a
   thirty-student roster against a five-student sheets.pdf fails deep inside
   copyPages as a page-index error, which reads like a corrupt PDF rather than
   the two-files-out-of-step problem it actually is. */
if (sheets.getPageCount() !== roster.students.length * 2) {
  fail(`${sheetsPath} has ${sheets.getPageCount()} pages, but this roster has ` +
    `${roster.students.length} students — expected ${roster.students.length * 2}.\n` +
    `The sheets PDF was printed from a different class. Reprint it from the same roster.`);
}

const PAGE = [612, 792];                       // Letter in PDF points
const out = await PDFDocument.create();

/* Ruled paper, with or without something written on it. */
function addRuled(doc, { written }) {
  const page = doc.addPage(PAGE);
  const rule = rgb(0.72, 0.78, 0.86);
  for (let y = 700; y > 80; y -= 24) {
    page.drawLine({ start: { x: 60, y }, end: { x: 552, y }, thickness: 0.6, color: rule });
  }
  page.drawLine({ start: { x: 90, y: 760 }, end: { x: 90, y: 60 }, thickness: 0.6,
    color: rgb(0.9, 0.75, 0.78) });
  if (!written) return page;
  const ink = rgb(0.12, 0.14, 0.24);
  let y = 700;
  while (y > 140) {
    let x = 96;
    const end = 500 + Math.random() * 50;
    while (x < end) {
      const word = 14 + Math.random() * 46;
      if (x + word > end) break;
      page.drawLine({ start: { x, y: y + 4 + Math.random() * 3 },
        end: { x: x + word, y: y + 4 + Math.random() * 3 },
        thickness: 1.1 + Math.random() * 0.5, color: ink });
      x += word + 6 + Math.random() * 5;
    }
    y -= 24;
  }
  return page;
}

const order = [];
for (let i = 0; i < roster.students.length; i++) {
  order.push({ kind: 'sheet', index: i * 2 });      // front, with the code
  order.push({ kind: 'sheet', index: i * 2 + 1 });  // back
  order.push({ kind: 'written' });
  order.push({ kind: 'ruled' });
  order.push({ kind: 'written' });
  order.push({ kind: 'ruled' });
}

if (breakKind === 'leading') {
  order.unshift({ kind: 'written' }, { kind: 'ruled' });
}
if (breakKind === 'duplicate') {
  order.push({ kind: 'sheet', index: 0 }, { kind: 'sheet', index: 1 });
}

for (const item of order) {
  if (item.kind === 'sheet') {
    const [copied] = await out.copyPages(sheets, [item.index]);
    out.addPage(copied);
  } else {
    addRuled(out, { written: item.kind === 'written' });
  }
}

/* "missed" scribbles over one code so it genuinely will not decode — a truer test
   than deleting the page, because the page is still there and still looks like a
   packet start to a human. */
if (breakKind === 'missed') {
  /* Six pages per student, so index 6 is always the second student's front —
     whichever class this is run against. */
  const target = out.getPage(6);
  const { width, height } = target.getSize();
  for (let i = 0; i < 60; i++) {
    target.drawLine({
      start: { x: width - 90 + Math.random() * 70, y: height - 90 + Math.random() * 70 },
      end: { x: width - 90 + Math.random() * 70, y: height - 90 + Math.random() * 70 },
      thickness: 3, color: rgb(0.1, 0.1, 0.1)
    });
  }
}

await mkdir(OUT, { recursive: true });
const name = breakKind ? `scan-${breakKind}.pdf` : 'scan.pdf';
await writeFile(join(OUT, name), await out.save());
console.log(`${name} — ${order.length} pages, ${roster.students.length} students` +
  (breakKind ? `, mutated: ${breakKind}` : ''));
