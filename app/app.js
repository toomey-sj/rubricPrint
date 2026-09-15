/* Rubric Print — page logic.
   Plain script inside an IIFE, no modules, no dependencies (ARCH-04, CODE-04). */
(function () {
  'use strict';

  /* The QR's position on the page, in CSS px on an 816 × 1056 sheet. This is the
     contract tools/split.mjs crops to. Derived from index.html's layout:
     48px page padding + (720px content − 94px code column) = 674. */
  var QR_BOX = { left: 674, top: 48, size: 94 };

  var state = { roster: null, planbook: null, classId: null, doc: null,
                importInto: null, front: '', back: '' };

  var $ = function (id) { return document.getElementById(id); };

  /* ── Roster ────────────────────────────────────────────────────────────────
     IMPORT is CSV, because that is what a spreadsheet exports. SAVE is JSON,
     because that is the app's own format and it survives round-tripping. Both are
     accepted here: a CSV is a fresh export, a JSON is a roster saved earlier.

     Read through FileReader, not fetch(). A file:// page cannot fetch a sibling
     file — the origin is opaque and the request is refused as cross-origin — but
     a file the user picked or dropped reads fine. */
  function loadRoster(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result);
      var looksJson = /^\s*[{[]/.test(text);
      var parsed;
      try {
        parsed = looksJson ? parseRosterJson(text) : parseRosterCsv(text);
      } catch (err) {
        return fail(err.message);
      }

      /* Aimed at a class rather than dropped in. §22's rule lives here: this is
         the path that may mint identity, and it is also the only one that writes. */
      if (state.importInto) {
        if (parsed.planbook) {
          state.importInto = null;
          return fail('That is a Planbook year backup, which holds several classes. ' +
            'Drop it on the box below to create classes from it, rather than importing ' +
            'it into one.');
        }
        return importIntoClass(parsed, state.importInto);
      }

      /* A Planbook year document holds several classes, so there is nothing to
         commit until one is chosen. Everything after this point is the same for
         all three sources, because the picker hands back the same shape. */
      if (parsed.planbook) {
        state.planbook = parsed.planbook;
        state.classId = null;

        /* Reopen the class this browser was last on, the way Planbook's own boot
           does — but only when the file is the same year, and only when that class
           is still in it and still has a roster. Anything else falls through to the
           picker rather than guessing. The choice is visible in the bar either way,
           so this is a shortcut and never a silent decision (§6). */
        var remembered = null;
        if (getPref('openYear') === parsed.planbook.year) {
          planbookClasses(parsed.planbook).forEach(function (c) {
            if (c.id === getPref('openClassId') && (c.roster || []).length) remembered = c.id;
          });
        }
        if (remembered) openPlanbookClass(remembered);
        else renderClassPicker();
        return;
      }
      state.planbook = null;
      state.classId = null;
      renderClassBar();
      commitRoster(parsed);
    };
    reader.onerror = function () { fail('Could not read that file.'); };
    reader.readAsText(file);
  }

  function commitRoster(parsed) {
    /* The splitter matches a scanned code back to a student on the student ID,
       so a blank or repeated one is a sheet that can never be filed — and a
       repeat is the worse of the two, because it files one student's work into
       another's folder with nothing looking wrong. Caught here rather than at
       the splitter, which is a term of paper too late.

       §22 IN ONE CHECK. A roster that brings its own identity may print and be
       forgotten; one whose identity the app would have to invent is kept. So
       printing straight from a file needs IDs already in it, and a blank column
       is sent to a class — where minting is confirmed, recorded, and stored. */
    var idless = parsed.students.filter(function (s) { return !s.id; });
    if (idless.length) {
      return fail(idless.length + ' student(s) have no student ID, and the routing ' +
        'code cannot be built without one. Make a class above and import this file ' +
        'into it — Rubric Print will offer to assign the missing IDs and hand you ' +
        'back the roster with them filled in. Printing straight from a file needs ' +
        'IDs that are already in it, because nothing here would remember the ones ' +
        'it made up.');
    }
    var seenIds = {};
    var repeated = [];
    parsed.students.forEach(function (s) {
      if (seenIds[s.id] && repeated.indexOf(s.id) === -1) repeated.push(s.id);
      seenIds[s.id] = true;
    });
    if (repeated.length) {
      return fail('Student ID ' + repeated.join(', ') + ' appears more than once. ' +
        'Two students sharing an ID would file into each other’s folders.');
    }

    /* A missing portfolio folder is a folder that does not exist YET, not a
       broken roster — Drive is not built, and every real roster arrives without
       one (§20). The placeholder is synthesised here, at the last moment before
       the code is drawn, so nothing upstream ever stores it. */
    parsed.students.forEach(function (s) {
      if (!s.folderId) s.folderId = Y.placeholderFolder(s.id);
    });

    state.roster = parsed;
    renderRoster();
    render();
  }

  function parseRosterJson(text) {
    var parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      throw new Error('That file is not valid JSON. ' + err.message);
    }
    if (!parsed || !Array.isArray(parsed.students) || !parsed.students.length) {
      throw new Error('That JSON has no "students" array.');
    }
    /* Checked BEFORE the roster shape, because a Planbook year document also has
       a top-level `students` array and would otherwise parse as a roster — then
       fail with "60 students have no portfolio folder", which is true and tells
       you nothing about what actually happened. */
    if (looksLikePlanbook(parsed)) return { planbook: parsed };
    parsed.source = 'JSON — a roster saved earlier';
    return parsed;
  }

  /* ── Planbook year documents ───────────────────────────────────────────────
     Planbook keeps one JSON document per school year, with its classes nested
     inside it and one flat `students` array the classes point into by id. A
     backup file from it is therefore a whole year — several classes — where the
     other two sources are exactly one class.

     Read through the same FileReader as everything else. This app still does not
     touch the network, and it never opens Planbook's IndexedDB: a backup file is
     a snapshot the teacher chose to hand over, which is the same bargain as the
     paste (decisions.md §7).

     THE JOIN IS WHAT MAKES THIS WORK AT ALL. A Planbook student has an id and no
     portfolio folder, and until the splitter matched on folderId that was fatal.
     It matches on studentId now, so the folder can be a placeholder and the split
     still lands — see decisions.md §15. */
  function looksLikePlanbook(doc) {
    return typeof doc.schemaVersion === 'number' &&
      typeof doc.year === 'string' &&
      Array.isArray(doc.classes);
  }

  function planbookClasses(doc) {
    return doc.classes.filter(function (c) { return c && !c.archived; });
  }

  function rosterFromPlanbook(doc, classId) {
    var klass = null;
    doc.classes.forEach(function (c) { if (c.id === classId) klass = c; });
    if (!klass) throw new Error('That class is no longer in this document.');

    var byId = {};
    doc.students.forEach(function (s) { byId[s.id] = s; });

    /* A roster id with no student behind it is a broken document, not a student
       to skip quietly — Planbook's own screens resolve stale ids to something
       that exists, but a sheet printed for nobody is a sheet nobody hands in. */
    var dangling = [];
    var students = [];
    (klass.roster || []).forEach(function (id) {
      var s = byId[id];
      if (!s) { dangling.push(id); return; }
      students.push({
        id: s.id,
        last: (s.last || '').trim(),
        first: (s.first || '').trim(),
        folderId: Y.placeholderFolder(s.id)
      });
    });
    if (dangling.length) {
      throw new Error(klass.name + ' lists ' + dangling.length + ' student(s) who are ' +
        'not in this document (' + dangling.join(', ') + '). Re-export the backup.');
    }
    if (!students.length) throw new Error(klass.name + ' has nobody on its roster.');

    return {
      class: klass.name,
      students: students,
      source: 'Planbook ' + doc.year + ' · ' + klass.name +
        ' — folder IDs are placeholders'
    };
  }

  /* ── Preferences ───────────────────────────────────────────────────────────
     A whitelist, and setPref refuses anything not on it. Lifted from Planbook's
     src/prefs.js, including the reason: the likely cause of an undeclared key is
     someone reaching for localStorage to stash something that belongs in a
     document. Here that would be a roster — student names and IDs — and this half
     of the project has no IndexedDB to offer instead.

     SO NOTHING HERE IS STUDENT DATA. Two ids and a year label, which is enough to
     reopen the class you were on and nothing like enough to reconstruct a class.
     The roster itself is re-read from the file every time, which also means it can
     never go stale against the Planbook document it came from.

     Every access is wrapped: a file:// page and a private window both throw. */
  var PREF_PREFIX = 'rubricprint_';
  var PREF_DEFAULTS = { openYear: '', openClassId: '', lastExportAt: '' };

  function getPref(key) {
    if (!(key in PREF_DEFAULTS)) return null;
    try {
      var raw = localStorage.getItem(PREF_PREFIX + key);
      return raw === null ? PREF_DEFAULTS[key] : JSON.parse(raw);
    } catch (err) {
      return PREF_DEFAULTS[key];
    }
  }

  function setPref(key, value) {
    if (!(key in PREF_DEFAULTS)) {
      /* Loud on purpose — see above. */
      if (window.console) console.error('prefs: refusing to write "' + key +
        '" — not a declared UI preference.');
      return false;
    }
    try {
      localStorage.setItem(PREF_PREFIX + key, JSON.stringify(value));
      return true;
    } catch (err) {
      return false;
    }
  }

  /* ── The year document, on disk ────────────────────────────────────────────
     The rules about classes, students and IDs live in app/year.js, which is pure
     so tools/year-test.mjs can exercise them without a browser. What lives HERE
     is only the I/O — the same split tools/lib/roster.mjs has against packets.mjs.

     THIS IS A DOCUMENT, NOT A PREFERENCE. It gets its own accessor rather than a
     new key on PREF_DEFAULTS, because that whitelist exists precisely to keep
     documents out of localStorage, and widening it to admit one is how it stops
     working. What justifies a document living here at all is §20: the app now
     owns the roster, and file:// has nothing better to offer. */
  var Y = window.RubricYear;
  var DOC_PREFIX = 'rubricprint_year_';

  /* Keyed per year even though there is no year picker yet, so adding one later
     is a feature rather than a migration of everyone's stored data. */
  function docKey(year) { return DOC_PREFIX + year; }

  /* ── Reading and writing ──────────────────────────────────────────────────
     A STORE THAT IS NOT STORING SAYS SO, LOUDLY AND PERMANENTLY. localStorage
     throws in a private window and can be refused for a file:// page, and a
     teacher who believes a class is saved and is wrong does not find out until
     next September. Following Planbook's save chip: red, and it STAYS red,
     because a condition that flaps is a condition nobody reads. */
  var storeBroken = null;

  function storeFailure(err) {
    storeBroken = err && err.message ? err.message : String(err);
    render();
    return false;
  }

  function listYears() {
    var years = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf(DOC_PREFIX) === 0) years.push(key.slice(DOC_PREFIX.length));
      }
    } catch (err) {
      storeFailure(err);
      return [];
    }
    return years.sort();
  }

  function readYear(year) {
    var raw;
    try {
      raw = localStorage.getItem(docKey(year));
    } catch (err) {
      storeFailure(err);
      return null;
    }
    if (raw === null) return null;
    return Y.migrateDocument(JSON.parse(raw));
  }

  /* rev and updatedAt are bumped before the write and rolled back if it fails, so
     a document in memory never claims a revision that is not on disk. */
  function writeDoc(doc) {
    var priorRev = doc.rev;
    var priorAt = doc.updatedAt;
    doc.rev = priorRev + 1;
    doc.updatedAt = new Date().toISOString();
    try {
      localStorage.setItem(docKey(doc.year), JSON.stringify(doc));
    } catch (err) {
      doc.rev = priorRev;
      doc.updatedAt = priorAt;
      return storeFailure(err);
    }
    storeBroken = null;
    return true;
  }

  /* Created LAZILY, on the first act that needs it — a class being made, or an ID
     being minted. Someone who only ever drops a roster in and prints never gets a
     store at all, which is §22's rule holding at the storage layer rather than
     only in the UI. */
  function ensureDoc() {
    if (state.doc) return state.doc;
    state.doc = Y.newYearDocument(Y.currentSchoolYear());
    writeDoc(state.doc);
    setPref('openYear', state.doc.year);
    return state.doc;
  }

  function bootStore() {
    var years = listYears();
    if (!years.length) return;
    var preferred = getPref('openYear');
    var year = years.indexOf(preferred) !== -1 ? preferred : years[years.length - 1];
    try {
      state.doc = readYear(year);
    } catch (err) {
      /* A document this build cannot read must not take the app down with it —
         drop-in print still works, and the message names the year that is stuck. */
      storeBroken = year + ': ' + err.message;
    }
  }

  /* ── The class panel ───────────────────────────────────────────────────────
     The front door (§22): saved classes first, drop-in underneath. Everything
     here writes through writeDoc, so a failed write is visible rather than a
     class that looks saved and is not. */
  function renderStoreWarning() {
    var box = $('storeWarning');
    if (!storeBroken) { box.innerHTML = ''; return; }
    /* Red and it STAYS red. A teacher who believes a class is saved and is wrong
       does not find out until next September. */
    box.innerHTML = '<div class="notice notice-bad">' +
      '<strong>Nothing is being saved on this computer.</strong>' +
      'Classes you make here will be gone when you close the tab. The usual cause is ' +
      'a private browsing window, which gives a page no storage at all. ' +
      escapeText(storeBroken) +
      '</div>';
  }

  function renderClassPanel() {
    var box = $('classPanel');
    renderStoreWarning();

    /* Nothing stored yet: one line offering the persistent path, and the dropzone
       below still does what it always did. */
    if (!state.doc || !state.doc.classes.length) {
      box.innerHTML =
        '<div class="class-list">' +
          '<div class="class-head">' +
            '<span class="class-head-title">Your classes</span>' +
          '</div>' +
          '<div class="class-row"><div class="class-row-main">' +
            '<div class="class-row-sub">No classes yet. Make one and its roster is kept ' +
            'on this computer, so printing later needs no file at all.</div>' +
          '</div></div>' +
          newClassForm() +
        '</div>';
      wireNewClassForm();
      return;
    }

    var classes = Y.activeClasses(state.doc);
    var rows = classes.map(function (c) {
      var n = c.roster.length;
      var open = c.id === state.classId && !state.planbook;
      return '<div class="class-row">' +
        '<div class="class-row-main">' +
          '<div class="class-row-name">' + escapeText(c.name) + '</div>' +
          '<div class="class-row-sub">' +
            (n ? n + ' student' + (n === 1 ? '' : 's') : 'No roster yet — import one') +
            (open ? ' · open' : '') +
          '</div>' +
        '</div>' +
        '<div class="class-row-actions">' +
          (n ? '<button class="class-action-btn' + (open ? '' : ' primary') +
               '" data-open-class="' + escapeText(c.id) + '">' +
               (open ? 'Open' : 'Print for this') + '</button>' : '') +
          '<button class="class-action-btn" data-import-class="' + escapeText(c.id) + '">' +
            (n ? 'Update roster' : 'Import roster') + '</button>' +
          '<button class="class-action-btn" data-archive-class="' + escapeText(c.id) + '">' +
            'Archive</button>' +
        '</div>' +
      '</div>';
    }).join('');

    var archived = state.doc.classes.length - classes.length;
    box.innerHTML =
      '<div class="class-list">' +
        '<div class="class-head">' +
          '<span class="class-head-title">Your classes · ' + escapeText(state.doc.year) +
            (archived ? ' · ' + archived + ' archived' : '') + '</span>' +
          '<button class="class-action-btn" id="exportYear">Export the year</button>' +
        '</div>' +
        rows +
        newClassForm() +
      '</div>';

    wireNewClassForm();
    $('exportYear').addEventListener('click', exportYear);
    bind(box, 'data-open-class', function (id) { openSavedClass(id); });
    bind(box, 'data-import-class', function (id) { pickRosterFor(id); });
    bind(box, 'data-archive-class', function (id) {
      Y.archiveClass(state.doc, id);
      writeDoc(state.doc);
      if (state.classId === id) { state.classId = null; state.roster = null; }
      renderClassPanel();
      renderClassBar();
      render();
    });
  }

  function newClassForm() {
    return '<form class="new-class-form" id="newClassForm">' +
      '<input class="new-class-input" id="newClassName" type="text" ' +
        'placeholder="Period 1 — English 10" aria-label="New class name" autocomplete="off">' +
      '<button class="class-action-btn primary" type="submit">Add a class</button>' +
    '</form>';
  }

  function wireNewClassForm() {
    $('newClassForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var name = $('newClassName').value.trim();
      if (!name) return;
      var doc = ensureDoc();
      var klass = Y.addClass(doc, name);
      writeDoc(doc);
      renderClassPanel();
      renderClassBar();
      /* Straight into picking a roster: a class with nobody in it is a half-done
         action, and the next thing anyone wants is the list of names. */
      pickRosterFor(klass.id);
    });
  }

  function bind(box, attr, fn) {
    var nodes = box.querySelectorAll('[' + attr + ']');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].addEventListener('click', function (e) {
        fn(e.currentTarget.getAttribute(attr));
      });
    }
  }

  function openSavedClass(classId) {
    var parsed;
    try {
      parsed = Y.rosterFromClass(state.doc, classId);
    } catch (err) {
      return fail(err.message);
    }
    state.planbook = null;
    state.classId = classId;
    setPref('openYear', state.doc.year);
    setPref('openClassId', classId);
    commitRoster(parsed);
    renderClassPanel();
    renderClassBar();
  }

  /* ── Importing a roster into a class ───────────────────────────────────────
     The same file picker as drop-in, aimed at a class. `state.importInto` is what
     tells the reader which of the two it is. */
  function pickRosterFor(classId) {
    state.importInto = classId;
    $('rosterFile').value = '';
    $('rosterFile').click();
  }

  function importIntoClass(parsed, classId) {
    var doc = state.doc;
    var klass = Y.classById(doc, classId);
    if (!klass) return fail('That class is no longer in this document.');

    var blank = Y.needsIds(parsed.students);

    /* §21: minting is a confirmed act, never a quiet default, because the number
       is permanent the moment it reaches paper. The confirmation states what it
       is about to do and how many, before anything is written. */
    if (blank.length) {
      return confirmMinting(parsed, klass, blank.length);
    }
    commitImport(parsed, klass, false);
  }

  function confirmMinting(parsed, klass, count) {
    $('classPanel').innerHTML =
      '<div class="notice">' +
        '<strong>' + count + ' student' + (count === 1 ? ' has' : 's have') +
          ' no student ID.</strong>' +
        'Rubric Print can assign one to each — <strong style="display:inline">' +
        escapeText(Y.nextGeneratedId(state.doc)) + '</strong> onwards, counting up.' +
        '<ul class="notice-list">' +
          '<li>The ID is printed inside the routing code, so it is <strong ' +
            'style="display:inline">permanent</strong>. A sheet already handed out ' +
            'cannot be re-numbered.</li>' +
          '<li>It is what the splitter matches a scanned page back to a student on.</li>' +
          '<li>You will get your roster back with the ID column filled in. <strong ' +
            'style="display:inline">Keep that file.</strong> It is the only way to ' +
            'rebuild the list if this computer is lost, and importing it next time ' +
            'means nothing is assigned twice.</li>' +
        '</ul>' +
        '<div class="notice-actions">' +
          '<button class="class-action-btn primary" id="mintYes">Assign ' + count +
            ' ID' + (count === 1 ? '' : 's') + ' and import</button>' +
          '<button class="class-action-btn" id="mintNo">Cancel</button>' +
        '</div>' +
      '</div>';

    $('mintYes').addEventListener('click', function () {
      commitImport(parsed, klass, true);
    });
    $('mintNo').addEventListener('click', function () {
      renderClassPanel();
    });
  }

  function commitImport(parsed, klass, minted) {
    var doc = state.doc;
    var byId = {};
    doc.students.forEach(function (s) { byId[s.id] = s; });

    var added = 0;
    var handBack = [];
    parsed.students.forEach(function (row) {
      var id = row.id || Y.mintStudentId(doc);
      if (!byId[id]) {
        /* folderId is stored as NULL when absent. The placeholder is synthesised
           at print time, so a stored value can never be read later as a real
           Drive ID (§20). */
        var student = {
          id: id, last: row.last, first: row.first,
          folderId: row.folderId || null
        };
        doc.students.push(student);
        byId[id] = student;
      }
      if (klass.roster.indexOf(id) === -1) { klass.roster.push(id); added++; }
      handBack.push({ id: id, last: row.last, first: row.first,
                      folderId: byId[id].folderId });
    });

    var ok = writeDoc(doc);
    state.importInto = null;

    /* The file goes out AT THE MOMENT the IDs exist, which is the one moment it
       is guaranteed to be complete. It cannot be verified as saved — no browser
       reports that — so it is offered and said out loud, not gated on. */
    if (minted) downloadRoster(handBack, klass.name);

    renderClassPanel();
    renderClassBar();
    openSavedClass(klass.id);
    if (minted && ok) {
      $('classPanel').insertAdjacentHTML('afterbegin',
        '<div class="notice"><strong>Your roster has been downloaded with the IDs ' +
        'filled in.</strong>Keep it somewhere you will find it again. It is the only ' +
        'record of which ID belongs to which student if this computer is lost, and ' +
        'importing that file next time is what stops anyone being assigned a second ' +
        'ID.</div>');
    }
    return added;
  }

  /* CSV out, because CSV is what came in and what a spreadsheet reads. Same
     columns the importer matches on, so the file round-trips. */
  function downloadRoster(students, className) {
    var lines = ['"Last, First",Student ID,Period,Portfolio folder ID'];
    students.forEach(function (s) {
      lines.push('"' + s.last + ', ' + s.first + '",' + s.id + ',"' + className + '",' +
        (s.folderId || ''));
    });
    save(lines.join('\n'), 'text/csv',
      slugForFile(className) + '-roster-with-ids.csv');
  }

  function exportYear() {
    save(JSON.stringify(state.doc, null, 2), 'application/json',
      'rubric-print-' + state.doc.year + '.json');
    setPref('lastExportAt', new Date().toISOString());
    renderClassPanel();
  }

  function save(text, type, filename) {
    var blob = new Blob([text], { type: type });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    /* Revoked on a later turn, not in the same task as the click — Safari has
       historically cancelled the download when it is revoked immediately. */
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 60000);
  }

  function slugForFile(name) {
    return String(name).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '') || 'class';
  }

  /* ── The class bar ─────────────────────────────────────────────────────────
     Drawn on four mockup boards and never built, which is how it came to
     contradict the notes pinned beside it. It is buildable now because a Planbook
     year document carries several classes — a CSV is exactly one, and a strip with
     one tab on it is furniture.

     It is also multi-class printing, which decisions.md listed as decided and not
     built: the assignment is scoped ABOVE the class, so switching tabs keeps the
     paste and the header fields and re-renders the sheets for the next period.
     Paste once, print several periods. */
  function renderClassBar() {
    var bar = $('classBar');
    if (!state.planbook) { bar.innerHTML = ''; return; }

    var classes = planbookClasses(state.planbook);
    bar.innerHTML = classes.map(function (c) {
      var n = (c.roster || []).length;
      var active = c.id === state.classId;
      return '<button class="cls-tab' + (active ? ' active' : '') + '" ' +
        'data-tab="' + escapeText(c.id) + '"' + (active ? ' aria-current="true"' : '') +
        (n ? '' : ' disabled') + '>' +
        escapeText(c.name) +
        '<span class="cls-tab-count">' + n + '</span>' +
      '</button>';
    }).join('') +
      '<span class="cls-tab-note">Planbook ' + escapeText(state.planbook.year) +
      ' · the prompt carries across</span>';

    var tabs = bar.querySelectorAll('[data-tab]');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function (e) {
        openPlanbookClass(e.currentTarget.getAttribute('data-tab'));
      });
    }
  }

  function openPlanbookClass(classId) {
    if (classId === state.classId) return;
    var parsed;
    try {
      parsed = rosterFromPlanbook(state.planbook, classId);
    } catch (err) {
      return fail(err.message);
    }
    state.classId = classId;
    setPref('openYear', state.planbook.year);
    setPref('openClassId', classId);
    commitRoster(parsed);
    renderClassBar();
  }

  function renderClassPicker() {
    var doc = state.planbook;
    var classes = planbookClasses(doc);
    var archived = doc.classes.length - classes.length;

    var rows = classes.map(function (c) {
      var n = (c.roster || []).length;
      return '<div class="row">' +
        '<div class="row-main">' +
          '<div class="row-name">' + escapeText(c.name) + '</div>' +
          '<div class="row-sub">' + n + ' student' + (n === 1 ? '' : 's') + '</div>' +
        '</div>' +
        (n
          ? '<button class="class-action-btn" data-class="' + escapeText(c.id) + '">Use this class</button>'
          : '<span class="badge badge-bad">✕ Empty</span>') +
      '</div>';
    }).join('');

    $('rosterList').innerHTML =
      '<div class="row" style="background:#f8f9fb;">' +
        '<div class="row-main"><div class="row-sub">' +
          'Planbook year ' + escapeText(doc.year) + ' · ' + classes.length + ' class' +
          (classes.length === 1 ? '' : 'es') +
          (archived ? ' · ' + archived + ' archived, not shown' : '') +
          '. Pick the one you are printing for.' +
        '</div></div>' +
      '</div>' + rows;

    /* Bound per render rather than delegated, matching how the roster panel's own
       Save button is wired below. */
    var buttons = $('rosterList').querySelectorAll('[data-class]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function (e) {
        openPlanbookClass(e.currentTarget.getAttribute('data-class'));
      });
    }

    $('status').className = 'save-indicator saving';
    $('status').textContent = '↻ Choose a class';
    render();
  }

  /* Quote-aware, because the column that matters most is usually called
     "Last, First" and holds values like "Shakespeare, William" — both of which
     carry a comma and would be shredded by a split(','). */
  function parseCsv(text) {
    var rows = [], row = [], field = '', quoted = false;
    var body = text.replace(/\r\n?/g, '\n');
    for (var i = 0; i < body.length; i++) {
      var ch = body[i];
      if (quoted) {
        if (ch !== '"') { field += ch; continue; }
        if (body[i + 1] === '"') { field += '"'; i++; continue; }
        quoted = false;
      } else if (ch === '"') { quoted = true; }
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else { field += ch; }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) {
      return r.some(function (f) { return f.trim() !== ''; });
    });
  }

  /* Headers are matched, not assumed. Your spreadsheet's columns are predefined so
     an export maps itself, but a sheet from a colleague will not, and the mapping
     is shown on screen so a wrong guess is visible rather than silent. */
  var COLUMN_RULES = [
    ['folderId', /folder/i],
    ['id', /^\s*(student\s*)?(id|number|no\.?)\s*$/i],
    ['name', /^\s*last\s*,\s*first\s*$|full\s*name|student\s*name|^\s*name\s*$/i],
    ['last', /^\s*(last|surname|family)\s*(name)?\s*$/i],
    ['first', /^\s*(first|given)\s*(name)?\s*$/i],
    ['klass', /period|class|section|hour/i]
  ];

  function parseRosterCsv(text) {
    var rows = parseCsv(text);
    if (rows.length < 2) throw new Error('That CSV has no rows under its header.');

    var headers = rows[0].map(function (h) { return h.trim(); });
    var map = {};
    COLUMN_RULES.forEach(function (rule) {
      if (map[rule[0]] !== undefined) return;
      headers.forEach(function (header, index) {
        if (map[rule[0]] === undefined && rule[1].test(header)) map[rule[0]] = index;
      });
    });

    /* The folder column is OPTIONAL (§20). It was required back when the splitter
       joined on folderId and a roster without one could not be routed at all;
       the join is studentId now, so a missing folder is a portfolio that does not
       exist yet rather than a broken roster. Drive is not built, and demanding a
       column for it would have made every real roster fail. */
    if (map.name === undefined && map.last === undefined) {
      throw new Error('No name column found. Columns read: ' + headers.join(', ') + '.');
    }

    var students = rows.slice(1).map(function (row, i) {
      var last = '', first = '';
      if (map.last !== undefined) {
        last = (row[map.last] || '').trim();
        first = map.first !== undefined ? (row[map.first] || '').trim() : '';
      } else {
        var whole = (row[map.name] || '').trim();
        var comma = whole.indexOf(',');
        if (comma !== -1) {
          last = whole.slice(0, comma).trim();
          first = whole.slice(comma + 1).trim();
        } else {
          var space = whole.lastIndexOf(' ');
          last = space === -1 ? whole : whole.slice(space + 1);
          first = space === -1 ? '' : whole.slice(0, space);
        }
      }
      return {
        /* Blank stays blank. Inventing String(1001 + i) here is what put two
           sections both on 1001, and it is now the confirmation's decision to
           make rather than the parser's (§21). */
        id: map.id !== undefined ? (row[map.id] || '').trim() : '',
        last: last, first: first,
        folderId: (row[map.folderId] || '').trim()
      };
    }).filter(function (s) { return s.last || s.first; });

    if (!students.length) throw new Error('That CSV has a header but no students.');

    var klass = map.klass !== undefined ? (rows[1][map.klass] || '').trim() : '';
    var used = Object.keys(map).map(function (key) {
      return key + ' ← ' + headers[map[key]];
    });
    return {
      class: klass,
      students: students,
      source: 'CSV — ' + used.join(' · ')
    };
  }

  function fail(message) {
    $('rosterList').innerHTML = '<div class="row"><span class="badge badge-bad">✕ Not loaded</span>' +
      '<div class="row-main"><div class="row-sub">' + escapeText(message) + '</div></div></div>';
    state.roster = null;
    render();
  }

  function renderRoster() {
    var html = state.roster.students.map(function (s, i) {
      var initials = (s.first[0] || '') + (s.last[0] || '');
      return '<div class="row">' +
        '<div class="avatar av' + (i % 10) + '" aria-hidden="true">' + escapeText(initials) + '</div>' +
        '<div class="row-main">' +
          '<div class="row-name">' + escapeText(s.last + ', ' + s.first) + '</div>' +
          '<div class="row-sub">ID ' + escapeText(s.id) + ' · folder …' +
            escapeText(String(s.folderId).slice(-6)) + '</div>' +
        '</div>' +
        '<span class="badge badge-ok">✓ Ready</span>' +
      '</div>';
    }).join('');
    /* Show what was read from which column. A wrong guess is then visible rather
       than silently printing someone else's name on someone else's sheet. */
    $('rosterList').innerHTML =
      '<div class="row" style="background:#f8f9fb;">' +
        '<div class="row-main"><div class="row-sub">' +
          escapeText(state.roster.source || '') +
        '</div></div>' +
        '<button class="class-action-btn" id="saveRoster">Save as JSON</button>' +
      '</div>' + html;
    $('saveRoster').addEventListener('click', saveRoster);
    $('status').className = 'save-indicator saved';
    $('status').textContent = '✓ ' + state.roster.students.length + ' students';
  }

  /* The save side of the split: import is CSV, the app's own format is JSON. */
  function saveRoster() {
    var blob = new Blob([JSON.stringify({
      class: state.roster.class,
      students: state.roster.students
    }, null, 2)], { type: 'application/json' });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'roster.json';
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /* ── Paste ─────────────────────────────────────────────────────────────────
     Google Docs puts real HTML on the clipboard, which is why this route keeps
     tables and lists. It also wraps the whole payload in
     <b id="docs-internal-guid-…" style="font-weight:normal"> — keep that <b>
     naively and the entire assignment prints bold. */
  var ALLOWED = {
    H1: 1, H2: 1, H3: 1, H4: 1, P: 1, UL: 1, OL: 1, LI: 1, BR: 1,
    STRONG: 1, EM: 1, TABLE: 1, THEAD: 1, TBODY: 1, TR: 1, TH: 1, TD: 1
  };

  function sanitize(html) {
    var box = document.createElement('div');
    box.innerHTML = html;

    Array.prototype.slice.call(box.querySelectorAll('b[id^="docs-internal-guid"]'))
      .forEach(unwrap);

    var walk = function (node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 3) return;                       // text
        if (child.nodeType !== 1) return child.remove();        // comments etc.
        walk(child);

        var tag = child.tagName;
        if (tag === 'B' || tag === 'SPAN' || tag === 'FONT') {
          var weight = child.style.fontWeight;
          var style = child.style.fontStyle;
          if (weight === 'bold' || weight === '700' || (tag === 'B' && weight !== 'normal')) {
            return rename(child, 'strong');
          }
          if (style === 'italic') return rename(child, 'em');
          return unwrap(child);
        }
        if (tag === 'I') return rename(child, 'em');
        if (!ALLOWED[tag]) return unwrap(child);
        while (child.attributes.length) child.removeAttribute(child.attributes[0].name);
      });
    };
    walk(box);

    Array.prototype.slice.call(box.querySelectorAll('p, li'))
      .forEach(function (el) { if (!el.textContent.trim() && !el.querySelector('br')) el.remove(); });

    return box.innerHTML.trim();
  }

  function unwrap(el) {
    while (el.firstChild) el.parentNode.insertBefore(el.firstChild, el);
    el.remove();
  }

  function rename(el, tag) {
    var next = document.createElement(tag);
    while (el.firstChild) next.appendChild(el.firstChild);
    el.parentNode.replaceChild(next, el);
  }

  function wirePaste(el, key) {
    el.addEventListener('paste', function (event) {
      event.preventDefault();
      var clip = event.clipboardData;
      var html = clip.getData('text/html');
      var clean = html
        ? sanitize(html)
        : '<p>' + escapeText(clip.getData('text/plain')).replace(/\n+/g, '</p><p>') + '</p>';
      el.innerHTML = clean;
      state[key] = clean;
      el.classList.toggle('filled', !!clean);
      render();
    });
    el.addEventListener('input', function () {
      state[key] = el.innerHTML.trim();
      render();
    });
  }

  /* ── Sheets ────────────────────────────────────────────────────────────────── */
  function fields() {
    return {
      course: $('fCourse').value.trim(),
      topic: $('fTopic').value.trim(),
      due: $('fDue').value.trim(),
      points: $('fPoints').value.trim(),
      handed: $('fHanded').value.trim(),
      run: $('fRun').value.trim()
    };
  }

  function render() {
    var box = $('sheets');
    box.innerHTML = '';
    updatePayloadSize();
    if (!state.roster || !state.front || !state.back) return preflight();

    var f = fields();
    state.roster.students.forEach(function (s, i) {
      box.appendChild(frontSheet(s, i, f));
      box.appendChild(backSheet(s, i, f));
    });
    preflight();
  }

  function frontSheet(s, index, f) {
    var payload = [s.folderId, f.run, s.id].join('|');
    var sheet = el('section', 'sheet');
    sheet.dataset.side = 'front';
    sheet.dataset.student = String(index);
    sheet.dataset.folder = s.folderId;
    sheet.dataset.payload = payload;

    var head = el('div', 'sheet-head');
    var id = el('div', 'sheet-head-id');
    id.appendChild(text('div', 'sheet-name', s.first + ' ' + s.last));
    id.appendChild(text('div', 'sheet-meta',
      (state.roster.class || '') + ' · ID ' + s.id));
    if (f.handed) id.appendChild(text('div', 'sheet-meta', 'Handed out ' + f.handed));
    head.appendChild(id);

    var codeBox = el('div', 'sheet-head-qr');
    codeBox.innerHTML = QR.toSvg(QR.encode(payload));
    codeBox.appendChild(text('div', 'sheet-code', f.run));
    codeBox.appendChild(text('div', 'sheet-hint', 'Keep this sheet on top of your work'));
    head.appendChild(codeBox);
    sheet.appendChild(head);

    var title = el('div', 'sheet-title');
    if (f.course) title.appendChild(text('div', 'sheet-course', f.course));
    if (f.topic) title.appendChild(text('div', 'sheet-topic', f.topic));
    title.appendChild(text('div', 'sheet-due',
      'Due ' + f.due + ' · ' + f.points + ' points · scoring on the back'));
    sheet.appendChild(title);

    var body = el('div', 'sheet-body');
    body.innerHTML = state.front;
    sheet.appendChild(body);

    sheet.appendChild(foot(s, f, 1));
    return sheet;
  }

  function backSheet(s, index, f) {
    var sheet = el('section', 'sheet');
    sheet.dataset.side = 'back';
    sheet.dataset.student = String(index);

    /* No routing code on the back, deliberately. One code per packet is what makes
       the boundary rule work; a second would start a phantom packet. */
    var head = el('div', 'sheet-back-head');
    head.appendChild(text('div', 'sheet-back-name', s.first + ' ' + s.last));
    head.appendChild(text('div', 'sheet-back-meta',
      [f.course.split(' · ')[0], f.topic].filter(Boolean).join(' · ')));
    sheet.appendChild(head);

    var body = el('div', 'sheet-body');
    body.innerHTML = state.back;
    sheet.appendChild(body);

    sheet.appendChild(foot(s, f, 2));
    return sheet;
  }

  function foot(s, f, side) {
    var box = el('div', 'sheet-foot');
    box.appendChild(text('span', '',
      s.first + ' ' + s.last + ' · ' + (f.topic || f.course) + ' · side ' + side + ' of 2'));
    box.appendChild(text('span', 'sheet-foot-code', f.run + ' · ' + s.id));
    return box;
  }

  /* ── Pre-flight ────────────────────────────────────────────────────────────
     Six checks. Together they make the duplex invariant and the splitter contract
     testable on screen, before a sheet of paper is spent. */
  function preflight() {
    var out = [];
    var sheets = Array.prototype.slice.call(document.querySelectorAll('.sheet'));

    if (!state.roster) out.push(['wait', 'Waiting for a roster.']);
    if (!state.front) out.push(['wait', 'The front is empty — paste the assignment.']);
    if (!state.back) out.push(['wait', 'The back is empty — paste the scoring.']);

    if (sheets.length) {
      var students = state.roster.students.length;

      out.push(sheets.length === students * 2
        ? ['ok', students + ' students · ' + sheets.length + ' pages · 2 per student']
        : ['bad', 'Expected ' + students * 2 + ' pages, built ' + sheets.length + '.']);

      var ordered = sheets.every(function (sheet, i) {
        return sheet.dataset.student === String(Math.floor(i / 2)) &&
          sheet.dataset.side === (i % 2 ? 'back' : 'front');
      });
      out.push(ordered
        ? ['ok', 'Fronts and backs alternate in roster order.']
        : ['bad', 'Sides are out of order — duplex would shear.']);

      var overflowing = sheets.filter(function (sheet) {
        var body = sheet.querySelector('.sheet-body');
        return body && body.scrollHeight > body.clientHeight + 1;
      });
      out.push(overflowing.length === 0
        ? ['ok', 'Every side fits its page.']
        : ['bad', overflowing.length + ' side(s) overflow and would be clipped: ' +
            overflowing.map(function (sheet) {
              var s = state.roster.students[Number(sheet.dataset.student)];
              var body = sheet.querySelector('.sheet-body');
              return s.last + ' (' + sheet.dataset.side + ', +' +
                (body.scrollHeight - body.clientHeight) + 'px)';
            }).join(', ')]);

      var codeCounts = sheets.map(function (sheet) {
        return sheet.querySelectorAll('svg[data-qr]').length;
      });
      var codesRight = codeCounts.every(function (n, i) { return n === (i % 2 ? 0 : 1); });
      out.push(codesRight
        ? ['ok', 'One routing code per sheet, on the front only.']
        : ['bad', 'A back carries a routing code — that would start a phantom packet.']);

      var positions = sheets.filter(function (sheet) { return sheet.dataset.side === 'front'; })
        .map(function (sheet) {
          var svg = sheet.querySelector('svg[data-qr]');
          var a = svg.getBoundingClientRect();
          var b = sheet.getBoundingClientRect();
          return { left: Math.round(a.left - b.left), top: Math.round(a.top - b.top),
                   size: Math.round(a.width) };
        });
      var placed = positions.every(function (p) {
        return Math.abs(p.left - QR_BOX.left) <= 1 &&
               Math.abs(p.top - QR_BOX.top) <= 1 &&
               Math.abs(p.size - QR_BOX.size) <= 1;
      });
      out.push(placed
        ? ['ok', 'Every code sits at ' + QR_BOX.left + ', ' + QR_BOX.top + ' — ' +
            'the rectangle the splitter crops to.']
        : ['bad', 'A code has moved from ' + QR_BOX.left + ', ' + QR_BOX.top + ': ' +
            JSON.stringify(positions[0]) + '. The splitter crops there — fix the ' +
            'layout or change tools/split.mjs.']);

      var tinted = [];
      sheets.forEach(function (sheet) {
        var all = [sheet].concat(Array.prototype.slice.call(sheet.querySelectorAll('*')));
        all.forEach(function (node) {
          if (node.tagName === 'svg' || node.closest('svg')) return;
          var style = getComputedStyle(node);
          var bg = style.backgroundColor;
          var opaque = bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)' &&
            bg !== 'rgb(255, 255, 255)';
          if (opaque || style.backgroundImage !== 'none') {
            tinted.push(node.className || node.tagName);
          }
        });
      });
      out.push(tinted.length === 0
        ? ['ok', 'No background fills — nothing depends on "Background graphics".']
        : ['bad', 'Background fill on: ' + tinted.slice(0, 3).join(', ') +
            '. It will not print unless the viewer ticks Background graphics.']);
    }

    var bad = out.filter(function (line) { return line[0] === 'bad'; }).length;
    var waiting = out.filter(function (line) { return line[0] === 'wait'; }).length;
    $('printBtn').disabled = bad > 0 || waiting > 0 || !sheets.length;

    $('preflight').innerHTML = out.map(function (line) {
      var badge = line[0] === 'ok' ? '<span class="badge badge-ok">✓ Ok</span>'
        : line[0] === 'bad' ? '<span class="badge badge-bad">✕ Stop</span>'
        : '<span class="badge badge-neutral">Waiting</span>';
      return '<div class="preflight-line">' + badge + '<span>' + escapeText(line[1]) + '</span></div>';
    }).join('');
  }

  function updatePayloadSize() {
    if (!state.roster) { $('payloadSize').innerHTML = '&nbsp;'; return; }
    var s = state.roster.students[0];
    var bytes = [s.folderId, fields().run, s.id].join('|').length;
    $('payloadSize').textContent = bytes + ' of 62 bytes in the code';
    $('payloadSize').style.color = bytes > 62 ? '#c0392b' : '#6b7a8d';
  }

  /* ── Helpers ───────────────────────────────────────────────────────────────── */
  function el(tag, cls) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    return node;
  }
  function text(tag, cls, value) {
    var node = el(tag, cls);
    node.textContent = value;
    return node;
  }
  function escapeText(value) {
    var node = document.createElement('div');
    node.textContent = String(value);
    return node.innerHTML;
  }

  /* ── Wiring ────────────────────────────────────────────────────────────────── */
  var drop = $('rosterDrop');
  ['dragenter', 'dragover'].forEach(function (name) {
    drop.addEventListener(name, function (e) { e.preventDefault(); drop.classList.add('over'); });
  });
  ['dragleave', 'drop'].forEach(function (name) {
    drop.addEventListener(name, function (e) { e.preventDefault(); drop.classList.remove('over'); });
  });
  drop.addEventListener('drop', function (e) {
    if (e.dataTransfer.files[0]) loadRoster(e.dataTransfer.files[0]);
  });
  drop.addEventListener('click', function () { $('rosterFile').click(); });
  $('rosterLink').addEventListener('click', function (e) { e.preventDefault(); $('rosterFile').click(); });
  $('rosterPick').addEventListener('click', function () { $('rosterFile').click(); });
  $('rosterFile').addEventListener('change', function (e) {
    if (e.target.files[0]) loadRoster(e.target.files[0]);
  });

  /* The store comes up before anything is drawn, so a saved class is the first
     thing on screen rather than appearing a beat later. */
  bootStore();
  renderClassPanel();

  /* ── Offline ───────────────────────────────────────────────────────────────
     Registered, logged on failure, and never fatal. A worker cannot register from
     `file://` or over plain http from another host, and neither case should stop
     an app that works perfectly without one — all it costs is opening offline.
     Printing day is when the network is least trustworthy, so that cost is the
     whole reason sw.js exists. */
  /* isSecureContext, not a protocol test: localhost counts as secure over plain
     http, and testing for 'https:' would make the worker unregisterable exactly
     where it is developed. */
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function (err) {
        if (window.console) {
          console.error('Rubric Print: the service worker did not register, so this ' +
            'copy will not open with the network off. Cause: ' + err.message);
        }
      });
    });
  }

  wirePaste($('pasteFront'), 'front');
  wirePaste($('pasteBack'), 'back');

  ['fCourse', 'fTopic', 'fDue', 'fPoints', 'fHanded', 'fRun'].forEach(function (id) {
    $(id).addEventListener('input', render);
  });
  $('recheck').addEventListener('click', render);
  $('printBtn').addEventListener('click', function () { window.print(); });

  /* Dev fixture. `?demo` loads the sample roster and assignment so a headless
     browser can print the sheets without a human dropping and pasting — which is
     what lets tools/verify-sheet.mjs assert "exactly 2 pages per student" before
     any paper is spent. It uses fetch(), so it only works when the page is served
     over http; opened normally from file:// this branch never runs. */
  if (/[?&]demo/.test(location.search) && location.protocol !== 'file:') {
    /* `?demo&planbook` takes the roster from a Planbook year backup instead of the
       sample CSV, and `&class=N` picks which of that year's active classes. Same
       purpose as the CSV branch: it lets verify-sheet.mjs prove that sheets driven
       off a Planbook document carry codes the splitter can actually read. */
    var wantsPlanbook = /[?&]planbook/.test(location.search);
    var classIndex = Number((/[?&]class=(\d+)/.exec(location.search) || [])[1] || 0);
    var rosterSource = wantsPlanbook
      ? fetch('../data/planbook-sample-backup.json').then(function (r) { return r.json(); })
      : fetch('../data/roster-sample.csv').then(function (r) { return r.text(); });

    Promise.all([
      rosterSource,
      fetch('../data/assignment-sample.json').then(function (r) { return r.json(); })
    ]).then(function (both) {
      if (wantsPlanbook) {
        state.planbook = both[0];
        state.classId = planbookClasses(both[0])[classIndex].id;
        state.roster = rosterFromPlanbook(both[0], state.classId);
        renderClassBar();
      } else {
        state.roster = parseRosterCsv(both[0]);
      }
      state.front = both[1].front;
      state.back = both[1].back;
      $('pasteFront').innerHTML = state.front;
      $('pasteBack').innerHTML = state.back;
      Object.keys(both[1].fields).forEach(function (key) {
        var input = $('f' + key.charAt(0).toUpperCase() + key.slice(1));
        if (input) input.value = both[1].fields[key];
      });
      renderRoster();
      render();
      document.body.dataset.demoReady = 'true';
    });
  }

  render();
})();
