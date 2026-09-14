/* The boundary rule and every way it goes wrong, tested with hand-written page
   arrays. No PDF, no rendering, no scanner — milliseconds.

   Run:  node packets-test.mjs --roster ../data/roster-sample.json */
import { buildPackets } from './lib/packets.mjs';
import { parseArgs } from './lib/cli.mjs';
import { loadRoster } from './lib/roster.mjs';

const args = parseArgs(process.argv.slice(2), {
  flags: ['roster'],
  usage: 'node packets-test.mjs --roster <roster.json>'
});
const { roster } = loadRoster(args.get('roster'));
const RUN = 'SRE1-2026-09-18';
const S = roster.students;

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const has = (issues, kind) => issues.some((i) => i.kind === kind);

/* A page carrying a code, or a plain page.

   Takes the student object rather than an ID, so the ordinary call cannot be
   wrong and every deviation has to name itself. The previous helper defaulted
   studentId to '1001' on every page while varying folderId — harmless while the
   join was on folderId, and the exact shape of bug that would leave this whole
   suite passing while testing one student five times now that it is not. */
const code = (n, student, { runId = RUN,
                            folderId = student.folderId,
                            studentId = student.id } = {}) =>
  ({ n, payload: [folderId, runId, studentId].join('|') });
const blank = (n) => ({ n, payload: null });

/* Six pages per student: front, back, work, blank, work, blank. Takes a roster
   so the collision block can build a scan for the roster it is testing. */
function healthyScan(r = roster) {
  const pages = [];
  let n = 1;
  for (const student of r.students) {
    pages.push(code(n++, student));
    for (let i = 0; i < 5; i++) pages.push(blank(n++));
  }
  return pages;
}

console.log(`\nPacket logic\n${'-'.repeat(64)}`);

/* ── The healthy case ────────────────────────────────────────────────────────── */
{
  const r = buildPackets(healthyScan(), roster, { runId: RUN });
  check(r.ok, 'a clean scan produces no errors');
  check(r.packets.length === S.length, `${S.length} packets`, `got ${r.packets.length}`);
  check(r.packets.every((p) => p.pages.length === 6), 'six pages each');
  check(r.packets[0].pages[0] === 1 && r.packets[1].startPage === 7,
    'packets start where the codes are');
  check(r.leading.length === 0, 'nothing left over');
  check(!has(r.issues, 'folder_changed'),
    'a folder ID that still matches raises nothing',
    'the stale-folder pass must not fire on an ordinary run');
}

/* ── Pages before the first code ─────────────────────────────────────────────── */
{
  const pages = [blank(1), blank(2), ...healthyScan().map((p) => ({ ...p, n: p.n + 2 }))];
  const r = buildPackets(pages, roster, { runId: RUN });
  check(has(r.issues, 'leading_pages'), 'leading pages are reported');
  check(!r.ok, 'and they fail the run');
  check(r.leading.length === 2, 'both are set aside, never guessed at',
    `got ${r.leading.length}`);
  check(r.packets.length === S.length, 'the rest still splits correctly');
}

/* ── A missed code — the dangerous one, because it is silent ─────────────────── */
{
  const pages = healthyScan().map((p, i) => (i === 6 ? blank(p.n) : p));  // the 2nd front
  const r = buildPackets(pages, roster, { runId: RUN });
  check(has(r.issues, 'missing_student'), 'the missing student is named');
  check(r.issues.find((i) => i.kind === 'missing_student').student ===
    `${S[1].last}, ${S[1].first}`, 'by name, not by ID');
  check(has(r.issues, 'suspicious_length'),
    'and the packet that swallowed them is flagged as over-long');
  check(!r.ok, 'the run fails rather than filing a wrong packet');
}

/* ── A duplicate code ────────────────────────────────────────────────────────── */
{
  /* The second sheet carries a DIFFERENT folder ID for the same student — a
     reprint from before the real folders existed. Under the old folderId join
     these were two unrelated packets, one of them unknown_student; they are one
     student appearing twice, which is what the studentId join now sees. */
  const n = S.length * 6;
  const pages = [...healthyScan(),
    code(n + 1, S[0], { folderId: 'placeholder-' + S[0].id }), blank(n + 2)];
  const r = buildPackets(pages, roster, { runId: RUN });
  check(has(r.issues, 'duplicate_code'), 'a repeated student is reported');
  const parts = r.packets.filter((p) => p.studentId === S[0].id);
  check(parts.length === 2, 'matched as one student across two folder IDs',
    `got ${parts.length}`);
  check(parts.every((p) => p.part), 'written as numbered parts, not merged');
  check(parts.every((p) => p.folderId === S[0].folderId),
    'both filed to the folder the roster holds now');
}

/* ── A term printed before the folders existed ───────────────────────────────── */
{
  /* THE POINT OF THE studentId JOIN. Every sheet carries a placeholder folder ID
     from before Drive was wired up; the roster now holds the real ones. This has
     to split cleanly, file to the real folders, and say so. Under the old join
     every page here was unknown_student and nothing was written at all. */
  const pages = healthyScan().map((p, i) => {
    if (!p.payload) return p;
    const student = S[Math.floor(i / 6)];
    return code(p.n, student, { folderId: 'placeholder-' + student.id });
  });
  const r = buildPackets(pages, roster, { runId: RUN });
  check(r.packets.length === S.length, 'placeholder sheets still split',
    `got ${r.packets.length}`);
  check(r.ok, 'and the run still writes — the deferral working, not a fault');
  check(has(r.issues, 'folder_changed'), 'the change is reported');
  check(r.issues.filter((i) => i.kind === 'folder_changed').length === 1,
    'once for the whole run, not once per student');
  check(r.issues.find((i) => i.kind === 'folder_changed').severity === 'warning',
    'as a warning, so it never blocks the split');
  check(r.packets.every((p) => p.flags.includes('folder_changed')),
    'and flagged on every packet, so it shows beside the student in the report');
  check(r.packets.every((p, i) => p.folderId === S[i].folderId),
    'filed to the folder the roster holds now');
  check(r.packets[0].printedFolderId === 'placeholder-' + S[0].id,
    'with what the paper actually said kept for the record');
}

/* ── Two students, one ID ────────────────────────────────────────────────────── */
{
  /* app.js:135 invents `String(1001 + i)` when a CSV has no ID column, so two
     sections both number themselves from 1001. A folder ID could never collide;
     a student ID collides the first time two rosters meet, and the collision
     would file one student's work into another's folder with nothing looking
     wrong anywhere. */
  const clashed = { ...roster,
    students: S.map((s, i) => (i === 1 ? { ...s, id: S[0].id } : s)) };
  const r = buildPackets(healthyScan(clashed), clashed, { runId: RUN });
  check(has(r.issues, 'roster_id_collision'), 'a repeated student ID is refused');
  check(!r.ok, 'and the run fails rather than filing one student into another');
}

/* ── A sheet from another assignment ─────────────────────────────────────────── */
{
  const pages = healthyScan();
  pages[6] = code(7, S[1], { runId: 'SRE1-2026-05-02' });
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

/* ── A student ID that is not on the roster ──────────────────────────────────── */
{
  /* The folder ID is a perfectly good one — this student's own. Only the student
     ID is off-roster, which is what a sheet from another section looks like. */
  const pages = healthyScan();
  pages[0] = code(1, S[0], { studentId: '9999' });
  const r = buildPackets(pages, roster, { runId: RUN });
  check(has(r.issues, 'unknown_student'), 'an off-roster student ID is reported');
  check(r.issues.find((i) => i.kind === 'unknown_student').studentId === '9999',
    'and the ID it actually carried is named');
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
  check(r.issues.filter((i) => i.kind === 'missing_student').length === S.length,
    'every student is named as missing');
}

console.log(`\n${'-'.repeat(64)}`);
console.log(`${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure${failures === 1 ? '' : 's'}\n`);
process.exit(failures === 0 ? 0 : 1);
