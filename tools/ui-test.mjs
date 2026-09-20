/* The app's own screens, driven in a real browser.

   app/year.js is pure and tools/year-test.mjs holds it to account in
   milliseconds; that is where every rule about identity and permanence lives.
   This is the other half — the layer that decides WHICH file is being imported
   and into what, what a confirmation says before anything is written, and
   whether a refusal really did leave the store alone. None of that is reachable
   from Node, and all of it is one mis-click away from writing a student record
   into the wrong class.

   It needs a browser and a running server, which is exactly why it is not part
   of `npm test`:

       npm start       (in another terminal — port 8080, and it must be 8080)
       npm run test:ui

   PORT 8080 IS NOT A DEFAULT, IT IS THE ORIGIN. Classes are stored against it,
   so a suite run at :8081 would be testing an empty browser and passing.

   Every section clears localStorage first and plants what it needs, because the
   store outlives a page load — that being the entire point of it. */
import { launch, findBrowser } from './lib/browser.mjs';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = 'http://localhost:8080/';
const BACKUP = join(HERE, '..', 'data', 'planbook-sample-backup.json');
const SCRATCH = mkdtempSync(join(tmpdir(), 'rubric-ui-files-'));

let failures = 0;
let page = null;

const check = (ok, label, detail = '') => {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? '  — ' + detail : ''}`);
};
const section = (title) => console.log(`\n${title}\n${'-'.repeat(64)}`);

const panel = () => page.eval("document.getElementById('classPanel').innerText");
const rosterList = () => page.eval("document.getElementById('rosterList').innerText");
const settle = () => new Promise((r) => setTimeout(r, 300));
const click = (selector) => page.eval(
  `(function(){var n=document.querySelector(${JSON.stringify(selector)});` +
  `if(!n) throw new Error('nothing matches ' + ${JSON.stringify(selector)});` +
  `n.click(); return true;})()`);
const text = (id) => page.eval(`document.getElementById(${JSON.stringify(id)}).textContent`);
const stored = (year = '2026-2027') => page.eval(
  `JSON.parse(localStorage.getItem('rubricprint_year_${year}') || 'null')`);

/* A year planted straight into the store, which is the state every section after
   the first one starts from. */
const plant = async (doc) => {
  await page.eval('localStorage.clear()');
  if (doc) {
    await page.eval("localStorage.setItem('rubricprint_year_2026-2027', " +
      JSON.stringify(JSON.stringify(doc)) + ')');
  }
  await page.goto(APP);
};

const file = (name, body) => {
  const path = join(SCRATCH, name);
  writeFileSync(path, body);
  return path;
};

const YEAR = () => ({
  schemaVersion: 1, year: '2026-2027', rev: 3, updatedAt: '2026-09-10T10:00:00.000Z',
  classes: [
    { id: 'c_p1', name: 'Period 1', archived: false,
      roster: ['2026-0001', '2026-0002', '2026-0003'] },
    { id: 'c_p3', name: 'Period 3', archived: false, roster: [] }
  ],
  students: [
    { id: '2026-0001', last: 'Achebe', first: 'Chinua', folderId: null },
    { id: '2026-0002', last: 'Baldwin', first: 'James', folderId: null },
    { id: '2026-0003', last: 'Cisneros', first: 'Sandra', folderId: '1tmJcPxREAL' }
  ],
  lastStudentSeq: 3
});

/* ── Is there anything to drive? ─────────────────────────────────────────────
   Exit 2 and stderr for a command that cannot run, leaving exit 1 to mean the
   app is wrong — the same split every other tool here uses. */
if (!findBrowser()) {
  console.error('\nNo Chrome or Edge found. Set RUBRIC_CHROME to the executable.\n');
  process.exit(2);
}
try {
  const res = await fetch(APP);
  if (!res.ok) throw new Error('HTTP ' + res.status);
} catch (err) {
  console.error('\nNothing is serving ' + APP + ' (' + err.message + ').');
  console.error('Start it in another terminal:  cd tools && npm start');
  console.error('It must be port 8080 — the port is part of the origin, and the');
  console.error('classes these tests plant belong to it.\n');
  process.exit(2);
}

page = await launch({ port: 9333 });

/* On the origin before anything else: localStorage is denied on about:blank, and
   every section starts by planting a year in it. */
await page.goto(APP);

/* ══ Importing a year file ═══════════════════════════════════════════════════
   The export file is the only bridge between two origins, two browsers or two
   computers (§23), so the cases that matter are the refusals — and a refusal
   that half-applied would take the class list with it. */
section('Importing a year file');
{
  const yearFile = file('year.json', JSON.stringify(YEAR()));
  const rosterJson = file('roster.json',
    JSON.stringify({ students: [{ id: '1', last: 'Only', first: 'Aroster' }] }));

  await plant(null);
  check(/Backup and transfer/.test(await panel()),
    'a computer with nothing stored still offers Import a year file',
    'which is where a teacher on a new laptop starts');
  check(/No export taken on this computer/.test(await panel()),
    'and says no export has ever been taken');

  await click('[data-import-year]');
  await page.setFile('#rosterFile', yearFile);
  await settle();
  let shown = await panel();
  check(/Import the year 2026-2027\?/.test(shown), 'it proposes rather than swallowing');
  check(/2 classes and 3 students/.test(shown), 'counting what is in the file');
  check(/nothing is replaced/.test(shown), 'and saying nothing here is replaced');
  check(!/Export what is here first/.test(shown), 'with no offer to export what is not there');
  check(await stored() === null, 'and nothing written while it asks');

  await click('#yearYes');
  await settle();
  let doc = await stored();
  check(doc && doc.students.length === 3, 'the import lands');
  check(doc.rev === 4, 'as a new revision on this device', 'rev ' + doc.rev);
  check(doc.students[2].folderId === '1tmJcPxREAL',
    'a real folder ID survives the round trip',
    'the Planbook path would have overwritten it with a placeholder');

  await page.goto(APP);
  check(/Period 1/.test(await panel()), 'and it is there after a reload');

  await click('[data-import-year]');
  await page.setFile('#rosterFile', yearFile);
  await settle();
  shown = await panel();
  check(/replaces the 2026-2027 already on this computer/.test(shown),
    'a second import states what it would replace');
  check(/Export what is here first/.test(shown), 'and offers to export that first');
  await click('#yearNo');
  await settle();
  check(/your classes/i.test(await panel()), 'cancel goes back to the classes');

  await click('[data-import-year]');
  await page.setFile('#rosterFile', rosterJson);
  await settle();
  shown = await panel();
  check(/not a year file|not a Rubric Print year export/.test(shown),
    'a roster picked as a year file is refused');
  check(/Nothing on this computer has been changed/.test(shown),
    'and the refusal answers the only question that matters');
  check((await stored()).classes.length === 2, 'the store really is untouched');

  /* §18's ordering rule, for the third time: this app's own export satisfies
     looksLikePlanbook on every field. In the wrong order it opened the class
     picker and printed from placeholder folders, discarding the real ones. */
  await click('#importBack');
  await page.eval("document.getElementById('rosterPick').click()");
  await page.setFile('#rosterFile', yearFile);
  await settle();
  check(/Import the year 2026-2027\?/.test(await panel()),
    'a year file chosen as a roster is recognised, not parsed as one');
  await click('#yearNo');
}

/* ══ Add, drop and move ══════════════════════════════════════════════════════
   All membership, never records. The failure that matters is a drop taking the
   student out of the document: their sheets are in a stack carrying their ID. */
section('Add, drop and move');
{
  await plant(YEAR());
  check(!/Drop/.test(await panel()), 'the class panel has no per-student actions');

  await click('[data-open-class="c_p1"]');
  await settle();
  check(/Achebe, Chinua/.test(await rosterList()), 'a saved class opens for printing');
  check(/Move/.test(await rosterList()) && /Drop/.test(await rosterList()),
    'and its rows grow Move and Drop');

  await click('[data-drop-student="2026-0001"]');
  await settle();
  check(/Drop Achebe, Chinua from Period 1\?/.test(await panel()), 'a drop is proposed first');
  check(/They stay in this year/.test(await panel()), 'saying what is kept');
  await click('#dropNo');
  await settle();
  check((await stored()).classes[0].roster.length === 3, 'cancel writes nothing');

  await click('[data-drop-student="2026-0001"]');
  await settle();
  await click('#dropYes');
  await settle();
  let doc = await stored();
  check(doc.classes[0].roster.indexOf('2026-0001') === -1, 'the drop lands');
  check(doc.students.length === 3, 'and the student stays in the document',
    'a sheet already printed still has to resolve');
  check(!/Achebe/.test(await rosterList()), 'the print list is rebuilt without them');

  await click('[data-add-class="c_p1"]');
  await settle();
  let shown = await panel();
  check(/Add to Period 1/.test(shown), 'Add students offers the year');
  check(/Achebe, Chinua/.test(shown) && /in no class/.test(shown),
    'the dropped student is offered back, with where they are now');
  check(!/Baldwin/.test(shown), 'and anybody already on the roster is not offered');
  check(await page.eval("document.getElementById('addYes').disabled") === true,
    'with nothing ticked, the button is disabled');
  await click('[data-add-id="2026-0001"]');
  check(await text('addYes') === 'Add 1 student', 'ticking one makes it count');
  await click('#addYes');
  await settle();
  doc = await stored();
  check(doc.classes[0].roster.slice(-1)[0] === '2026-0001',
    'the add lands, at the END of the roster',
    'sheets print in roster order and the stack is handed out by walking it');

  await click('[data-move-student="2026-0002"]');
  await settle();
  check(/Move Baldwin, James out of Period 1/.test(await panel()), 'a move asks where to');
  check((await stored()).classes[0].roster.length === 3, 'and writes nothing yet');
  await click('[data-move-to="c_p3"]');
  await settle();
  doc = await stored();
  check(doc.classes[0].roster.indexOf('2026-0002') === -1 &&
    doc.classes[1].roster.indexOf('2026-0002') !== -1, 'out of one list and into the other');
  check(doc.students.length === 3, 'with the record never touched');
}

/* ══ Re-import reconciles ════════════════════════════════════════════════════ */
section('Re-importing a roster into a class that has one');
{
  const updated = file('updated.csv',
    '"Last, First",Student ID,Portfolio folder ID\n' +
    '"Achebe-Okoye, Chinua",2026-0001,\n' +
    '"Baldwin, James",2026-0002,1tmJcPxNEW\n' +
    '"Dove, Rita",2026-0004,\n');
  const blankIds = file('blank.csv',
    '"Last, First",Student ID\n"Achebe, Chinua",\n"Baldwin, James",\n');
  const unchanged = file('same.csv',
    '"Last, First",Student ID\n"Achebe, Chinua",2026-0001\n' +
    '"Baldwin, James",2026-0002\n"Cisneros, Sandra",2026-0003\n');

  const importInto = async (path) => {
    await click('[data-import-class="c_p1"]');
    await page.setFile('#rosterFile', path);
    await settle();
  };

  await plant(YEAR());

  /* The one the whole rule exists for. */
  await importInto(blankIds);
  let shown = await panel();
  check(/no student ID/.test(shown), 'a blank-ID file into a class with a roster is refused');
  check(/handed back with the ID column filled in/.test(shown),
    'pointing at the file that fixes it',
    'which is the second job that file exists to do (§21)');
  check(/Nothing on this computer has been changed/.test(shown), 'and the store is untouched');
  check((await stored()).students.length === 3, 'really untouched');
  await click('#importBack');
  await settle();

  await importInto(updated);
  shown = await panel();
  check(/Update Period 1 from that file\?/.test(shown), 'an updated file is proposed');
  check(/To add · 1/.test(shown) && /Dove, Rita/.test(shown), 'the new student is listed');
  check(/Achebe, Chinua → Achebe-Okoye, Chinua/.test(shown),
    'a changed name shows both spellings');
  check(/Portfolio folders · 1/.test(shown), 'and a folder change is listed');
  check(/Cisneros, Sandra/.test(shown) && /not in that file/.test(shown),
    'the missing student is a PROPOSED drop, named',
    'replacing wholesale would have done this silently');
  check(await text('reconcileYes') === 'Apply — add 1, drop 1, rename 1',
    'and the button counts every part of it', await text('reconcileYes'));
  check((await stored()).classes[0].roster.length === 3, 'with nothing written yet');

  await click('[data-drop-id="2026-0003"]');
  check(await text('reconcileYes') === 'Apply — add 1, rename 1',
    'unticking a drop updates the count');

  await click('#reconcileYes');
  await settle();
  const doc = await stored();
  check(doc.classes[0].roster.join(',') === '2026-0001,2026-0002,2026-0003,2026-0004',
    'the unticked student is kept', doc.classes[0].roster.join(','));
  check(doc.students[0].last === 'Achebe-Okoye' && doc.students[0].id === '2026-0001',
    'the rename lands and the ID does not move', 'renaming is not re-identifying');
  check(doc.students[3].folderId === null,
    'a new student is stored with a null folder, never a placeholder');

  await plant(YEAR());
  await importInto(unchanged);
  check(/matches Period 1 exactly/.test(await panel()),
    'an unchanged roster reports that it changes nothing');
  await click('#reconcileBack');
  await settle();
  check((await stored()).rev === 3, 'and writes nothing at all',
    'a re-import is safe to repeat');
}

/* ══ Planbook seeding ════════════════════════════════════════════════════════ */
section('Creating classes from a Planbook backup');
{
  await plant(null);
  const dropBackup = async (path) => {
    await page.eval("document.getElementById('rosterPick').click()");
    await page.setFile('#rosterFile', path);
    await settle();
  };

  await dropBackup(BACKUP);
  let shown = await panel();
  check(/Planbook 2026-2027 · 3 classes/.test(shown), 'the backup offers its classes');
  check(/1 archived that are not shown/.test(shown), 'and says what it is not showing');
  check(/Print without saving/.test(shown), 'drop-in print is still on every row (§22)');
  check(await text('seedYes') === 'Create 3 classes', 'with all three ticked and counted');
  check(await stored() === null, 'and nothing stored until it is asked for');

  await click('[data-seed-id]');
  check(await text('seedYes') === 'Create 2 classes', 'unticking one changes the count');
  await click('[data-seed-id]');

  await click('#seedYes');
  await settle();
  let doc = await stored();
  check(doc.classes.length === 3 && doc.classes[0].roster.length === 24,
    'all three are created, fully populated');
  check(doc.students.length === 54, 'with one record per student across the three');
  check(doc.students.every((s) => /^s_/.test(s.id)),
    'keeping Planbook student ids, never re-minting',
    'which is what makes a later update reconcile instead of duplicating everyone');
  check(doc.lastStudentSeq === 0, 'so the counter is not spent');
  check(doc.students.every((s) => s.folderId === null), 'and folders are stored null');
  /* The backup is put away once its classes are real (§27) — and since the bar
     now serves saved classes too, "put away" shows as the strip CHANGING HANDS
     rather than emptying: the same three classes, from the document instead of
     from the file. Two sources for one class on screen is a question nobody can
     answer, so only one of them ever holds the strip. */
  const barText = await page.eval("document.getElementById('classBar').innerText");
  check(!/Planbook/.test(barText), 'the backup is put away once its classes are real');
  check(/English 10/.test(barText) && /2026-2027 · the prompt carries across/.test(barText),
    'and the strip is handed to the saved classes it just made');

  await click('[data-open-class]');
  await settle();
  check(rosterHasPlaceholder(await rosterList(), doc.students[0].id),
    'a seeded class prints, with the placeholder folder made at print time');
  check((await stored()).students[0].folderId === null,
    'and the placeholder never reaches the document');

  await dropBackup(BACKUP);
  shown = await panel();
  check(/already created from this backup/.test(shown),
    'a second drop finds the classes it already made',
    'which is what keeping Planbook class ids buys');
  check(/Update it from this backup/.test(shown), 'and offers to update them instead');

  /* The same backup with one student added and one taken out. */
  const edited = JSON.parse(readFileSync(BACKUP, 'utf8'));
  edited.classes[0].roster = edited.classes[0].roster.slice(1).concat(['s_newkid0001']);
  edited.students.push({ id: 's_newkid0001', last: 'Zephyr', first: 'Nia' });
  await dropBackup(file('planbook-edited.json', JSON.stringify(edited)));
  await click('[data-pb-update]');
  await settle();
  shown = await panel();
  check(/To add · 1/.test(shown) && /Zephyr, Nia/.test(shown),
    'a student added in Planbook shows as an add');
  check(/not in that file/.test(shown) && /Achebe/.test(shown),
    'and one taken out as a proposed drop, not a silent one');
  await click('#reconcileYes');
  await settle();
  doc = await stored();
  check(doc.classes[0].roster.indexOf('s_newkid0001') !== -1, 'applied');
  check(doc.students.length === 55, 'and the dropped student stays in the year');
}

/* ══ The install row ═════════════════════════════════════════════════════════
   Chrome fires beforeinstallprompt against this manifest and worker on
   localhost, so most of this is the real event. The synthetic one is only to
   get a prompt() the test can watch being called, and the iOS branch needs the
   user agent overridden because no desktop browser will ever take it. */
section('Saying it should be installed');
{
  await plant(null);
  check(!/Install it/.test(await panel()),
    'a first visit with no classes is not nagged',
    'there is nothing for eviction to take yet');

  await plant(YEAR());
  check(/Install it/.test(await panel()), 'a browser that offers to install is passed on');
  check(/keeps your classes even if the browser clears out old sites/.test(await panel()),
    'saying why it matters rather than asking for a favour');

  await page.eval(`(function(){
    var e = new Event('beforeinstallprompt');
    e.prompt = function(){ window.__prompted = true; return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(e);
  })()`);
  await settle();
  await click('[data-install]');
  await settle();
  check(await page.eval('window.__prompted === true') === true,
    'the button reaches the browser prompt');
  check(!/Install it/.test(await panel()), 'and the row goes once the event is spent',
    'a button that does nothing the second time is worse than no button');

  /* These events arrive whenever the browser feels like it. One landing in the
     middle of a confirmation would wipe the question off the screen with the
     answer half-given. */
  await plant(YEAR());
  await click('[data-open-class="c_p1"]');
  await settle();
  await click('[data-drop-student="2026-0001"]');
  await settle();
  check(/Drop Achebe, Chinua/.test(await panel()), 'with a confirmation open');
  await page.eval(`(function(){
    var e = new Event('beforeinstallprompt');
    e.prompt = function(){ return Promise.resolve(); };
    e.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(e);
  })()`);
  await settle();
  check(/Drop Achebe, Chinua/.test(await panel()),
    'a late install event leaves it alone');

  await plant(YEAR());
  await page.eval(`Object.defineProperty(navigator, 'userAgent',
    { get: function(){ return 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'; } })`);
  await click('[data-open-class="c_p1"]');
  await settle();
  const shown = await panel();
  check(/Add this to your home screen/.test(shown),
    'iOS gets instructions instead — no browser there fires the event');
  check(/clear a website’s stored data after about a week/.test(shown),
    'naming the week, which is the whole reason the row exists');
}

/* ══ A moved student prints on the right sheet ═══════════════════════════════
   Phase 2's own done-when, and the only one that reaches paper: the roster edits
   above are worth nothing if the sheets the print dialog would produce still
   carry the old class. Checked through dataset.payload, which is the string that
   goes into the QR and therefore the thing the splitter will read back. */
section('A moved student prints on the right sheet');
{
  await plant(YEAR());
  await click('[data-open-class="c_p1"]');
  await settle();
  await click('[data-move-student="2026-0002"]');
  await settle();
  await click('[data-move-to="c_p3"]');
  await settle();

  /* The paste is the app's only content route, and `input` is what it listens to
     besides a real clipboard event. */
  await page.eval(`(function(){
    ['pasteFront', 'pasteBack'].forEach(function (id) {
      var box = document.getElementById(id);
      box.innerHTML = '<p>Assignment text</p>';
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
  })()`);
  await settle();

  const payloads = () => page.eval(
    "Array.prototype.map.call(document.querySelectorAll('.sheet[data-side=front]')," +
    ' function (s) { return s.dataset.payload; })');

  let built = await payloads();
  check(built.length === 2, 'Period 1 builds a sheet each for the two who are left',
    built.length + ' fronts');
  check(built.join(' ').indexOf('2026-0002') === -1,
    'and none of them is the student who moved');
  check(await page.eval("document.querySelectorAll('.sheet').length") === 4,
    'two pages per student, which is the contract the duplex run depends on');

  await click('[data-open-class="c_p3"]');
  await settle();
  built = await payloads();
  check(built.length === 1, 'Period 3 builds exactly one');
  check(built[0] === 'placeholder-2026-0002|SRE1-2026-09-18|2026-0002',
    'carrying that student’s own ID, and a folder synthesised at print time',
    built[0]);
  check(/✓ OK/.test(await page.eval("document.getElementById('preflight').innerText")),
    'and the pre-flight passes on both sides');
}

/* ══ The back is optional (decisions.md §30) ═════════════════════════════════
   A checkbox, not a per-student choice, and the sharpest edge is the print
   dialog: with one page per student, leaving duplex on would weld student N's
   cover onto the back of student N+1's. That instruction has to change with the
   checkbox, since nothing else on screen can catch a wrong print-dialog
   setting after the fact. */
section('The back is optional');
{
  await plant(YEAR());
  await click('[data-open-class="c_p1"]');
  await settle();
  await page.eval(`(function(){
    var box = document.getElementById('pasteFront');
    box.innerHTML = '<p>Assignment text</p>';
    box.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await settle();

  check(await page.eval("document.getElementById('fTwoSided').checked") === true,
    'starts double-sided, the usual case');
  check(await page.eval("document.querySelectorAll('.sheet').length") === 0,
    'and builds nothing yet — the back is required until it is turned off',
    'the front alone is not enough');

  await click('#fTwoSided');
  await settle();

  const sides = () => page.eval(
    "Array.prototype.map.call(document.querySelectorAll('.sheet'), " +
    "function (s) { return s.dataset.side; })");
  check((await sides()).length === 3, 'unticked, one page per student is enough to print',
    (await sides()).length + ' pages for 3 students');
  check((await sides()).every((s) => s === 'front'),
    'and every one of them is a front — there is no back to build');
  check(!/Stop|Waiting/.test(await page.eval("document.getElementById('preflight').innerText")),
    'the pre-flight passes without a back pasted at all');
  check(/single-sided/.test(await text('printDialogHint')),
    'and the print-dialog card says single-sided',
    'a duplex print here would weld two students onto one physical sheet');

  await click('#fTwoSided');
  await settle();
  check(await page.eval("document.querySelectorAll('.sheet').length") === 0,
    'ticking it back on needs the back again before anything builds');
  check(/double-sided/.test(await text('printDialogHint')),
    'and the card is back to double-sided');
}

/* ══ The class bar over saved classes ════════════════════════════════════════
   §19 built the strip for a loaded Planbook document and its guard outlived the
   premise: saved classes became the usual several-class case and were the one
   case with no way to switch between them. Both sources drive it now, and never
   both at once.

   §29 amends §19 again: the bar is drawn at ANY class count now, because it is
   also where a class gets added — a dashed `+` slot, live even at zero. */
section('Switching classes from the bar');
{
  const bar = () => page.eval("document.getElementById('classBar').innerText");

  await plant(null);
  check(await bar() === '+ Add a class', 'nothing stored, just the add slot');

  const oneClass = YEAR();
  oneClass.classes = [oneClass.classes[0]];
  await plant(oneClass);
  let shown = await bar();
  check(/Period 1/.test(shown) && /\+/.test(shown),
    'one class is a real tab plus the add slot now',
    '§29 amends §19’s "a strip with one tab on it is furniture" — the slot is what makes it not furniture');

  await plant(YEAR());
  shown = await bar();
  check(/Period 1/.test(shown) && /Period 3/.test(shown),
    'two classes are, and it is there before anything is pressed');
  check(/the prompt carries across/.test(shown), 'saying what switching keeps');
  check(await page.eval(
    "document.querySelector('#classBar [data-tab=\"c_p3\"]').disabled") === true,
    'a class with no roster is a tab you cannot press');

  await page.eval(`(function(){
    ['pasteFront', 'pasteBack'].forEach(function (id) {
      var box = document.getElementById(id);
      box.innerHTML = '<p>Assignment text</p>';
      box.dispatchEvent(new Event('input', { bubbles: true }));
    });
  })()`);
  await click('#classBar [data-tab="c_p1"]');
  await settle();
  check(await page.eval("document.querySelectorAll('.sheet').length") === 6,
    'pressing one builds that class’s sheets', 'three students, two pages each');
  check(await page.eval(
    "document.querySelector('#classBar [data-tab=\"c_p1\"]').classList.contains('active')") === true,
    'and the tab says which one is open');

  /* The whole point of the strip, and §19's reason for it: the assignment is
     scoped above the class, so the paste survives the switch. */
  await click('[data-move-student="2026-0002"]');
  await settle();
  await click('[data-move-to="c_p3"]');
  await settle();
  await click('#classBar [data-tab="c_p3"]');
  await settle();
  check(await page.eval("document.querySelectorAll('.sheet').length") === 2,
    'switching rebuilds for the next class');
  check(await page.eval("document.querySelector('.sheet-body').innerText") ===
    'Assignment text', 'and the paste carries across — paste once, print several periods');

  /* A loaded backup still wins the strip while it is on screen, because that is
     the document being looked at. */
  await page.eval("document.getElementById('rosterPick').click()");
  await page.setFile('#rosterFile', BACKUP);
  await settle();
  check(/Planbook 2026-2027/.test(await bar()) === false,
    'a backup that has not been opened yet leaves the bar alone',
    'the picker writes nothing, so nothing has switched');
  await click('[data-pb-print]');
  await settle();
  check(/Planbook 2026-2027 · the prompt carries across/.test(await bar()),
    'printing from one of its classes hands the strip to the backup');
  check(!/Period 1\b.*Period 3\b/.test(await bar()) || /English 10/.test(await bar()),
    'showing the backup’s classes, not the saved ones');
}

/* ══ Adding a class from the bar ═════════════════════════════════════════════
   §29: the button that used to sit at the bottom of the class panel moved into
   the bar itself, as the dashed slot the mockups always drew and this build
   never wired up. */
section('Adding a class from the bar');
{
  const bar = () => page.eval("document.getElementById('classBar').innerText");
  const addName = (value) => page.eval(`(function(){
    var input = document.getElementById('clsTabAddInput');
    input.value = ${JSON.stringify(value)};
    document.getElementById('clsTabAddForm').requestSubmit();
  })()`);

  await plant(null);
  check(await bar() === '+ Add a class', 'starts as the button, nobody has a class yet');
  await click('#clsTabAddBtn');
  check(await page.eval("document.getElementById('clsTabAddInput') !== null"),
    'clicking it swaps in a name field, in place, rather than opening a dialog');

  await addName('');
  await settle();
  check(await bar() === '+ Add a class', 'submitting empty collapses back to the button',
    'and creates nothing');
  check(await stored() === null, 'so there is still no year document at all');

  await click('#clsTabAddBtn');
  await addName('Period 1 — English 10');
  await settle();
  const shown = await bar();
  check(/Period 1 — English 10/.test(shown), 'a real name becomes a real tab');
  check(/\+/.test(shown), 'and the add slot is still there for the next one');
  const doc = await stored();
  check(doc && doc.classes.length === 1 && doc.classes[0].name === 'Period 1 — English 10',
    'written through the same path a saved class always used',
    'createClass still calls ensureDoc/addClass/writeDoc, just from the bar now');
  check(/Import roster/.test(await panel()),
    'and lands straight in picking its roster — a class with nobody in it is half-done');

  /* Escape is the explicit cancel; losing focus mid-type is not one, so a stray
     click elsewhere while typing a name does not throw it away silently. */
  await click('#clsTabAddBtn');
  await page.eval("document.getElementById('clsTabAddInput').value = 'Not yet submitted'");
  await page.eval(
    "document.getElementById('clsTabAddInput').dispatchEvent(" +
    "new KeyboardEvent('keydown', { key: 'Escape' }))");
  check((await bar()).indexOf('Not yet submitted') === -1,
    'Escape cancels an in-progress name without creating it');
}

/* The row shows only a folder's last six characters. For a student with no
   folder those are the tail of their own ID, which is what a placeholder
   synthesised at print time looks like and what nothing else would. */
function rosterHasPlaceholder(listText, studentId) {
  return listText.indexOf('folder …' + String(studentId).slice(-6)) !== -1;
}

console.log(`\n${'-'.repeat(64)}`);
if (page.logs.length) {
  failures += page.logs.length;
  console.log('The page reported ' + page.logs.length + ' error(s):');
  page.logs.forEach((line) => console.log('  ' + line));
}
console.log(`${failures === 0 ? 'PASS' : 'FAIL'} — ${failures} failure${failures === 1 ? '' : 's'}\n`);
await page.close();
process.exit(failures === 0 ? 0 : 1);
