/* Prints sheets.pdf the way a teacher prints it — through the browser.

   THE GAP THIS CLOSES. Phase 1 verified the tooling against sheets generated
   straight from app/qr.js at the sheet's own geometry, and said so: that proves
   the encoder and the crop agree, and proves nothing about the print dialog.
   Every sheets PDF in data/out was made by a person pressing Ctrl+P and choosing
   Save as PDF, which is unrepeatable and does not scale to the class sizes phase
   3 needs. This drives the same rendering path Chrome's print dialog drives, and
   writes the same bytes.

   It is not a substitute for paper. Toner, feeder skew and a scanner's own
   binarisation are still unmeasured, and that is what the real duplex run in
   phase 3 is for. What this removes is everything between the app and the PDF.

   THE SETTINGS ARE THE DOCUMENTED ONES, and two of them are load-bearing:

     margin 0          app/index.html sets `@page { size: 8.5in 11in; margin: 0 }`
                       and .sheet is 816 x 1056 px, which is exactly 8.5 x 11 at
                       96dpi. Any margin scales the page down and takes the code
                       out of the rectangle the splitter crops to.
     background false   matches the browser default, which is the whole reason no
                       .sheet may carry a background-color. Printing WITH
                       backgrounds would hide that rule being broken.

   Needs the app served (npm start, port 8080) and a browser, same as ui-test.

   Run:  node print-sheets.mjs --roster ../data/class-30.json
                               --out ../data/out/sheets-30.pdf
                               [--run SRE1-2026-09-18] */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { launch, findBrowser } from './lib/browser.mjs';
import { parseArgs, fail } from './lib/cli.mjs';
import { loadRoster } from './lib/roster.mjs';

const USAGE = 'node print-sheets.mjs --roster <roster.json> --out <sheets.pdf> [--run <runId>]';
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = 'http://localhost:8080/';

const args = parseArgs(process.argv.slice(2), {
  flags: ['roster', 'out', 'run'],
  usage: USAGE
});

const rosterPath = args.get('roster');
const outPath = args.get('out');
if (!outPath) fail(`--out <sheets.pdf> is required.\n\n${USAGE}`);

/* Loaded here as well as in the page, so a roster the splitter would refuse is
   refused before a browser is started rather than after a PDF exists. */
const { roster, path: resolvedRoster } = loadRoster(rosterPath);

if (!findBrowser()) {
  fail('No Chrome or Edge found. Set RUBRIC_CHROME to the executable.');
}
try {
  const res = await fetch(APP);
  if (!res.ok) throw new Error('HTTP ' + res.status);
} catch (err) {
  fail(`Nothing is serving ${APP} (${err.message}).\n` +
    'Start it in another terminal:  cd tools && npm start\n' +
    'It must be port 8080 — the port is part of the origin.');
}

const assignment = JSON.parse(
  await readFile(join(HERE, '..', 'data', 'assignment-sample.json'), 'utf8'));
const runId = args.get('run', assignment.fields.run);

const page = await launch({ port: 9360 });
await page.goto(APP);

/* DROPPED IN, NOT SAVED. This is §22's smaller path on purpose: the roster
   brings its own identity, so printing it stores nothing and leaves no class
   behind on whatever machine ran the rehearsal. */
await page.setFile('#rosterFile', resolvedRoster);
await new Promise((r) => setTimeout(r, 600));

const loaded = await page.eval(
  "document.getElementById('status').textContent");
if (!/\d+ students/.test(loaded)) {
  await page.close();
  fail(`The app did not load that roster — it says "${loaded}".\n` +
    'Open it at ' + APP + ' and drop the file in by hand to see why.');
}

/* The paste route is how content arrives (§7), and `input` is what the app
   listens to besides a real clipboard event. The fixture is the same assignment
   the ?demo path uses, so a rehearsal prints the document verify-sheet expects. */
await page.eval(`(function () {
  var content = ${JSON.stringify({ front: assignment.front, back: assignment.back })};
  [['pasteFront', 'front'], ['pasteBack', 'back']].forEach(function (pair) {
    var box = document.getElementById(pair[0]);
    box.innerHTML = content[pair[1]];
    box.dispatchEvent(new Event('input', { bubbles: true }));
  });
  var fields = ${JSON.stringify({ ...assignment.fields, run: runId })};
  Object.keys(fields).forEach(function (key) {
    var input = document.getElementById('f' + key.charAt(0).toUpperCase() + key.slice(1));
    if (input) {
      input.value = fields[key];
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
})()`);
await new Promise((r) => setTimeout(r, 400));

/* THE APP'S OWN PRE-FLIGHT IS THE GATE. It checks the built DOM — two pages per
   student, one code per front and none on a back, no fill on any sheet, nothing
   overflowing its box. Printing past a failing pre-flight would produce a PDF
   that verify-sheet then refuses, one step later and less clearly. */
const sheetCount = await page.eval("document.querySelectorAll('.sheet').length");
const preflight = await page.eval("document.getElementById('preflight').innerText");
if (sheetCount !== roster.students.length * 2) {
  await page.close();
  fail(`The app built ${sheetCount} pages for ${roster.students.length} students; ` +
    `expected ${roster.students.length * 2}.`);
}
if (!/✓ OK/.test(preflight)) {
  await page.close();
  process.stdout.write(`\nPre-flight did not pass:\n${preflight}\n\n`);
  process.exit(1);
}

const { data } = await page.send('Page.printToPDF', {
  printBackground: false,
  marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0,
  /* The page's own @page rule wins, rather than a size restated here that could
     drift from it. */
  preferCSSPageSize: true
});
await page.close();

await mkdir(dirname(resolve(outPath)), { recursive: true });
await writeFile(resolve(outPath), Buffer.from(data, 'base64'));

console.log(`${outPath} — ${sheetCount} pages, ${roster.students.length} students, ` +
  `run ${runId}`);
console.log('Now check it:  node verify-sheet.mjs ' + outPath +
  ' --roster ' + rosterPath + ' --run ' + runId);
