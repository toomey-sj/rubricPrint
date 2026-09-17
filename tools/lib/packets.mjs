/* Turning a list of per-page decode results into per-student packets.

   Deliberately pure — no PDF, no filesystem, no rendering. Every edge case that
   matters can therefore be tested with a hand-written array in milliseconds, which
   is where the boundary rule gets its real coverage.

   THE BOUNDARY RULE: a routing code starts a packet, and every page after it
   belongs to that student until the next code. Nothing else is inferred. */
import { parsePayload } from './pdf.mjs';

/* ── The roster's own integrity ──────────────────────────────────────────────
   Separate from buildPackets so verify-sheet and the roster loader can run it
   before any paper or any pixel is involved.

   This check did not need to exist while the join was on folderId: a Drive
   folder ID is 33 effectively random characters and two students could not
   collide if you tried. A student ID is whatever the CSV's ID column held — and
   when a CSV has no ID column at all, app.js:135 invents `String(1001 + i)`, so
   two sections both number themselves from 1001. A collision routes one
   student's entire packet into another student's folder, silently, which is the
   one failure this project refuses to have. One Set is cheap insurance. */
export function rosterIssues(roster) {
  const issues = [];
  const seen = new Set();
  const clashing = new Set();
  for (const student of roster.students) {
    if (seen.has(student.id)) clashing.add(student.id);
    seen.add(student.id);
  }
  for (const id of clashing) {
    const involved = roster.students.filter((s) => s.id === id).map(name);
    issues.push({ kind: 'roster_id_collision', severity: 'error', studentId: id,
      students: involved,
      message: `Student ID ${id} appears ${involved.length} times on this roster ` +
        `(${involved.join('; ')}). Packets are matched by student ID, so two ` +
        `students sharing one would file into each other's folders without ` +
        `anything looking wrong. Give them distinct IDs and reprint.` });
  }
  return issues;
}

export function buildPackets(pageResults, roster, options = {}) {
  const expectedRun = options.runId || null;

  const packets = [];
  const issues = rosterIssues(roster);
  const leading = [];
  let current = null;

  /* The roster calls it `id`, the payload calls it `studentId`. Two names for one
     field, because the roster is a person record and the payload is a 62-byte
     budget. Left as they are rather than renamed on either side: both names are
     printed on things that already exist. */
  const byStudentId = new Map(roster.students.map((s) => [s.id, s]));

  /* A page that fails to identify itself is glued onto whichever packet is open
     (§3's boundary rule — nothing else is inferred) but that packet's own
     boundary is now unproven: the next code might have been on THIS page, mis-
     read, and the page actually belongs to whoever comes next. `unresolved_page`
     is what tells split.mjs to quarantine the whole packet rather than file it
     as if the glue were as trustworthy as a clean read (decisions.md §28). A page
     with nowhere to glue to already goes to `leading`, which quarantines
     unconditionally — it needs no flag of its own. */
  const glueUnresolved = (page) => {
    if (current) { current.pages.push(page.n); current.flags.push('unresolved_page'); }
    else leading.push(page.n);
  };

  for (const page of pageResults) {
    if (!page.payload) {
      if (current) current.pages.push(page.n);
      else leading.push(page.n);
      continue;
    }

    const parsed = parsePayload(page.payload);
    if (!parsed.ok) {
      issues.push({ kind: 'unreadable_payload', severity: 'error', page: page.n,
        message: `Page ${page.n} carries a code that is not folderId|runId|studentId ` +
          `(${parsed.reason}). It was left with the previous packet.` });
      glueUnresolved(page);
      continue;
    }

    if (expectedRun && parsed.runId !== expectedRun) {
      issues.push({ kind: 'wrong_run', severity: 'error', page: page.n,
        runId: parsed.runId,
        message: `Page ${page.n} belongs to run ${parsed.runId}, not ${expectedRun}. ` +
          `That is a sheet from another assignment in this stack.` });
      glueUnresolved(page);
      continue;
    }

    /* Matched on studentId, never on folderId. The folder ID in a code is
       whatever existed the morning the sheet printed; the student ID is stable
       for as long as they are in the class. That difference is the whole reason
       Drive can be deferred — a term of sheets printed on placeholder folder IDs
       keeps splitting after the real ones arrive. See folder_changed below. */
    const student = byStudentId.get(parsed.studentId);
    if (!student) {
      issues.push({ kind: 'unknown_student', severity: 'error', page: page.n,
        studentId: parsed.studentId, folderId: parsed.folderId,
        message: `Page ${page.n} names student ID ${parsed.studentId}, which is not ` +
          `on this roster. Most often this is a sheet from another section that ` +
          `got into the stack.` });
      glueUnresolved(page);
      continue;
    }

    current = {
      student, studentId: parsed.studentId, runId: parsed.runId,
      /* Two folder IDs on purpose. `folderId` is where this packet GOES — the
         roster's current value, which is what filing will need. `printedFolderId`
         is what the paper actually said, kept only as evidence. Collapsing them
         would mean filing into a folder that may no longer exist, or worse, into
         a real folder from an arrangement that has since changed. */
      folderId: student.folderId, printedFolderId: parsed.folderId,
      startPage: page.n, pages: [page.n], flags: []
    };
    packets.push(current);
  }

  if (leading.length) {
    issues.push({ kind: 'leading_pages', severity: 'error', pages: leading,
      message: `${leading.length} page(s) came before the first routing code, so there ` +
        `is nothing to attribute them to. Most often this is a sheet that went through ` +
        `face-down, or a student who stapled their work on top.` });
  }

  /* Duplex means every physical sheet contributes two pages, so an odd packet has
     lost a page or swallowed a code. Cheap, and it catches a missed code on the
     LAST student, where the count check alone would not. */
  for (const packet of packets) {
    if (packet.pages.length % 2 !== 0) {
      packet.flags.push('odd_page_count');
      issues.push({ kind: 'odd_page_count', severity: 'warning',
        studentId: packet.studentId, student: name(packet.student),
        message: `${name(packet.student)} has ${packet.pages.length} pages. A duplex scan ` +
          `gives two per sheet, so an odd count means a page was dropped or a code missed.` });
    }
  }

  /* A packet that swallowed a neighbour is roughly double-sized. */
  if (packets.length > 2) {
    const lengths = packets.map((p) => p.pages.length).sort((a, b) => a - b);
    const median = lengths[Math.floor(lengths.length / 2)];
    for (const packet of packets) {
      if (packet.pages.length >= median * 2 && packet.pages.length > median + 2) {
        packet.flags.push('suspicious_length');
        issues.push({ kind: 'suspicious_length', severity: 'warning',
          studentId: packet.studentId, student: name(packet.student),
          message: `${name(packet.student)} has ${packet.pages.length} pages against a ` +
            `typical ${median}. A packet about twice the usual length has usually ` +
            `swallowed the next student, whose code went unread.` });
      }
    }
  }

  /* Same student twice. Never merged: the usual cause is a sheet that went
     through the feeder twice, or a reprint handed out alongside the original, and
     merging would interleave two runs of pages into one file with no way back.
     Two numbered parts are recoverable by hand; an interleave is not.

     (Not, as an earlier comment here claimed, because the second code might be a
     misread of a neighbour's. QR is Reed-Solomon: a damaged symbol fails to
     decode, it does not decode to a different valid payload. Worth correcting
     now the key is a short number, because that argument would otherwise sound
     newly plausible and it is still wrong.) */
  const counts = new Map();
  for (const packet of packets) {
    counts.set(packet.studentId, (counts.get(packet.studentId) || 0) + 1);
  }
  for (const [studentId, n] of counts) {
    if (n < 2) continue;
    const involved = packets.filter((p) => p.studentId === studentId);
    /* Both parts quarantine (decisions.md §28): we know whose pages these are,
       but not which run is the real submission, and picking one automatically
       is exactly the invisible judgment call this project refuses to make. */
    involved.forEach((p, i) => { p.part = i + 1; p.partsTotal = n; p.flags.push('duplicate_code'); });
    issues.push({ kind: 'duplicate_code', severity: 'error', studentId,
      student: name(involved[0].student),
      pages: involved.map((p) => p.startPage),
      message: `${name(involved[0].student)} appears ${n} times, starting at pages ` +
        `${involved.map((p) => p.startPage).join(' and ')}. Written as separate parts ` +
        `rather than merged, because a merge would interleave two runs of pages ` +
        `with no way to tell afterwards where one ended.` });
  }

  /* ── The sheet is older than the roster ──────────────────────────────────────
     A warning, emphatically not an error, because this IS the deferral working.
     The reason the join moved to studentId is so a term of sheets printed on
     placeholder folder IDs keeps splitting once the real Drive IDs arrive.
     Failing here would re-impose exactly the weld the join removed — the split
     would start refusing on the day the migration succeeded.

     But nothing structural happens invisibly (decisions.md §6), so it is said
     out loud. Once, naming everyone, following leading_pages: after a re-key
     this fires on every packet of every run for the rest of the term, and thirty
     identical warnings would make summary.warnings a number nobody reads. The
     per-packet flag is what puts it beside the right rows in the report. */
  const moved = packets.filter((p) => p.printedFolderId !== p.folderId);
  if (moved.length) {
    for (const packet of moved) packet.flags.push('folder_changed');
    issues.push({ kind: 'folder_changed', severity: 'warning',
      students: moved.map((p) => name(p.student)),
      message: `${moved.length} sheet(s) carry a folder ID the roster has since ` +
        `changed — ${moved.map((p) => `${name(p.student)} …${tail(p.printedFolderId)} ` +
        `→ …${tail(p.folderId)}`).join('; ')}. Filed to the folder the roster holds ` +
        `now. Expected when the sheets were printed before the real folders existed.` });
  }

  for (const student of roster.students) {
    if (counts.has(student.id)) continue;
    issues.push({ kind: 'missing_student', severity: 'error',
      studentId: student.id, student: name(student),
      message: `No routing code for ${name(student)} was found. Their work is most ` +
        `likely inside whichever packet came back longest.` });
  }

  const errors = issues.filter((i) => i.severity === 'error');
  return {
    packets, issues, leading,
    ok: errors.length === 0,
    summary: {
      pagesTotal: pageResults.length,
      packetsFound: packets.length,
      packetsExpected: roster.students.length,
      pagesUnmatched: leading.length,
      errors: errors.length,
      warnings: issues.length - errors.length
    }
  };
}

/* ── Which flags mean "do not file this" ─────────────────────────────────────
   decisions.md §28's table, in code. `odd_page_count` and `folder_changed` are
   deliberately absent — an off-by-one page count is a different kind of doubt
   than "which student" or "which run", and a stale folder ID is the studentId
   join (§15) working as designed, not a sign of anything wrong. Quarantining
   either would bury real misattributions in noise. */
export const QUARANTINE_FLAGS = new Set(['unresolved_page', 'duplicate_code', 'suspicious_length']);

export function isQuarantined(packet) {
  return packet.flags.some((f) => QUARANTINE_FLAGS.has(f));
}

export function name(student) {
  return `${student.last}, ${student.first}`;
}

/* Last six characters of an ID. A full Drive folder ID inside a sentence is 33
   characters of noise nobody reads; the tail is enough to tell two apart, and it
   is what the app's roster panel already shows on screen (app.js:169). */
const tail = (id) => String(id).slice(-6);

const slug = (value) => String(value).replace(/[^\w-]/g, '');

/* ── Where a packet is written ───────────────────────────────────────────────
   packets/<Last-First-id>/<runId>.pdf — a mirrored tree, so hand-filing a class
   is one drag per student instead of thirty out of one flat directory.

   Two functions rather than one joined path because the caller has to mkdir the
   directory before writing the file, and would otherwise have to take its own
   answer apart again with dirname().

   The student ID is always on the directory, not only when it is needed. A
   namesake pair, or a name written in a script the ASCII-only strip reduces to
   nothing, would otherwise share one directory and overwrite each other — and a
   rule that only appends on collision moves a student between directories the
   year a namesake joins the class.

   The folder ID is in neither half. It used to be the filename's tail, which
   welded whatever ID existed at print time onto disk permanently — the same weld
   this change just removed from the join. */
export function dirFor(packet) {
  return slug(`${packet.student.last}-${packet.student.first}-${packet.studentId}`);
}

/* `part` survives the move: a duplicate is still two files, still numbered,
   still never merged. Exported so split.mjs's unresolved/ bundles can carry
   the same suffix on a quarantined duplicate, instead of a second copy of
   this logic drifting from this one. */
export function partSuffix(packet) {
  return packet.part ? `__part${packet.part}` : '';
}

export function fileFor(packet) {
  /* runId is free text typed into the app, so it gets the same strip a name
     does. */
  return `${slug(packet.runId)}${partSuffix(packet)}.pdf`;
}
