/* The year document's rules, tested with hand-written objects. No DOM, no
   storage, no browser — milliseconds.

   app/year.js is pure for exactly this reason, the same way tools/lib/packets.mjs
   is. The rules worth covering here are all about IDENTITY and PERMANENCE: a
   student ID is inside a QR code on paper the moment it is printed, so the
   interesting failures are an ID being reused, regenerated, or colliding — none
   of which a person would notice by clicking.

   Run:  node year-test.mjs */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const Y = require(join(HERE, '..', 'app', 'year.js'));

let failures = 0;
const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const threw = (fn) => {
  try { fn(); return null; } catch (err) { return err.message; }
};

console.log(`\nYear document\n${'-'.repeat(64)}`);

/* ── The school year rolls over in August ────────────────────────────────────
   A roster built in late August belongs to the year about to start. Getting this
   wrong files a September class under last year. */
{
  const at = (iso) => Y.currentSchoolYear(new Date(iso + 'T12:00:00'));
  check(at('2026-08-01') === '2026-2027', 'August 1 is the new year', at('2026-08-01'));
  check(at('2026-07-31') === '2025-2026', 'July 31 is still the old one', at('2026-07-31'));
  check(at('2027-01-15') === '2026-2027', 'January belongs to the year that started',
    at('2027-01-15'));
}

/* ── A new document has every collection, empty ──────────────────────────────── */
{
  const doc = Y.newYearDocument('2026-2027');
  check(Array.isArray(doc.classes) && Array.isArray(doc.students),
    'classes and students are present and empty',
    'so no screen has to check whether they exist');
  check(doc.schemaVersion === Y.SCHEMA_VERSION, 'stamped with the schema version');
  check(doc.rev === 0, 'starts at rev 0');
}

/* ── Migration refuses rather than guesses ───────────────────────────────────
   Empty ladder today. These three refusals are the part that had to exist from
   the first write, because they are what protects documents already on disk. */
{
  check(/no schemaVersion/.test(threw(() => Y.migrateDocument({ year: '2026-2027' })) || ''),
    'a document with no schemaVersion is refused, not guessed at');
  check(/newer version/.test(threw(() => Y.migrateDocument({ schemaVersion: 99 })) || ''),
    'a document from a newer build is refused, not downgraded',
    'loading it would silently drop whatever that build added');
  const doc = Y.newYearDocument('2026-2027');
  check(Y.migrateDocument(doc) === doc, 'a current document passes through untouched');
}

/* ── Reading a year file back in ─────────────────────────────────────────────
   The export file is the only bridge between two origins, two browsers or two
   computers (§23), so the interesting cases are all the ones where it should be
   REFUSED — and a refusal that half-applied would take the class list with it. */
{
  const doc = Y.newYearDocument('2026-2027');
  const k = Y.addClass(doc, 'Period 1');
  doc.students.push({ id: '2026-0001', last: 'Achebe', first: 'Chinua', folderId: null });
  k.roster.push('2026-0001');
  const file = JSON.stringify(doc);

  const back = Y.readYearDocument(file);
  check(back.year === '2026-2027' && back.classes.length === 1 && back.students.length === 1,
    'a document the app exported reads back in');
  check(Y.describeDocument(back).students === 1, 'and describes itself for the confirmation');

  check(/not valid JSON/.test(threw(() => Y.readYearDocument('{oops')) || ''),
    'a file that is not JSON is refused');
  check(/not a Rubric Print year export/.test(
    threw(() => Y.readYearDocument('{"students":[]}')) || ''),
    'a roster JSON is refused, and named as the wrong kind of file');

  /* §18's ordering rule, a second time: a Planbook backup is ALSO a year
     document with classes and students, and its schemaVersion is its own. Sent
     up the ladder it fails with "written by a newer version of Rubric Print",
     which is true and tells the holder of the wrong file nothing.

     Read from the real sample rather than a hand-made stand-in, because the
     point of the check is that it recognises Planbook's actual file — a fixture
     written from memory would agree with the code and with nothing else. */
  const planbook = readFileSync(join(HERE, '..', 'data', 'planbook-sample-backup.json'), 'utf8');
  check(/Planbook year backup/.test(threw(() => Y.readYearDocument(planbook)) || ''),
    'a Planbook backup is named as a Planbook backup, not as a newer schema',
    'the detection runs before the migration ladder');
}

/* ── Validation is against newYearDocument's own shape ───────────────────────
   Hand-written field lists drift. This one is derived, so a field added to
   newYearDocument() is checked for without anyone remembering to come back. */
{
  const base = () => {
    const doc = Y.newYearDocument('2026-2027');
    doc.students.push({ id: '2026-0001', last: 'Achebe', first: 'Chinua', folderId: null });
    Y.addClass(doc, 'Period 1').roster.push('2026-0001');
    return doc;
  };
  const refuse = (mutate, label, pattern) => {
    const doc = base();
    mutate(doc);
    const message = threw(() => Y.readYearDocument(JSON.stringify(doc))) || '';
    check(pattern.test(message), label, message.slice(0, 96));
  };

  refuse((d) => { d.classes = {}; }, 'classes must be an array', /should be array/);
  refuse((d) => { delete d.lastStudentSeq; },
    'a document with no counter is not a year export at all',
    /not a Rubric Print year export/);
  refuse((d) => { d.year = '2026'; }, 'a malformed year is refused',
    /look like 2026-2027/);
  refuse((d) => { d.students.push({ id: '2026-0001', last: 'Other', first: 'Person' }); },
    'two students sharing an ID are refused',
    /share the ID 2026-0001/);
  refuse((d) => { d.classes[0].roster.push('2026-9999'); },
    'a roster entry with nobody behind it is refused at the door',
    /not in the file/);
  refuse((d) => { d.classes[0].name = ''; }, 'a class with no name is refused', /has no name/);
  refuse((d) => { d.students[0].id = ''; }, 'a student with no ID is refused',
    /has no student ID/);
}

/* A malformed year would otherwise reach mintStudentId, which reads its first
   half — so one file mints 2026-0001 and another mints -0001, both permanent. */
{
  const doc = Y.newYearDocument('2026');
  check(Y.mintStudentId(doc) === '2026-0001',
    'the year prefix is the first half of the year field',
    'which is why readYearDocument insists on the shape');
}

/* ── Classes ─────────────────────────────────────────────────────────────────── */
{
  const doc = Y.newYearDocument('2026-2027');
  const a = Y.addClass(doc, 'Period 1 — English 10');
  const b = Y.addClass(doc, 'Period 3 — English 10');
  check(doc.classes.length === 2, 'two classes');
  check(a.id !== b.id, 'class ids are distinct');
  check(a.archived === false && a.roster.length === 0, 'a new class is empty and active');

  Y.archiveClass(doc, a.id);
  check(Y.activeClasses(doc).length === 1, 'archiving takes it out of the bar');
  check(doc.classes.length === 2, 'and nothing is deleted',
    'v1 has no destructive action: a printed sheet must still resolve');
  check(Y.classById(doc, a.id) !== null, 'an archived class is still findable by id');
}

/* ── A student in two classes exists once ────────────────────────────────────
   The shape is Planbook's for this reason: the roster is a list of ids, so moving
   a student is list membership rather than a record that moves. */
{
  const doc = Y.newYearDocument('2026-2027');
  const a = Y.addClass(doc, 'Period 1');
  const b = Y.addClass(doc, 'Period 3');
  doc.students.push({ id: '2026-0001', last: 'Achebe', first: 'Chinua', folderId: null });
  a.roster.push('2026-0001');
  b.roster.push('2026-0001');
  check(doc.students.length === 1, 'one student record, two rosters');

  /* Moving is a remove and an add; the record is never touched. */
  a.roster.splice(a.roster.indexOf('2026-0001'), 1);
  check(doc.students.length === 1 && b.roster.length === 1,
    'dropping from one class leaves the student in the document',
    'a sheet already printed still has to resolve');
}

/* ── Minting IDs ─────────────────────────────────────────────────────────────
   §21. The dangerous failures are all silent, so they are all covered here. */
{
  const doc = Y.newYearDocument('2026-2027');
  check(Y.nextGeneratedId(doc) === '2026-0001', 'the first is 0001',
    Y.nextGeneratedId(doc));

  doc.students.push({ id: '2026-0001' }, { id: '1001' }, { id: 's_abc0123456' });
  check(Y.nextGeneratedId(doc) === '2026-0002',
    'a school ID and a Planbook id are ignored when counting',
    'they are not this year’s generated shape');

  doc.students.push({ id: '2026-0007' });
  check(Y.nextGeneratedId(doc) === '2026-0008', 'it follows the highest, not the count',
    'counting would collide the moment a student is dropped');

  doc.students.push({ id: '2025-9999' });
  check(Y.nextGeneratedId(doc) === '2026-0008', 'another year’s ids do not raise it');

  check(Y.nextGeneratedId({ year: '2026-2027', students: [] }) !== '2026-0000',
    'numbering starts at 1, not 0');
}

/* ── A number is never handed out twice ──────────────────────────────────────
   THE ONE THAT MATTERS MOST, and the one the first implementation got wrong:
   deriving the next id by scanning the students currently present means a dropped
   student's number comes back round. Their sheets may still be in a stack, and
   two people's work would then route to one packet with nothing reporting it. */
{
  const doc = Y.newYearDocument('2026-2027');
  const minted = [];
  for (let i = 0; i < 5; i++) minted.push(Y.mintStudentId(doc));
  check(minted.join(',') === '2026-0001,2026-0002,2026-0003,2026-0004,2026-0005',
    'minting walks forward', minted.join(','));

  /* Nobody was ever added to `students` above — the counter alone has to hold the
     line, because minting and enrolling are separate moments. */
  check(Y.mintStudentId(doc) === '2026-0006',
    'the counter holds even with an empty roster',
    'minting and enrolling are not the same moment');

  doc.students.push({ id: '2026-0006', last: 'Achebe', first: 'Chinua' });
  doc.students = doc.students.filter((s) => s.id !== '2026-0006');
  check(Y.nextGeneratedId(doc) === '2026-0007',
    'a dropped student’s number is never handed out again',
    'their sheets may still be in a stack');

  /* Belt and braces: a document restored from an export written before the
     counter existed has students but no lastStudentSeq, and must still not
     reissue anything it can see. */
  const restored = { year: '2026-2027', students: [{ id: '2026-0042' }] };
  check(Y.nextGeneratedId(restored) === '2026-0043',
    'a document with no counter falls back to the highest it can see',
    'so an old export can still never reissue');
  check(Y.mintStudentId(restored) === '2026-0043' && restored.lastStudentSeq === 43,
    'and minting repairs the counter on the way through');
}

/* ── Generated IDs are readable, and cannot be mistaken for a school ID ─────── */
{
  const doc = Y.newYearDocument('2026-2027');
  const id = Y.nextGeneratedId(doc);
  check(/^\d{4}-\d{4}$/.test(id), 'the shape is year-NNNN', id);
  check(id.indexOf('2026') === 0, 'prefixed with the year it was minted in');
  check(/^[\x20-\x7e]+$/.test(id), 'plain ASCII',
    '--force-code makes a teacher type this off a sheet');
}

/* ── needsIds names who would be minted ──────────────────────────────────────── */
{
  const rows = [{ id: '1001' }, { id: '' }, { id: null }, { id: '1002' }];
  check(Y.needsIds(rows).length === 2, 'blank and null both count as missing',
    'the confirmation has to state a true number before anything is written');
}

/* ── A roster built from a class ─────────────────────────────────────────────
   The same shape the CSV and Planbook paths produce, so everything downstream is
   untouched by where a roster came from. */
{
  const doc = Y.newYearDocument('2026-2027');
  const k = Y.addClass(doc, 'Period 3 — English 10');
  doc.students.push({ id: '2026-0001', last: 'Achebe', first: 'Chinua', folderId: null });
  doc.students.push({ id: '1002', last: 'Baldwin', first: 'James', folderId: '1tmJcPx' });
  k.roster.push('2026-0001', '1002');

  const roster = Y.rosterFromClass(doc, k.id);
  check(roster.students.length === 2, 'both students resolve');
  check(roster.class === 'Period 3 — English 10', 'the class name comes across');
  check(roster.students[0].folderId === 'placeholder-2026-0001',
    'a null folder becomes a placeholder AT PRINT TIME',
    'stored null stays null, so it can never be mistaken for a real Drive ID');
  check(roster.students[1].folderId === '1tmJcPx', 'a real folder is passed through');

  /* A roster id with nothing behind it is a broken document, not a student to
     skip quietly: a sheet printed for nobody is a sheet nobody hands in. */
  k.roster.push('2026-9999');
  check(/not in this document/.test(threw(() => Y.rosterFromClass(doc, k.id)) || ''),
    'a roster id with no student behind it is refused');

  const empty = Y.addClass(doc, 'Period 9');
  check(/nobody on its roster/.test(threw(() => Y.rosterFromClass(doc, empty.id)) || ''),
    'an empty class is refused rather than printing zero sheets');
}

console.log(`\n${'-'.repeat(64)}`);
console.log(`${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure${failures === 1 ? '' : 's'}\n`);
process.exit(failures === 0 ? 0 : 1);
