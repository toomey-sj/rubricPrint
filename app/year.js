/* ══════════════════════════════════════════════════════════════════════════════
   The year document — classes, students, and the rules about student IDs.

   One document per school year, holding the classes and the students they point
   at. Reasoning: docs/decisions.md §20. The shape is Planbook's on purpose — a
   flat `students` array with each class holding `roster: [studentId]` — so moving
   a student between classes is list membership rather than a record that moves, a
   student in two classes exists once, and a future merge of the two apps is a
   merge rather than a translation.

   DELIBERATELY PURE: no DOM, no localStorage, no rendering. The storage layer
   lives in app.js and the screen lives in index.html. That is the same split
   tools/lib/packets.mjs has against roster.mjs, and for the same reason — every
   rule that matters here is about identity and permanence, and those are exactly
   the rules worth testing with a hand-written object in milliseconds rather than
   by clicking.

   No dependencies, no module syntax, no build step — this loads from a plain
   <script> tag in a page opened by double-clicking it (ARCH-04). The tail exports
   for Node so tools/year-test.mjs can exercise it without a browser.
   ══════════════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  'use strict';
  var Year = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = Year;
  else root.RubricYear = Year;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SCHEMA_VERSION = 1;

  /* ── Identity ─────────────────────────────────────────────────────────────── */

  /* Opaque, prefixed, never shown to anyone. CLASS ids only — student ids reach
     paper and are minted by nextGeneratedId below, under quite different rules. */
  function newId(prefix) {
    var chars = '0123456789abcdefghijklmnopqrstuvwxyz';
    var out = '';
    for (var i = 0; i < 10; i++) {
      out += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return prefix + '_' + out;
  }

  /* August rolls the year over: a roster built in late August belongs to the year
     about to start, not the one that just ended. */
  function currentSchoolYear(now) {
    var date = now || new Date();
    var start = date.getMonth() >= 7 ? date.getFullYear() : date.getFullYear() - 1;
    return start + '-' + (start + 1);
  }

  /* No folder yet. Stored as null and synthesised only at print time, so a stored
     value can never be mistaken for a real Drive ID a year from now (§20). The
     three-field payload still holds, and the split still lands, because packets
     join on studentId (§15). */
  function placeholderFolder(studentId) {
    return 'placeholder-' + studentId;
  }

  function newYearDocument(year) {
    return {
      schemaVersion: SCHEMA_VERSION,
      year: year,
      rev: 0,
      updatedAt: new Date().toISOString(),
      /* Every collection present and empty rather than absent, so no screen has to
         check whether it exists before reading it — a check that will eventually
         be forgotten somewhere. */
      classes: [],
      students: [],
      /* Monotonic, and it never goes down. See mintStudentId: the highest id
         currently present is not a safe substitute, because a student can leave
         while their printed sheets cannot. */
      lastStudentSeq: 0
    };
  }

  /* ── Migration ────────────────────────────────────────────────────────────
     Empty today, and present anyway. Retrofitting a ladder onto documents already
     sitting on someone's disk is the expensive version of this job, and it is the
     REFUSALS rather than the steps that have to exist from the first write.

     Three of them, each deliberate: a document with no schemaVersion is not
     guessed at; one from a newer build is refused rather than downgraded, because
     loading it would silently drop whatever that build added; and a gap in the
     ladder stops rather than skipping. */
  var MIGRATIONS = {};

  function migrateDocument(doc) {
    var from = doc && doc.schemaVersion;
    if (typeof from !== 'number' || !isFinite(from)) {
      throw new Error('That file has no schemaVersion, so Rubric Print will not guess ' +
        'at the shape of a class list.');
    }
    if (from > SCHEMA_VERSION) {
      throw new Error('That document was written by a newer version of Rubric Print ' +
        '(schema ' + from + ', this one reads ' + SCHEMA_VERSION + '). Update the app ' +
        'and open it again — loading it here would drop whatever the newer version added.');
    }
    var out = doc;
    var version = from;
    while (version < SCHEMA_VERSION) {
      var step = MIGRATIONS[version];
      if (typeof step !== 'function') {
        throw new Error('No migration from schema ' + version + ' to ' + (version + 1) +
          '. The document has not been changed.');
      }
      out = step(out) || out;
      version += 1;
      out.schemaVersion = version;
    }
    return out;
  }

  /* ── Classes ──────────────────────────────────────────────────────────────── */

  function activeClasses(doc) {
    return doc.classes.filter(function (c) { return !c.archived; });
  }

  function classById(doc, id) {
    var found = null;
    doc.classes.forEach(function (c) { if (c.id === id) found = c; });
    return found;
  }

  function addClass(doc, name) {
    var klass = { id: newId('c'), name: String(name).trim(), archived: false, roster: [] };
    doc.classes.push(klass);
    return klass;
  }

  /* Archiving, never deleting. It leaves the bar and keeps everything — the roster
     stays and the students stay, so a sheet already printed still splits. v1 has
     no destructive action at all, on purpose, while the store is new and the habit
     of taking an export has not formed. */
  function archiveClass(doc, id) {
    var klass = classById(doc, id);
    if (klass) klass.archived = true;
    return klass;
  }

  function studentsOf(doc, klass) {
    var byId = {};
    doc.students.forEach(function (s) { byId[s.id] = s; });
    return klass.roster.map(function (id) { return byId[id] || null; });
  }

  /* The shape the CSV and Planbook paths already produce, so everything
     downstream of commitRoster is untouched by where a roster came from. */
  function rosterFromClass(doc, classId) {
    var klass = classById(doc, classId);
    if (!klass) throw new Error('That class is no longer in this document.');

    var resolved = studentsOf(doc, klass);
    var missing = resolved.filter(function (s) { return !s; }).length;
    if (missing) {
      throw new Error(klass.name + ' lists ' + missing + ' student(s) who are not in ' +
        'this document. Restore from an export, or re-import the class.');
    }
    if (!resolved.length) throw new Error(klass.name + ' has nobody on its roster.');

    return {
      class: klass.name,
      students: resolved.map(function (s) {
        return {
          id: s.id, last: s.last, first: s.first,
          folderId: s.folderId || placeholderFolder(s.id)
        };
      }),
      source: 'Saved class · ' + klass.name +
        (resolved.every(function (s) { return !s.folderId; })
          ? ' — no portfolio folders yet' : '')
    };
  }

  /* ── Minting a student ID ─────────────────────────────────────────────────
     §21: an ID is permanent the moment it is printed, because it is inside the QR
     and the splitter joins on it. So these are never regenerated, they are unique
     across the YEAR rather than the class, and they are READABLE — `--force-code`
     makes a teacher type one off a sheet under time pressure when a code will not
     decode, and `7=2026-0042` survives that where an opaque token does not.

     The year prefix also makes a generated ID visibly not a school ID, so the two
     cannot be confused and cannot collide even by accident. */
  function generatedIdPattern(doc) {
    return new RegExp('^' + doc.year.split('-')[0] + '-(\\d{4})$');
  }

  /* A MONOTONIC COUNTER ON THE DOCUMENT, not the highest id currently present.

     Deriving the next number by scanning `students` looks equivalent and is not:
     drop the student holding 2026-0007 and the scan falls back to 0002, so the
     next few mints hand out numbers that have already been printed on paper. Two
     people's sheets then route to one packet, and nothing anywhere reports it.
     tools/year-test.mjs caught this before a single class was stored, which is
     the entire argument for year.js being pure.

     The scan survives as a floor rather than the source, so a document that was
     hand-edited — or restored from an export written before this counter existed
     — can still never reissue a number it can see. */
  function highestSeen(doc) {
    var pattern = generatedIdPattern(doc);
    var highest = 0;
    doc.students.forEach(function (s) {
      var match = pattern.exec(String(s.id));
      if (match && Number(match[1]) > highest) highest = Number(match[1]);
    });
    return highest;
  }

  function seqOf(doc) {
    return Math.max(Number(doc.lastStudentSeq) || 0, highestSeen(doc));
  }

  /* Peek: what the next one WOULD be. Used by the confirmation, which has to say
     what it is about to do before it does it (§6). Does not mutate. */
  function nextGeneratedId(doc) {
    return doc.year.split('-')[0] + '-' + ('0000' + (seqOf(doc) + 1)).slice(-4);
  }

  /* Mint: takes the number permanently. The counter moves whether or not the
     student it was minted for survives the year. */
  function mintStudentId(doc) {
    doc.lastStudentSeq = seqOf(doc) + 1;
    return doc.year.split('-')[0] + '-' + ('0000' + doc.lastStudentSeq).slice(-4);
  }

  /* How many of these would have to be minted, which is what the confirmation
     has to state before anything is written (§21, §6). */
  function needsIds(students) {
    return students.filter(function (s) { return !s.id; });
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    MIGRATIONS: MIGRATIONS,
    newId: newId,
    currentSchoolYear: currentSchoolYear,
    placeholderFolder: placeholderFolder,
    newYearDocument: newYearDocument,
    migrateDocument: migrateDocument,
    activeClasses: activeClasses,
    classById: classById,
    addClass: addClass,
    archiveClass: archiveClass,
    studentsOf: studentsOf,
    rosterFromClass: rosterFromClass,
    nextGeneratedId: nextGeneratedId,
    mintStudentId: mintStudentId,
    needsIds: needsIds
  };
});
