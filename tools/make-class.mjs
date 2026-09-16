/* Builds a synthetic class of any size, in the app's own saved-roster shape.

   Phase 3 asks what breaks between five students and a hundred and fifty, and
   nothing in the repo could produce a class that big — the three sheets PDFs in
   data/out came from real documents of 5, 12 and 18. A rehearsal that needs a
   hand-made roster is a rehearsal nobody runs twice.

   DETERMINISTIC, WITH NO RANDOMNESS AT ALL. Name N and you get the same N names
   in the same order every time, so a timing run is comparable against the one
   before it and a failure can be reproduced by re-running the same command. A
   seeded PRNG would do as well and would invite somebody to change the seed.

   THESE ARE NOT REAL CHILDREN, and the file says so in its own `_note`. It lands
   in data/, which is off the published site (deploy.md) and is also where a real
   class would sit — so the note matters more than the folder does.

   Run:  node make-class.mjs --students 30 --name "Period 1" --out ../data/class-30.json
                             [--start 1] [--csv ../data/class-30.csv] */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs, fail } from './lib/cli.mjs';

const USAGE = 'node make-class.mjs --students <n> --name <class name> --out <roster.json> ' +
  '[--start <n>] [--csv <roster.csv>]';

const args = parseArgs(process.argv.slice(2), {
  flags: ['students', 'name', 'out', 'start', 'csv'],
  usage: USAGE
});

const count = Number(args.get('students'));
if (!Number.isInteger(count) || count < 1 || count > 1600) {
  fail(`--students must be a whole number from 1 to 1600.\n\n${USAGE}`);
}
const className = args.get('name');
if (!className) fail(`--name <class name> is required.\n\n${USAGE}`);
const outPath = args.get('out');
if (!outPath) fail(`--out <roster.json> is required.\n\n${USAGE}`);

/* The ID a generated student gets is the one app/year.js would mint — `2026-0042`,
   readable, because --force-code makes a teacher type it off a sheet under time
   pressure (§21). --start is what keeps five sections of thirty from all
   numbering themselves from 1: IDs are unique across the YEAR, not the class, and
   a rehearsal that ignored that would be rehearsing the wrong thing. */
const start = Number(args.get('start', '1'));
if (!Number.isInteger(start) || start < 1) fail(`--start must be a whole number.\n\n${USAGE}`);

/* Writers, because the fixtures already in this repo are Shakespeare, Dickinson,
   Whitman, Frost, Angelou and a Planbook year full of Achebe and Baldwin. Forty
   of each gives 1600 unique pairs, which is further than this project will ever
   need to rehearse. */
const SURNAMES = [
  'Achebe', 'Angelou', 'Atwood', 'Baldwin', 'Bishop', 'Borges', 'Brooks', 'Cather',
  'Cisneros', 'Coleridge', 'Danticat', 'Dickinson', 'Dove', 'Ellison', 'Erdrich',
  'Frost', 'Gaiman', 'Hughes', 'Hurston', 'Ishiguro', 'Kincaid', 'Lahiri', 'Larsen',
  'Lorde', 'Marquez', 'Momaday', 'Morrison', 'Munro', 'Naylor', 'Neruda', 'Oates',
  'Okri', 'Olds', 'Orange', 'Rankine', 'Rushdie', 'Silko', 'Soyinka', 'Walcott', 'Whitman'
];
const GIVEN = [
  'Chinua', 'Maya', 'Margaret', 'James', 'Elizabeth', 'Jorge', 'Gwendolyn', 'Willa',
  'Sandra', 'Samuel', 'Edwidge', 'Emily', 'Rita', 'Ralph', 'Louise', 'Robert', 'Neil',
  'Langston', 'Zora', 'Kazuo', 'Jamaica', 'Jhumpa', 'Nella', 'Audre', 'Gabriel',
  'Navarre', 'Toni', 'Alice', 'Gloria', 'Pablo', 'Joyce', 'Ben', 'Sharon', 'Tommy',
  'Claudia', 'Salman', 'Leslie', 'Wole', 'Derek', 'Walt'
];

/* Surname cycles fastest, so a class of thirty has thirty different surnames and
   reads like a register rather than a family reunion.

   THE GIVEN NAME TAKES A STRIDE OF 13, which is not decoration. The obvious
   pairing — surname cycles, given name advances only once the surnames run out —
   gives a first class of thirty in which every single student is called Chinua.
   It is unique, and it is also visibly fake the moment anyone looks at the
   printed sheets, which is the one thing a rehearsal fixture must not be.

   13 is coprime with 40, so within any run of forty the given names are all
   different; adding the block number keeps the (surname, given) PAIR unique
   across all 1600. Checked on the way out rather than trusted — see below. */
const students = [];
for (let i = 0; i < count; i++) {
  const seq = start + i;
  const k = seq - 1;
  const id = `2026-${String(seq).padStart(4, '0')}`;
  students.push({
    id,
    last: SURNAMES[k % SURNAMES.length],
    first: GIVEN[(Math.floor(k / SURNAMES.length) + 13 * k) % GIVEN.length],
    /* The placeholder, spelled exactly as app/year.js spells it. This is the
       app's SAVED-roster shape, which is the shape every tool here consumes, and
       by that point the placeholder has already been synthesised at print time —
       it is null only inside the year document (§20). */
    folderId: `placeholder-${id}`
  });
}

/* A GENERATOR THAT CANNOT VOUCH FOR ITS OUTPUT WRITES NOTHING. Two students on
   one ID is the roster_id_collision the app, the roster loader and buildPackets
   each refuse — a fixture carrying one would rehearse the failure rather than
   the thing being rehearsed. Two on one NAME is milder and still wrong: the
   report lists packets by name, so a repeat makes a correct split look like a
   duplicate. Cheap here, and it is the arithmetic above proving itself rather
   than a comment claiming it. */
const seenId = new Set();
const seenName = new Set();
students.forEach((s) => {
  const name = `${s.last}, ${s.first}`;
  if (seenId.has(s.id)) fail(`Generated ${s.id} twice — refusing to write a roster with a repeated ID.`);
  if (seenName.has(name)) fail(`Generated "${name}" twice — refusing to write a roster with a repeated name.`);
  seenId.add(s.id);
  seenName.add(name);
});

/* Sorted the way a spreadsheet export arrives, which is also the order the sheets
   print in and therefore the order the stack is handed out in. */
students.sort((a, b) => (a.last + ' ' + a.first).localeCompare(b.last + ' ' + b.first));

const roster = {
  _note: 'Synthetic class for rehearsals — not real students. Made by tools/make-class.mjs.',
  class: className,
  students
};

await mkdir(dirname(resolve(outPath)), { recursive: true });
await writeFile(resolve(outPath), JSON.stringify(roster, null, 2) + '\n');
console.log(`${outPath} — ${students.length} students, ` +
  `${students[0].id} to ${students[students.length - 1].id}`);

/* The CSV is the other half of the same fixture: it is what a re-import into a
   saved class would actually be handed, so phase 2's reconcile path can be
   rehearsed at the same scale as the split. */
const csvPath = args.get('csv');
if (csvPath) {
  const lines = ['"Last, First",Student ID,Period,Portfolio folder ID'];
  students.forEach((s) => {
    lines.push(`"${s.last}, ${s.first}",${s.id},"${className}",`);
  });
  await mkdir(dirname(resolve(csvPath)), { recursive: true });
  await writeFile(resolve(csvPath), lines.join('\n') + '\n');
  console.log(`${csvPath} — the same class as a spreadsheet export`);
}
