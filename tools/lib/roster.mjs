/* Loading the roster, and refusing to run without one.

   Every tool used to read `data/roster-sample.json` from a fixed path. Point the
   splitter at a real class and it would split against five fictional poets —
   silently, because the codes on the paper match nothing on the roster it
   actually loaded, and "no packets found" reads like a scanner problem. There is
   deliberately no fallback here: a missing --roster is an error, never the
   sample.

   File I/O lives here rather than in packets.mjs, which is pure on purpose. */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail } from './cli.mjs';
import { rosterIssues } from './packets.mjs';

export function loadRoster(value) {
  if (!value) {
    fail('--roster <path> is required.\n\n' +
      'It is the JSON the app writes with "Save as JSON" after importing a class\n' +
      'CSV — see README, "Two roster formats, on purpose". There is no default:\n' +
      'falling back to the sample would split a real class against five fictional\n' +
      'poets without saying so.');
  }

  /* resolve() against the cwd, matching how every other user-supplied path in
     these tools is treated. Repo-internal defaults use join(HERE, …). */
  const path = resolve(value);

  let json;
  try {
    json = readFileSync(path, 'utf8');
  } catch (err) {
    fail(err.code === 'ENOENT'
      ? `No roster at ${path}.`
      : `Could not read the roster at ${path} — ${err.message}`);
  }

  let roster;
  try {
    roster = JSON.parse(json);
  } catch (err) {
    fail(`${path} is not valid JSON — ${err.message}\n\n` +
      'If this is a CSV export, open it in app/index.html first and click\n' +
      '"Save as JSON". The splitter reads the app\'s own format.');
  }

  /* The same shape the app validates on the way in (app.js:47), checked again on
     the way out — the two halves never run in the same process, so neither can
     assume the other looked. */
  if (!roster || !Array.isArray(roster.students) || !roster.students.length) {
    fail(`${path} has no "students" array.`);
  }

  /* folderId is checked by the app (app.js:34); id and last are not, and a
     student missing either produces a sheet whose code can never be matched back
     to them. Cheaper to catch here than after thirty sheets have been printed. */
  const incomplete = roster.students
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !s || !s.id || !s.last || !s.folderId);
  if (incomplete.length) {
    fail(`${path} has ${incomplete.length} student(s) missing id, last or folderId:\n` +
      incomplete.map(({ s, i }) =>
        `  row ${i + 1}: ${JSON.stringify(s)}`).join('\n'));
  }

  /* Packets are matched on student ID now, so a repeated one would file one
     student's work into another's folder with nothing looking wrong. Same check
     buildPackets runs, applied before anything is rendered. */
  const bad = rosterIssues(roster);
  if (bad.length) fail(bad.map((i) => i.message).join('\n\n') + `\n\nRoster: ${path}`);

  return { roster, path, json };
}
