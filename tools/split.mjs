#!/usr/bin/env node
/* Splits a scanned stack into one PDF per student, by the routing codes.

   During testing the report matters more than the PDFs — it is what tells you
   whether the loop works, and exactly where it does not.

   Run:  node split.mjs ../data/out/scan.pdf [--run SRE1-2026-09-18]
                                             [--out ../data/out/packets]
                                             [--deep]       always full-page scan
                                             [--force-code 13=<folderId>] */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { openPdf, renderPage, readCode, CROP, DPI } from './lib/pdf.mjs';
import { buildPackets, name, fileNameFor } from './lib/packets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (n, d = null) => (args.indexOf(n) !== -1 ? args[args.indexOf(n) + 1] : d);
const scanPath = resolve(args.find((a) => !a.startsWith('--') &&
  args[args.indexOf(a) - 1]?.startsWith('--') !== true) || '../data/out/scan.pdf');
const outDir = resolve(flag('--out', join(HERE, '..', 'data', 'out', 'packets')));
const expectedRun = flag('--run');
const deep = args.includes('--deep');

const forced = new Map();
args.forEach((a, i) => {
  if (a !== '--force-code') return;
  const [page, folderId] = String(args[i + 1] || '').split('=');
  if (page && folderId) forced.set(Number(page), folderId);
});

const roster = JSON.parse(await readFile(join(HERE, '..', 'data', 'roster-sample.json'), 'utf8'));

console.log(`\nSplitting ${basename(scanPath)}\n${'-'.repeat(64)}`);
const doc = await openPdf(scanPath);

/* Pass one: the crop where the code always is. Under 5% of the page, so this is
   roughly twenty times cheaper than rendering the whole thing — and most pages in
   a stack are handwriting that legitimately carries no code at all. */
const pages = [];
for (let n = 1; n <= doc.numPages; n++) {
  let payload = null;
  let via = 'crop';

  if (forced.has(n)) {
    payload = [forced.get(n), expectedRun || 'unknown', 'forced'].join('|');
    via = 'forced';
  } else {
    const cropped = await renderPage(doc, n, { dpi: DPI, crop: CROP });
    payload = readCode(cropped)?.payload || null;

    /* Pass two only where pass one found nothing AND a full-page look is warranted.
       Not a blanket fallback: most pages are meant to have no code, so falling back
       on every miss would spend the expensive pass on the large majority of the
       stack and throw away the entire saving. */
    if (!payload && deep) {
      const full = await renderPage(doc, n, { dpi: 200 });
      payload = readCode(full)?.payload || null;
      if (payload) via = 'full page';
    }
  }
  pages.push({ n, payload, via });
}

const result = buildPackets(pages, roster, { runId: expectedRun });

/* If pass one came up short, try the expensive pass on the pages that failed —
   but only then, and only on those. */
if (!result.ok && !deep && result.summary.packetsFound < result.summary.packetsExpected) {
  console.log('Some students are missing. Looking at the full page for the misses…\n');
  for (const page of pages) {
    if (page.payload) continue;
    const full = await renderPage(doc, page.n, { dpi: 200 });
    const found = readCode(full);
    if (found) { page.payload = found.payload; page.via = 'full page'; }
  }
  Object.assign(result, buildPackets(pages, roster, { runId: expectedRun }));
}

/* ── The report ──────────────────────────────────────────────────────────────── */
const lines = [];
lines.push(`${basename(scanPath)} · ${doc.numPages} pages · ` +
  `${result.summary.packetsFound} of ${result.summary.packetsExpected} packets found`);
lines.push('');
for (const packet of result.packets) {
  const first = packet.pages[0];
  const last = packet.pages[packet.pages.length - 1];
  const flags = packet.flags.length ? '  ⚠ ' + packet.flags.join(', ') : '';
  lines.push(`  ${name(packet.student).padEnd(24)} pages ${String(first).padStart(3)}` +
    `–${String(last).padEnd(3)} ${String(packet.pages.length).padStart(3)} pages${flags}`);
}
if (result.issues.length) {
  lines.push('');
  for (const issue of result.issues) {
    lines.push(`${issue.severity === 'error' ? '✕' : '⚠'} ${issue.message}`);
  }
}

console.log(lines.join('\n'));

/* ── Write, or refuse to ─────────────────────────────────────────────────────
   Nothing is written when a student is missing. A half-correct split that the
   teacher files is worse than no split, because the mis-filing is invisible. */
await mkdir(outDir, { recursive: true });

if (!result.ok) {
  /* The way out of a dead end. The sheet prints its run ID in readable type right
     under the code, so dumping the crop of every page that failed lets the teacher
     read it with their eyes and hand it back with --force-code. Without this, an
     undecodable code means re-scanning the whole stack. */
  const stuck = pages.filter((p) => !p.payload && isLikelySheet(p.n));
  if (stuck.length) {
    const dumpDir = join(outDir, 'undecoded');
    await mkdir(dumpDir, { recursive: true });
    for (const page of stuck) {
      const cropped = await renderPage(doc, page.n, { dpi: DPI, crop: CROP });
      await writeFile(join(dumpDir, `page-${String(page.n).padStart(3, '0')}.png`),
        cropped.canvas.toBuffer('image/png'));
    }
    console.log('');
    console.log(`Wrote ${stuck.length} crop(s) to ${join(outDir, 'undecoded')} — ` +
      `page${stuck.length === 1 ? '' : 's'} ${stuck.map((p) => p.n).join(', ')}.`);
    console.log('One of them is a sheet whose code would not read. Open them, find the');
    console.log('one with a routing square, and re-run naming that page:');
    console.log(`  node split.mjs ${basename(scanPath)} --run ${expectedRun || '<run>'} ` +
      `--force-code <page>=<that student's folder id>`);
  }

  console.log(`\n${'-'.repeat(64)}`);
  console.log(`Nothing was written to ${outDir}. Fix the above and run again.\n`);
  await writeReport();
  process.exit(1);
}

const source = await PDFDocument.load(new Uint8Array(await readFile(scanPath)),
  { ignoreEncryption: true });
for (const packet of result.packets) {
  const out = await PDFDocument.create();
  const copied = await out.copyPages(source, packet.pages.map((n) => n - 1));
  copied.forEach((page) => out.addPage(page));
  out.setTitle(`${name(packet.student)} — ${packet.runId}`);
  out.setSubject(packet.folderId);
  out.setKeywords([packet.runId, packet.folderId]);
  packet.file = fileNameFor(packet);
  await writeFile(join(outDir, packet.file), await out.save());
}

await writeReport();
console.log(`\n${'-'.repeat(64)}`);
console.log(`${result.packets.length} packets written to ${outDir}\n`);
process.exit(0);

/* A page worth dumping is one that sits where a sheet front should — right after an
   even-length run, or at the head of the stack. Dumping every blank back would bury
   the one crop that matters. */
function isLikelySheet(n) {
  if (n === 1) return true;
  const packet = result.packets.find((p) => p.pages.includes(n));
  if (!packet) return true;                       // a leading page
  return packet.pages.length > 8 && packet.pages.indexOf(n) % 2 === 0;
}

async function writeReport() {
  const report = {
    schemaVersion: 1,
    input: { path: basename(scanPath), pages: doc.numPages },
    settings: { dpi: DPI, crop: CROP, deep },
    expected: { runId: expectedRun, students: roster.students.length },
    pages: pages.map((p) => ({ n: p.n, decoded: !!p.payload, via: p.via, payload: p.payload })),
    packets: result.packets.map((p) => ({
      student: name(p.student), folderId: p.folderId, studentId: p.studentId,
      startPage: p.startPage, pageCount: p.pages.length, pages: p.pages,
      file: p.file || null, flags: p.flags
    })),
    issues: result.issues,
    summary: { ...result.summary, ok: result.ok }
  };
  await writeFile(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(outDir, 'report.txt'), lines.join('\n') + '\n');
}
