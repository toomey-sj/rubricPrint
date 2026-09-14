#!/usr/bin/env node
/* Splits a scanned stack into one PDF per student, by the routing codes.

   During testing the report matters more than the PDFs — it is what tells you
   whether the loop works, and exactly where it does not.

   Run:  node split.mjs ../data/out/scan.pdf --roster ../data/class.json
                                             --run SRE1-2026-09-18
                                             [--out ../data/out/packets]
                                             [--deep]       always full-page scan
                                             [--force-code 13=<studentId>] */
import { writeFile, mkdir, readFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, basename } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { openPdf, renderPage, readCode, CROP, DPI } from './lib/pdf.mjs';
import { buildPackets, name, dirFor, fileFor } from './lib/packets.mjs';
import { parseArgs, fail } from './lib/cli.mjs';
import { loadRoster } from './lib/roster.mjs';

const USAGE = 'node split.mjs <scan.pdf> --roster <roster.json> --run <runId> ' +
  '[--out <dir>] [--deep] [--force-code <page>=<studentId>]';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = parseArgs(process.argv.slice(2), {
  flags: ['roster', 'run', 'out', 'force-code'],
  bools: ['deep'],
  usage: USAGE
});

const scanPath = resolve(args.positionals[0] || '../data/out/scan.pdf');
const outDir = resolve(args.get('out', join(HERE, '..', 'data', 'out', 'packets')));
const deep = args.has('deep');
const { roster, path: rosterPath, json: rosterJson } = loadRoster(args.get('roster'));

/* --run is required rather than optional now that every run is archived under
   it. It was always the flag that makes wrong_run detection possible — a sheet
   from last term's assignment in this term's stack is otherwise split happily
   into the wrong packet. */
const expectedRun = args.get('run');
if (!expectedRun) {
  fail(`--run <runId> is required. It is the ID printed in readable type under\n` +
    `each routing code, and it is what the run archive is filed under.\n\n${USAGE}`);
}

/* ── The escape hatch ────────────────────────────────────────────────────────
   Keyed on student ID, because that is what the split joins on — and because it
   is a number the teacher can read off the roster panel, rather than 33
   characters of Drive ID to copy correctly under time pressure.

   Resolved against the roster here, at parse time, so a typo fails by name
   immediately instead of surfacing as unknown_student twenty seconds later with
   no hint that the flag was the problem. */
const forced = new Map();
for (const spec of args.all('force-code')) {
  const [page, studentId] = String(spec).split('=');
  if (!page || !studentId) {
    fail(`--force-code ${spec}: expected <page>=<studentId>.\n\n${USAGE}`);
  }
  const student = roster.students.find((s) => s.id === studentId);
  if (!student) {
    fail(`--force-code ${spec}: no student with ID ${studentId} on this roster.\n` +
      `IDs are: ${roster.students.map((s) => s.id).join(', ')}`);
  }
  forced.set(Number(page), student);
}

const startedAt = new Date().toISOString();

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
    const student = forced.get(n);
    payload = [student.folderId, expectedRun, student.id].join('|');
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
  /* `undecoded/` sits as a sibling of the student directories, which looks like a
     namespace collision waiting to happen. It is not: this branch exits before a
     single packet is written, so the two can never share the directory. */

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
    console.log('one with a routing square, read the name off it, and re-run naming');
    console.log('that page and that student:');
    /* The paths exactly as they were typed, not basenames: this line is meant to
       be copied straight back into the terminal, and a basename would not
       resolve from wherever the teacher actually is. */
    console.log(`  node split.mjs ${args.positionals[0] || scanPath} ` +
      `--roster ${args.get('roster')} --run ${expectedRun} ` +
      `--force-code <page>=<student id>`);
    console.log(`  IDs on this roster: ${roster.students.map((s) => s.id).join(', ')}`);
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
  /* Subject is the student ID, because that is what identifies a packet now. The
     folder ID stays in keywords, where a destination belongs. */
  out.setSubject(packet.studentId);
  out.setKeywords([packet.runId, packet.studentId, packet.folderId]);

  packet.dir = dirFor(packet);
  packet.file = fileFor(packet);
  const studentDir = join(outDir, packet.dir);
  await mkdir(studentDir, { recursive: true });
  await writeFile(join(studentDir, packet.file), await out.save());
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

async function sha256(path) {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

async function writeReport() {
  const report = {
    /* 2: `folderId` on a packet is the roster's CURRENT folder, not the one
       printed on the sheet — that is `printedFolderId` now. A v1 reader taking
       `folderId` at face value would file into a placeholder. Packets also moved
       from one flat directory to `dir`/`file`. */
    schemaVersion: 2,
    startedAt,
    /* The hash is what makes a re-split honest: it says which bytes this report
       describes. The scan itself is deliberately not copied here — a duplex
       class scan is hundreds of megabytes, and keeping the original until the
       term's grading is done is a desk rule, not something to enforce by
       duplicating it every run. */
    input: { path: scanPath, pages: doc.numPages, sha256: await sha256(scanPath) },
    roster: { path: rosterPath, students: roster.students.length,
              sha256: createHash('sha256').update(rosterJson).digest('hex') },
    settings: { dpi: DPI, crop: CROP, deep },
    expected: { runId: expectedRun, students: roster.students.length },
    pages: pages.map((p) => ({ n: p.n, decoded: !!p.payload, via: p.via, payload: p.payload })),
    packets: result.packets.map((p) => ({
      student: name(p.student), studentId: p.studentId,
      folderId: p.folderId, printedFolderId: p.printedFolderId,
      startPage: p.startPage, pageCount: p.pages.length, pages: p.pages,
      dir: p.dir || null, file: p.file || null, flags: p.flags
    })),
    issues: result.issues,
    summary: { ...result.summary, ok: result.ok }
  };
  const json = JSON.stringify(report, null, 2);

  /* Beside the packets, where the teacher will look for it… */
  await writeFile(join(outDir, 'report.json'), json);
  await writeFile(join(outDir, 'report.txt'), lines.join('\n') + '\n');

  /* …and archived under the run, where it is not overwritten by the next one.
     Written on the refusal path too — that is precisely the run somebody needs
     to reconstruct later, and the old behaviour left it to be clobbered by the
     re-run that fixed it. The roster is copied rather than referenced because
     next term's edit to the same file would otherwise rewrite this run's
     history. */
  const archive = join(HERE, '..', 'data', 'runs', slug(expectedRun));
  await mkdir(archive, { recursive: true });
  await writeFile(join(archive, 'report.json'), json);
  await writeFile(join(archive, 'report.txt'), lines.join('\n') + '\n');
  await copyFile(rosterPath, join(archive, 'roster.json'));
  console.log(`\nArchived to ${archive}`);
}

/* A function declaration, not a const: writeReport runs during module evaluation,
   so an arrow declared down here would still be in its temporal dead zone. */
function slug(value) {
  return String(value).replace(/[^\w-]/g, '');
}
