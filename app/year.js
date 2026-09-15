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

  /* ── Reading a year document that came from a file ────────────────────────
     Export shipped without an import, which left the recovery path one-way. That
     matters more than it sounds: storage does not cross origins (§23), so this
     file is the ONLY bridge between localhost and the deployed site, between two
     browsers, and between a teacher's old laptop and their new one.

     BUILD, VALIDATE, THEN SWAP. Nothing is written until the whole document has
     been parsed, walked up the migration ladder, and checked against the shape
     newYearDocument() produces. A half-applied import is worse than a refused
     one, because the thing it half-replaced is the class list — so every refusal
     here leaves the store exactly as it was, and says so.

     The caller is app.js, which owns the confirmation and the write. */

  /* Array before object, because typeof [] is 'object' and that is precisely the
     confusion this check exists to catch. */
  function typeOf(value) {
    if (Array.isArray(value)) return 'array';
    if (value === null) return 'null';
    return typeof value;
  }

  /* OURS, not Planbook's, and one field decides it. Both are a year document
     with schemaVersion, year, classes and students, so telling them apart needs
     something only one of them has — and lastStudentSeq has been in
     newYearDocument since its first commit.

     DELIBERATELY NOT a shape check. Everything else about the document is
     validateYearDocument's job to report precisely; if recognition also insisted
     on `classes` being an array, an export with one damaged field would stop
     being ours and get refused as somebody else's file. */
  function looksLikeYearDocument(doc) {
    return !!doc && typeof doc === 'object' && !Array.isArray(doc) &&
      typeof doc.lastStudentSeq === 'number';
  }

  /* The year is not decoration: generatedIdPattern and mintStudentId both read
     its first half, so a document whose year is "2026" or "" mints ids like
     "2026-0001" from one file and "-0001" from another. Checked at the door
     rather than discovered on a sheet. */
  var YEAR_SHAPE = /^\d{4}-\d{4}$/;

  function validateYearDocument(doc) {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      throw new Error('That file does not hold a year document at all.');
    }

    var problems = [];

    /* Checked against a REFERENCE DOCUMENT rather than a hand-written list of
       field names, so a field added to newYearDocument() is checked for here
       without anyone having to remember to come back and add it. */
    var reference = newYearDocument('0000-0001');
    Object.keys(reference).forEach(function (key) {
      var want = typeOf(reference[key]);
      var got = typeOf(doc[key]);
      if (got !== want) {
        problems.push('"' + key + '" should be ' + want + ' and is ' + got);
      }
    });

    if (typeof doc.year === 'string' && !YEAR_SHAPE.test(doc.year)) {
      problems.push('"year" should look like 2026-2027, and is "' + doc.year + '"');
    }

    var seenClass = {};
    (Array.isArray(doc.classes) ? doc.classes : []).forEach(function (c, i) {
      var where = 'class ' + (i + 1);
      if (!c || typeof c !== 'object') { problems.push(where + ' is not a class'); return; }
      if (!c.id) problems.push(where + ' has no id');
      if (typeof c.name !== 'string' || !c.name.trim()) problems.push(where + ' has no name');
      if (!Array.isArray(c.roster)) problems.push(where + ' has no roster list');
      if (c.id && seenClass[c.id]) problems.push('two classes share the id ' + c.id);
      if (c.id) seenClass[c.id] = true;
    });

    var seenStudent = {};
    (Array.isArray(doc.students) ? doc.students : []).forEach(function (s, i) {
      var where = 'student ' + (i + 1);
      if (!s || typeof s !== 'object') { problems.push(where + ' is not a student'); return; }
      if (!s.id) problems.push(where + ' has no student ID');
      if (!String(s.last || '').trim() && !String(s.first || '').trim()) {
        problems.push(where + ' has no name');
      }
      /* The same collision roster.mjs and buildPackets check for, caught one step
         earlier: two students on one id file into each other's folders, and
         nothing about it looks wrong on paper. */
      if (s.id && seenStudent[s.id]) problems.push('two students share the ID ' + s.id);
      if (s.id) seenStudent[s.id] = true;
    });

    /* Referential integrity, refused rather than repaired. rosterFromClass
       already refuses to print a class holding an id with nobody behind it, so
       the only question is whether that is found now or at ten to eight on a
       printing morning. A file the app would not print is not a file it should
       swallow. */
    var dangling = [];
    (Array.isArray(doc.classes) ? doc.classes : []).forEach(function (c) {
      if (!c || !Array.isArray(c.roster)) return;
      c.roster.forEach(function (id) {
        if (!seenStudent[id] && dangling.indexOf(id) === -1) dangling.push(id);
      });
    });
    if (dangling.length) {
      problems.push(dangling.length + ' roster entr' + (dangling.length === 1 ? 'y names a' :
        'ies name') + ' student' + (dangling.length === 1 ? '' : 's') +
        ' who are not in the file (' + dangling.slice(0, 4).join(', ') +
        (dangling.length > 4 ? ', …' : '') + ')');
    }

    if (problems.length) {
      throw new Error('That file is not a year document this app can read: ' +
        problems.join('; ') + '.');
    }
    return doc;
  }

  /* Planbook's own fingerprint, used ONLY to say something useful when the wrong
     file is handed over. It never admits anything: what makes a document ours is
     looksLikeYearDocument above, and this runs only once that has said no. A
     backup's schemaVersion is Planbook's, so without this the ladder answers
     "written by a newer version of Rubric Print" — true, and no help at all to
     the person holding the wrong file. §18's ordering rule, a second time. */
  function looksLikePlanbookBackup(doc) {
    return !!doc && typeof doc === 'object' &&
      typeof doc.docId === 'string' &&
      Array.isArray(doc.classes) && Array.isArray(doc.students);
  }

  /* Recognise, then ladder, then validate — and recognition is the marker field
     alone. Deciding it is not ours because some other field is the wrong shape
     would hand a damaged export to the branch that tells you it is a Planbook
     backup, which is a true sentence about the wrong file. */
  function readYearDocument(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error('That file is not valid JSON. ' + err.message);
    }
    if (!looksLikeYearDocument(parsed)) {
      if (looksLikePlanbookBackup(parsed)) {
        throw new Error('That looks like a Planbook year backup, not a Rubric Print ' +
          'export. Drop it on the roster box instead, where it can create classes.');
      }
      throw new Error('That file is not a Rubric Print year export. The file to look ' +
        'for is the one named rubric-print-<year>.json.');
    }
    return validateYearDocument(migrateDocument(parsed));
  }

  /* What the confirmation has to be able to state before anything is written
     (§6): what is in the file, and — the caller supplies it — what it replaces. */
  function describeDocument(doc) {
    var active = activeClasses(doc);
    return {
      year: doc.year,
      classes: active.length,
      archived: doc.classes.length - active.length,
      students: doc.students.length,
      rev: doc.rev,
      updatedAt: doc.updatedAt
    };
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

  /* ── Add and drop ─────────────────────────────────────────────────────────
     Membership, not records. The whole reason the document has Planbook's shape
     is that a class holds `roster: [studentId]`, so moving a student between two
     classes is two list operations and the student record is never touched —
     which is what lets a student sit in two classes without existing twice.

     THE RULE UNDER ALL OF THIS (§20): dropping a student REMOVES THEM FROM THE
     ROSTER AND KEEPS THE STUDENT. Their sheets carry their ID and may be in a
     stack on a desk; if that work comes back in next week's scan, the splitter
     still has to resolve it. A dropped student who vanished from the document
     would turn a recoverable packet into `unknown_student`. */

  function studentById(doc, id) {
    var found = null;
    doc.students.forEach(function (s) { if (s.id === id) found = s; });
    return found;
  }

  /* Where a student is NOW — used to say, before a move, what it is moving them
     out of, and to explain in the add picker where somebody already is. */
  function classesOfStudent(doc, studentId) {
    return doc.classes.filter(function (c) {
      return c.roster.indexOf(studentId) !== -1;
    });
  }

  /* Appended, not sorted in. Sheets print in roster order and the stack is
     handed out by walking it, so a student who joins in October gets the last
     sheet in the pile — which is exactly where a teacher expects to find them.
     Re-sorting the whole class instead would move everyone else's position for
     the sake of one arrival. */
  function addToClass(doc, classId, studentId) {
    var klass = classById(doc, classId);
    if (!klass) throw new Error('That class is no longer in this document.');
    var student = studentById(doc, studentId);
    if (!student) {
      throw new Error('There is no student with the ID ' + studentId + ' in this year.');
    }
    if (klass.roster.indexOf(studentId) !== -1) {
      throw new Error(student.last + ', ' + student.first + ' is already in ' +
        klass.name + '.');
    }
    klass.roster.push(studentId);
    return student;
  }

  function dropFromClass(doc, classId, studentId) {
    var klass = classById(doc, classId);
    if (!klass) throw new Error('That class is no longer in this document.');
    var at = klass.roster.indexOf(studentId);
    if (at === -1) {
      throw new Error('That student is not in ' + klass.name + '.');
    }
    klass.roster.splice(at, 1);
    /* The student record stays. Deliberately no check that they are still in
       some other class: a student in no class at all is a student who left, and
       their ID has to keep resolving. */
    return studentById(doc, studentId);
  }

  /* One call rather than an add and a drop at the screen, so a move can never
     half-happen — dropped from one class and, because something threw in
     between, in neither. Add first for the same reason. */
  function moveStudent(doc, fromClassId, toClassId, studentId) {
    if (fromClassId === toClassId) {
      throw new Error('That is the class they are already in.');
    }
    var to = classById(doc, toClassId);
    if (!to) throw new Error('That class is no longer in this document.');

    /* Already in the destination: the move is just the drop. It happens — a
       student is put in the new section before anyone remembers to take them
       out of the old one. */
    var alreadyThere = to.roster.indexOf(studentId) !== -1;
    if (!alreadyThere) addToClass(doc, toClassId, studentId);
    dropFromClass(doc, fromClassId, studentId);
    return { student: studentById(doc, studentId), alreadyThere: alreadyThere };
  }

  /* Who could be added to this class: everyone in the year who is not already on
     its roster. This is also how a student dropped by mistake comes back, which
     is what makes a drop reversible without an undo stack — and is why v1 can
     have a drop at all while having no delete (§20). */
  function candidatesFor(doc, classId) {
    var klass = classById(doc, classId);
    if (!klass) throw new Error('That class is no longer in this document.');
    return doc.students.filter(function (s) {
      return klass.roster.indexOf(s.id) === -1;
    }).map(function (s) {
      return { student: s, classes: classesOfStudent(doc, s.id) };
    }).sort(function (a, b) {
      var an = (a.student.last || '') + ' ' + (a.student.first || '');
      var bn = (b.student.last || '') + ' ' + (b.student.first || '');
      return an.localeCompare(bn);
    });
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
    looksLikeYearDocument: looksLikeYearDocument,
    validateYearDocument: validateYearDocument,
    readYearDocument: readYearDocument,
    describeDocument: describeDocument,
    activeClasses: activeClasses,
    classById: classById,
    addClass: addClass,
    archiveClass: archiveClass,
    studentsOf: studentsOf,
    studentById: studentById,
    classesOfStudent: classesOfStudent,
    addToClass: addToClass,
    dropFromClass: dropFromClass,
    moveStudent: moveStudent,
    candidatesFor: candidatesFor,
    rosterFromClass: rosterFromClass,
    nextGeneratedId: nextGeneratedId,
    mintStudentId: mintStudentId,
    needsIds: needsIds
  };
});
