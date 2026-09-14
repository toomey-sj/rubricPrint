/* The boundary rule and every way it goes wrong, tested with hand-written page
   arrays. No PDF, no rendering, no scanner — milliseconds.

   Run:  node packets-test.mjs */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPackets } from './lib/packets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const roster = JSON.parse(readFileSync(join(HERE, '..', 'data', 'roster-sample.json'), 'utf8'));
const RUN = 'SRE1-2026-09-18';
const F = roster.students.map((s) => s.folderId);

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const has = (issues, kind) => issues.some((i) => i.kind === kind);

/* A page carrying a code, or a plain page. */
const code = (n, folderId, runId = RUN, studentId = '1001') =>
  ({ n, payload: [folderId, runId, studentId].join('|') });
const blank = (n) => ({ n, payload: null });

/* Six pages per student: front, back, work, blank, work, blank. */
function healthyScan() {
  const pages = [];
  let n = 1;
  for (const folderId of F) {
    pages.push(code(n++, folderId));
    for (let i = 0; i < 5; i++) pages.push(blank(n++));
  }
  return pages;
}

console.log(`\nPacket logic\n${'-'.repeat(64)}`);

/* ── The healthy case ────────────────────────────────────────────────────────── */
{
  const r = buildPackets(healthyScan(), roster, { runId: RUN });
  check(r.ok, 'a clean scan produces no errors');
  check(r.packets.length === 5, '5 packets', `got ${r.packets.length}`);
  check(r.packets.every((p) => p.pages.length === 6), 'six pages each');
  check(r.packets[0].pages[0] === 1 && r.packets[1].startPage === 7,
    'packets start where the codes are');
  check(r.leading.length === 0, 'nothing left over');
}

/* ── Pages before the first code ─────────────────────────────────────────────── */
{
  const pages = [blank(1), blank(2), ...healthyScan().map((p) => ({ ...p, n: p.n + 2 }))];
  const r = buildPackets(pages, roster, { runId: RUN });
  check(has(r.issues, 'leading_pages'), 'leading pages are reported');
  check(!r.ok, 'and they fail the run');
  check(r.leading.length === 2, 'both are set aside, never guessed at',
    `got ${r.leading.length}`);
  check(r.packets.length === 5, 'the rest still splits correctly');
}

/* ── A missed code — the dangerous one, because it is silent ─────────────────── */
{
  const pages = healthyScan().map((p, i) => (i === 6 ? blank(p.n) : p));  // Dickinson's
  const r = buildPackets(pages, roster, { runId: RUN });
  check(has(r.issues, 'missing_student'), 'the missing student is named');
  check(r.issues.find((i) => i.kind === 'missing_student').student === 'Dickinson, Emily',
    'by name, not by folder ID');
  check(has(r.issues, 'suspicious_length'),
    'and the packet that swallowed them is flagged as over-long');
  check(!r.ok, 'the run fails rather than filing a wrong packet');
}

/* ── A duplicate code ────────────────────────────────────────────────────────── */
{
  const pages = [...healthyScan(), code(31, F[0]), blank(32)];
  const r = buildPackets(pages, roster, { runId: RUN });
  check(has(r.issues, 'duplicate_code'), 'a repeated student is reported');
  check(r.packets.filter((p) => p.folderId === F[0]).length === 2,
    'written as two parts, not merged');
  check(r.packets.filter((p) => p.folderId === F[0]).every((p) => p.part),
    'each part is numbered');
}

/* ── A sheet from another assignment ─────────────────────────────────────────── */
{
  const pages = healthyScan();
  pages[6] = code(7, F[1], 'SRE1-2026-05-02');
  const r = buildPackets(pages, roster, { runId: RUN });
  check(has(r.issues, 'wrong_run'), 'last term’s sheet is spotted');
  check(r.issues.find((i) => i.kind === 'wrong_run').runId === 'SRE1-2026-05-02',
    'and the run it actually belongs to is reported');
}

/* ── Odd page count — duplex parity ──────────────────────────────────────────── */
{
  const pages = healthyScan().slice(0, -1);
  const r = buildPackets(pages, roster, { runId: RUN });
  check(has(r.issues, 'odd_page_count'), 'an odd packet is flagged',
    'a duplex sheet is always two pages, so odd means one went missing');
}

/* ── A folder that is not on the roster ──────────────────────────────────────── */
{
  const pages = healthyScan();
  pages[0] = code(1, '1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz');
  const r = buildPackets(pages, roster, { runId: RUN });
  check(has(r.issues, 'unknown_student'), 'an unknown folder is reported');
  check(has(r.issues, 'leading_pages'),
    'and its pages become leading pages rather than being attributed');
}

/* ── A malformed payload ─────────────────────────────────────────────────────── */
{
  const pages = healthyScan();
  pages[0] = { n: 1, payload: 'just-some-text' };
  const r = buildPackets(pages, roster, { runId: RUN });
  check(has(r.issues, 'unreadable_payload'), 'a payload with the wrong shape is reported');
}

/* ── An empty stack ──────────────────────────────────────────────────────────── */
{
  const r = buildPackets([], roster, { runId: RUN });
  check(r.packets.length === 0 && !r.ok, 'an empty scan fails rather than succeeding quietly');
  check(r.issues.filter((i) => i.kind === 'missing_student').length === 5,
    'every student is named as missing');
}

console.log(`\n${'-'.repeat(64)}`);
console.log(`${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure${failures === 1 ? '' : 's'}\n`);
process.exit(failures === 0 ? 0 : 1);
