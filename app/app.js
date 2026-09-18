/* Rubric Print — page logic.
   Plain script inside an IIFE, no modules, no dependencies (ARCH-04, CODE-04). */
(function () {
  'use strict';

  /* The QR's position on the page, in CSS px on an 816 × 1056 sheet. This is the
     contract tools/split.mjs crops to. Derived from index.html's layout:
     48px page padding + (720px content − 94px code column) = 674. */
  var QR_BOX = { left: 674, top: 48, size: 94 };

  /* `pick` is what the last button asked the file input for — a roster for a
     class, a year file, or nothing at all, which is drop-in print. One field
     rather than a flag per destination, because two flags can disagree, and this
     one decides whether a file is written into a class or only printed from. */
  var state = { roster: null, planbook: null, classId: null, doc: null,
                pick: null, front: '', back: '', addingClass: false };

  var $ = function (id) { return document.getElementById(id); };

  /* ── Roster ────────────────────────────────────────────────────────────────
     IMPORT is CSV, because that is what a spreadsheet exports. SAVE is JSON,
     because that is the app's own format and it survives round-tripping. Both are
     accepted here: a CSV is a fresh export, a JSON is a roster saved earlier.

     Read through FileReader, not fetch(). A file:// page cannot fetch a sibling
     file — the origin is opaque and the request is refused as cross-origin — but
     a file the user picked or dropped reads fine. */
  function loadRoster(file) {
    /* Taken and cleared before the read, so a pick that was cancelled cannot stay
       armed. It used to: press Import roster for period 1, close the dialog, then
       drop a file on the box below expecting a drop-in print — and it was written
       into period 1 instead, silently, because both paths end in the same list of
       names on screen. */
    var pick = state.pick;
    state.pick = null;

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

      /* A whole year, wherever it was dropped. It is the first file a teacher
         reaches for on a new computer, and the box below is the only dropzone on
         the page, so recognising it here costs nothing and saves the one error
         message that would send them hunting for a roster they do not have. */
      if (parsed.yearExport) {
        if (pick && pick.kind === 'class') {
          return fail('That is a whole year — every class and every student in it. ' +
            'Import it with Import a year file above, which says what it would ' +
            'replace before it replaces anything. Nothing on this computer has been ' +
            'changed.');
        }
        return importYearFile(text);
      }

      /* A PLANBOOK BACKUP PICKED THROUGH IMPORT A YEAR FILE is the right file at
         the wrong button, and refusing it would be answering a question nobody
         asked. It cannot replace the year — it is Planbook's document, not this
         app's — but creating classes from it is almost certainly what the person
         holding it wanted, and that screen writes nothing until it is confirmed.
         So it opens, with a line saying what the file actually is.

         This is also the only thing that reaches that offer from here:
         parseRosterJson recognises Planbook and returns before readYearDocument
         is ever called, so year.js's own Planbook message is the module guarding
         its contract rather than a sentence any screen can show. */
      if (parsed.planbook && pick && pick.kind === 'year') {
        state.planbook = parsed.planbook;
        state.classId = null;
        renderClassPicker();
        $('classPanel').insertAdjacentHTML('afterbegin',
          '<div class="notice"><strong>That is a Planbook backup, not a Rubric Print ' +
          'year file.</strong>It cannot replace the year on this computer, because it ' +
          'is Planbook’s own document rather than this app’s. What it can do is create ' +
          'these classes here, which is below.' + UNCHANGED + '</div>');
        return;
      }

      if (pick && pick.kind === 'year') {
        return failYearImport('That is a roster, not a year file. The one to look for ' +
          'is named rubric-print-<year>.json, and it holds every class at once.');
      }

      /* Aimed at a class rather than dropped in. §22's rule lives here: this is
         the path that may mint identity, and it is also the only one that writes. */
      if (pick && pick.kind === 'class') {
        if (parsed.planbook) {
          return fail('That is a Planbook year backup, which holds several classes. ' +
            'Drop it on the box below to create classes from it, rather than importing ' +
            'it into one.');
        }
        return importIntoClass(parsed, pick.classId);
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
           so this is a shortcut and never a silent decision (§6).

           AND ONLY WHILE THIS BACKUP IS PURELY A DROP-IN. Once any of its classes
           has been created in the document there are two sources for the same
           class — the saved one and the snapshot it came from — and skipping
           straight to printing from the snapshot would be choosing the staler of
           the two on the teacher's behalf, with nothing on screen saying which
           was used. */
        var seeded = state.doc && Y.planbookPlan(state.doc, parsed.planbook)
          .classes.some(function (c) { return c.exists; });
        var remembered = null;
        if (!seeded && getPref('openYear') === parsed.planbook.year) {
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
       you nothing about what actually happened.

       And this app's OWN year export is checked before Planbook, because it is a
       year document too and satisfies looksLikePlanbook on every field. In the
       other order it opens the class picker and prints from placeholder folders,
       discarding the real ones the file is carrying. */
    if (Y.looksLikeYearDocument(parsed)) return { yearExport: true };
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
            '<div class="class-row-sub">No classes yet. Add one from the bar above, and ' +
            'its roster is kept on this computer, so printing later needs no file at all.</div>' +
          '</div></div>' +
          backupRow() +
        '</div>';
      wireBackupRow(box);
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
          /* Only once there is somebody in the year to add. On a fresh document
             it would be a button whose only answer is "nobody". */
          (state.doc.students.length
            ? '<button class="class-action-btn" data-add-class="' + escapeText(c.id) +
              '">Add students</button>' : '') +
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
        '</div>' +
        rows +
        installRow() +
        backupRow() +
      '</div>';

    wireBackupRow(box);
    wireInstallRow(box);
    bind(box, 'data-open-class', function (id) { openSavedClass(id); });
    bind(box, 'data-import-class', function (id) { pickRosterFor(id); });
    bind(box, 'data-add-class', function (id) { addStudentsTo(id); });
    bind(box, 'data-archive-class', function (id) {
      Y.archiveClass(state.doc, id);
      writeDoc(state.doc);
      if (state.classId === id) { state.classId = null; state.roster = null; }
      renderClassPanel();
      renderClassBar();
      render();
    });
  }

  /* Export exists so a year can be got back out; import is what makes that a
     round trip rather than a one-way door (§23). They belong on one row, with
     the single fact that says whether either has ever been used — because the
     honest limit on export is that a browser cannot report a download was saved
     (§21), so the app says when it last offered one and keeps saying it. */
  function backupRow() {
    var last = getPref('lastExportAt');
    var stored = state.doc && state.doc.classes.length;
    return '<div class="class-row">' +
      '<div class="class-row-main">' +
        '<div class="class-row-name">Backup and transfer</div>' +
        '<div class="class-row-sub">' + (last
          ? 'Last export offered ' + escapeText(whenText(last)) + '. That file is the ' +
            'only way to carry this year to another browser or another computer.'
          : 'No export taken on this computer. Classes here live in this browser at ' +
            'this address and nowhere else, so the export file is the only copy that ' +
            'survives a new laptop.') +
        '</div>' +
      '</div>' +
      '<div class="class-row-actions">' +
        '<button class="class-action-btn" data-import-year="1">Import a year file</button>' +
        (stored
          ? '<button class="class-action-btn' + (last ? '' : ' primary') +
            '" data-export-year="1">Export the year</button>'
          : '') +
      '</div>' +
    '</div>';
  }

  function wireBackupRow(box) {
    bind(box, 'data-import-year', function () { pickYearFile(); });
    bind(box, 'data-export-year', function () { exportYear(); });
  }

  /* ── Installing it ────────────────────────────────────────────────────────
     NOT POLISH. iOS clears a website's storage after about seven days of not
     using it, and a class list is exactly the thing nobody opens between one
     essay and the next; a home-screen install is exempt from that. So for the
     one browser where it matters most, "add to home screen" is what stops the
     year quietly disappearing over half term (§25). Planbook learned this and
     says so in its own data model.

     A ROW, NOT A BANNER, AND NOTHING TO DISMISS. The condition it reports —
     this app is not installed and there are classes in it to lose — is
     standing rather than an event, and a dismissible nag either flaps or
     teaches people to close it without reading, which is what §22 says about
     conditions nobody reads. It sits with Backup and transfer, which is the
     other half of the same worry, and it goes away when it stops being true.

     Shown only when there is something to lose. On a first visit with no
     classes there is nothing for eviction to take. */
  var installPrompt = null;

  function isInstalled() {
    return (window.matchMedia &&
        window.matchMedia('(display-mode: standalone)').matches) ||
      navigator.standalone === true;
  }

  /* iPadOS reports itself as MacIntel, so the touch count is what separates an
     iPad from a Mac. Wrong either way it costs a row of text, and right it is
     the only warning the one browser that evicts storage will ever get — Safari
     has no beforeinstallprompt to offer. */
  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function installRow() {
    if (isInstalled()) return '';
    if (location.protocol === 'file:') return '';
    if (!state.doc || !state.doc.classes.length) return '';

    /* iOS FIRST, and the two never both apply: no browser on iOS fires
       beforeinstallprompt, because every one of them is WebKit underneath. Where
       a browser says it is iOS, the home-screen instruction is the only thing
       that exempts its storage from being cleared — so it is the advice with a
       deadline attached, and it goes first. */
    if (isIOS()) {
      return '<div class="class-row">' +
        '<div class="class-row-main">' +
          '<div class="class-row-name">Add this to your home screen</div>' +
          '<div class="class-row-sub">Tap <strong style="display:inline">Share</strong>, ' +
            'then <strong style="display:inline">Add to Home Screen</strong>. ' +
            'iPhones and iPads clear a website’s stored data after about a week of not ' +
            'opening it, and an app on the home screen is exempt — so this is what keeps ' +
            'your classes here over a holiday. Take an export as well.</div>' +
        '</div>' +
      '</div>';
    }

    if (installPrompt) {
      return '<div class="class-row">' +
        '<div class="class-row-main">' +
          '<div class="class-row-name">Install it</div>' +
          '<div class="class-row-sub">Installed, it opens from an icon, works with the ' +
            'network off, and keeps your classes even if the browser clears out old ' +
            'sites. Nothing is uploaded either way.</div>' +
        '</div>' +
        '<div class="class-row-actions">' +
          '<button class="class-action-btn primary" data-install="1">Install</button>' +
        '</div>' +
      '</div>';
    }

    return '';
  }

  function wireInstallRow(box) {
    bind(box, 'data-install', function () {
      if (!installPrompt) return;
      installPrompt.prompt();
      installPrompt.userChoice.then(function () {
        /* Whatever was chosen, the browser will not offer this event again for
           this visit, so the button has to go — a button that does nothing the
           second time is worse than no button. */
        installPrompt = null;
        renderClassPanel();
      });
    });
  }

  /* The panel is redrawn only when it is showing the class list. These two fire
     whenever the browser feels like it, and one of them landing in the middle of
     a confirmation would wipe the question off the screen with the answer
     half-given. */
  function refreshPanelIfIdle() {
    if ($('classPanel').querySelector('.class-list')) renderClassPanel();
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
    refreshPanelIfIdle();
  });

  window.addEventListener('appinstalled', function () {
    installPrompt = null;
    refreshPanelIfIdle();
  });

  /* Used to be a form at the bottom of the class panel; moved into the class
     bar itself (decisions.md §29), which is also why it is a plain function
     rather than a submit handler — the bar's inline input calls it directly. */
  function createClass(name) {
    name = (name || '').trim();
    if (!name) return;
    var doc = ensureDoc();
    var klass = Y.addClass(doc, name);
    writeDoc(doc);
    renderClassPanel();
    renderClassBar();
    /* Straight into picking a roster: a class with nobody in it is a half-done
       action, and the next thing anyone wants is the list of names. */
    pickRosterFor(klass.id);
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
    /* No guard on classId already being open: unlike the Planbook path, this is
       also how a roster edit redraws the print list, and skipping it there would
       leave the sheets showing the class as it was a moment ago. */
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
    openPicker({ kind: 'class', classId: classId });
  }

  /* The box below and the two links beside it are drop-in print: nothing saved,
     nothing minted. They arm nothing, and they disarm whatever was armed. */
  function pickDropIn() {
    openPicker(null);
  }

  function openPicker(pick) {
    state.pick = pick;
    $('rosterFile').value = '';
    $('rosterFile').click();
  }

  function importIntoClass(parsed, classId) {
    var doc = state.doc;
    var klass = Y.classById(doc, classId);
    if (!klass) return fail('That class is no longer in this document.');

    /* A CLASS THAT ALREADY HAS A ROSTER IS RECONCILED, NEVER REPLACED. The fork
       is the roster being non-empty rather than a mode the user picks, because
       nobody re-importing a corrected spreadsheet thinks of themselves as
       choosing between two algorithms — and the wrong one of the two silently
       drops whoever the file left out. */
    if (klass.roster.length) {
      var plan;
      try {
        plan = Y.reconcile(doc, classId, parsed.students);
      } catch (err) {
        return failImport(err.message, function () { pickRosterFor(classId); });
      }
      return confirmReconcile(plan);
    }

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

  /* ── Re-importing into a class that already has a roster ──────────────────
     The rules are in year.js. What lives here is the proposal: every change the
     file would make, counted and named, with the drops individually ticked —
     because the drops are the half that a wholesale replace used to do silently,
     and they are the half that stops a student getting a sheet. */
  function confirmReconcile(plan) {
    var changes = plan.addNew.length + plan.addExisting.length + plan.drops.length +
      plan.renames.length + plan.folderUpdates.length;

    if (!changes) {
      $('classPanel').innerHTML =
        '<div class="notice">' +
          '<strong>That file matches ' + escapeText(plan.className) + ' exactly.</strong>' +
          'All ' + plan.keep.length + ' student' + (plan.keep.length === 1 ? '' : 's') +
          ' are already here with the same names and IDs, so there is nothing to ' +
          'change. Re-importing the same roster twice is safe and does nothing.' +
          '<div class="notice-actions">' +
            '<button class="class-action-btn primary" id="reconcileBack">Back</button>' +
          '</div>' +
        '</div>';
      $('reconcileBack').addEventListener('click', function () { renderClassPanel(); });
      return;
    }

    var sections = [];
    if (plan.addNew.length || plan.addExisting.length) {
      sections.push(listSection('To add',
        plan.addNew.map(function (e) {
          return escapeText(nameOfRow(e.row)) + ' · ID ' + escapeText(String(e.row.id)) +
            ' · new to this year';
        }).concat(plan.addExisting.map(function (e) {
          return escapeText(nameOfRow(e.row)) + ' · ID ' + escapeText(String(e.row.id)) +
            ' · already in ' + (e.classes.length
              ? escapeText(e.classes.map(function (c) { return c.name; }).join(', '))
              : 'this year, in no class');
        }))));
    }
    if (plan.renames.length) {
      sections.push(listSection('Name changes', plan.renames.map(function (r) {
        return escapeText(r.from) + ' → ' + escapeText(r.to) + ' · ID ' + escapeText(r.id);
      })));
    }
    if (plan.folderUpdates.length) {
      sections.push(listSection('Portfolio folders', plan.folderUpdates.map(function (f) {
        return escapeText(f.id) + ' · ' + (f.from ? 'changes from ' + escapeText(f.from) : 'none yet') +
          ' → ' + escapeText(f.to);
      })));
    }

    /* The drops get boxes rather than a list, because this is the one part of a
       re-import that takes something away, and the reason somebody is missing
       from a file is as often a filtered spreadsheet as a student who left. */
    var dropList = plan.drops.length
      ? '<strong style="display:block; margin-top:10px;">In ' +
          escapeText(plan.className) + ' but not in that file</strong>' +
        '<div style="margin-top:2px;">Ticked means drop. They stay in this year either ' +
        'way, with the same ID, so sheets already printed still split.</div>' +
        '<ul class="notice-list" style="list-style:none; margin-left:0;">' +
          plan.drops.map(function (d) {
            return '<li><label style="display:flex; gap:8px; align-items:baseline;">' +
              '<input type="checkbox" data-drop-id="' + escapeText(d.id) + '" checked>' +
              '<span>' + escapeText(studentLabel(d.student)) + ' · ID ' +
                escapeText(d.id) + '</span></label></li>';
          }).join('') +
        '</ul>'
      : '';

    $('classPanel').innerHTML =
      '<div class="notice">' +
        '<strong>Update ' + escapeText(plan.className) + ' from that file?</strong>' +
        'Matched on student ID: ' + plan.keep.length + ' of the ' + plan.rows +
        ' row' + (plan.rows === 1 ? '' : 's') + ' in the file ' +
        (plan.keep.length === 1 ? 'is' : 'are') + ' already on this roster and ' +
        (plan.keep.length === 1 ? 'is' : 'are') + ' left alone. Nothing is re-numbered.' +
        sections.join('') +
        dropList +
        '<div class="notice-actions">' +
          '<button class="class-action-btn primary" id="reconcileYes">Apply</button>' +
          '<button class="class-action-btn" id="reconcileNo">Cancel</button>' +
        '</div>' +
      '</div>';

    var boxes = $('classPanel').querySelectorAll('[data-drop-id]');
    var ticked = function () {
      var out = [];
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].checked) out.push(boxes[i].getAttribute('data-drop-id'));
      }
      return out;
    };
    /* The button says what it is about to do, and keeps saying it as the boxes
       change — a count that goes stale while somebody unticks is worse than no
       count at all. */
    var recount = function () {
      var adds = plan.addNew.length + plan.addExisting.length;
      var drops = ticked().length;
      var parts = [];
      if (adds) parts.push('add ' + adds);
      if (drops) parts.push('drop ' + drops);
      if (plan.renames.length) parts.push('rename ' + plan.renames.length);
      $('reconcileYes').textContent = parts.length
        ? 'Apply — ' + parts.join(', ') : 'Apply';
    };
    for (var i = 0; i < boxes.length; i++) boxes[i].addEventListener('change', recount);
    recount();

    $('reconcileYes').addEventListener('click', function () {
      var result;
      try {
        result = Y.applyReconcile(state.doc, plan, ticked());
      } catch (err) {
        return fail(err.message);
      }
      var ok = writeDoc(state.doc);
      state.classId = plan.classId;
      var said = [];
      if (result.added) said.push(result.added + ' added');
      if (result.dropped) said.push(result.dropped + ' dropped');
      if (result.renamed) said.push(result.renamed + ' renamed');
      afterRosterChange(ok, escapeText(plan.className) + ' updated — ' +
        (said.length ? said.join(', ') : 'nothing changed') + '. ' + result.kept +
        ' student' + (result.kept === 1 ? '' : 's') + ' matched on ID and kept the ' +
        'ID they already had.');
    });
    $('reconcileNo').addEventListener('click', function () { renderClassPanel(); });
  }

  function listSection(title, items) {
    return '<strong style="display:block; margin-top:10px;">' + title + ' · ' +
      items.length + '</strong>' +
      '<ul class="notice-list">' +
        items.map(function (line) { return '<li>' + line + '</li>'; }).join('') +
      '</ul>';
  }

  function nameOfRow(row) {
    return String(row.last || '').trim() + ', ' + String(row.first || '').trim();
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
    exportDocument(state.doc);
    renderClassPanel();
  }

  /* Takes the document rather than reading state, because the import confirmation
     offers to export the year it is about to REPLACE, and that is not always the
     year currently open. */
  function exportDocument(doc) {
    save(JSON.stringify(doc, null, 2), 'application/json',
      'rubric-print-' + doc.year + '.json');
    setPref('lastExportAt', new Date().toISOString());
  }

  /* ── Importing a year file ────────────────────────────────────────────────
     The other half of export, and not bookkeeping: storage does not cross
     origins (§23), so this file is the only bridge between localhost and the
     deployed site, between two browsers, and between an old laptop and a new
     one. Without it the recovery path is one-way.

     BUILD, VALIDATE, THEN SWAP — year.js does the first two and throws, and
     nothing here writes until it has returned. Every refusal ends with the same
     sentence, because the one question a teacher has at that moment is whether
     the classes they already had are still there. */
  var UNCHANGED = ' Nothing on this computer has been changed.';

  function pickYearFile() {
    openPicker({ kind: 'year' });
  }

  function importYearFile(text) {
    var incoming;
    try {
      incoming = Y.readYearDocument(text);
    } catch (err) {
      return failYearImport(err.message);
    }
    confirmYearImport(incoming);
  }

  function failYearImport(message) {
    failImport(message, pickYearFile);
  }

  /* A refused import must not take the open class off the screen with it. fail()
     writes into the roster list and clears state.roster, which is right for a
     file that WAS going to be the roster and wrong for one that was an update to
     a class already open — there, the print list on screen is still true, and
     wiping it would say the opposite of what the message says. */
  function failImport(message, retry) {
    $('classPanel').innerHTML =
      '<div class="notice notice-bad">' +
        '<strong>That file was not imported.</strong>' +
        escapeText(message) + UNCHANGED +
        '<div class="notice-actions">' +
          '<button class="class-action-btn primary" id="importRetry">Choose another file</button>' +
          '<button class="class-action-btn" id="importBack">Back</button>' +
        '</div>' +
      '</div>';
    $('importRetry').addEventListener('click', function () { retry(); });
    $('importBack').addEventListener('click', function () { renderClassPanel(); });
  }

  /* §6, at its most literal. An import replaces a whole year, so the confirmation
     states what is in the file AND what is on this computer, in the same counts,
     before either is touched. */
  function confirmYearImport(incoming) {
    var into = Y.describeDocument(incoming);

    var existing = null;
    var unreadable = '';
    try {
      existing = readYear(incoming.year);
    } catch (err) {
      /* A stored document this build cannot read is still a document, and
         replacing it is still a replacement. Said out loud rather than reported
         as "nothing is replaced", which would be false at the worst moment. */
      unreadable = err.message;
    }
    var replaced = existing ? Y.describeDocument(existing) : null;
    var others = listYears().filter(function (y) { return y !== incoming.year; });

    var points = [];
    if (replaced) {
      points.push('<li>This <strong style="display:inline">replaces</strong> the ' +
        escapeText(incoming.year) + ' already on this computer — ' +
        countPhrase(replaced) + ', last changed ' + whenText(replaced.updatedAt) +
        '. Export that first if you are not certain this file is the newer one.</li>');
    } else if (unreadable) {
      points.push('<li>This replaces a ' + escapeText(incoming.year) +
        ' that is on this computer and cannot be read by this version of the app (' +
        escapeText(unreadable) + '). Replacing it is the usual fix.</li>');
    } else {
      points.push('<li>There is no ' + escapeText(incoming.year) +
        ' on this computer yet, so nothing is replaced.</li>');
    }
    if (others.length) {
      points.push('<li>The other year' + (others.length === 1 ? '' : 's') +
        ' stored here — ' + escapeText(others.join(', ')) + ' — ' +
        (others.length === 1 ? 'is' : 'are') + ' left alone.</li>');
    }
    /* Said out loud because it is the whole reason the file is worth keeping: the
       ids in it are the ids on the paper in the stack. */
    points.push('<li>Student IDs come across exactly as the file has them. Nothing ' +
      'is re-numbered, so sheets already printed still split (§21).</li>');

    $('classPanel').innerHTML =
      '<div class="notice">' +
        '<strong>Import the year ' + escapeText(incoming.year) + '?</strong>' +
        'The file holds ' + countPhrase(into) +
        (into.archived ? ', plus ' + into.archived + ' archived class' +
          (into.archived === 1 ? '' : 'es') : '') +
        ', last changed ' + whenText(into.updatedAt) + '.' +
        '<ul class="notice-list">' + points.join('') + '</ul>' +
        '<div class="notice-actions">' +
          '<button class="class-action-btn primary" id="yearYes">' +
            (replaced || unreadable ? 'Replace ' + escapeText(incoming.year) : 'Import it') +
          '</button>' +
          (existing ? '<button class="class-action-btn" id="yearExportFirst">' +
            'Export what is here first</button>' : '') +
          '<button class="class-action-btn" id="yearNo">Cancel</button>' +
        '</div>' +
      '</div>';

    $('yearYes').addEventListener('click', function () { commitYearImport(incoming); });
    $('yearNo').addEventListener('click', function () { renderClassPanel(); });
    if (existing) {
      $('yearExportFirst').addEventListener('click', function () {
        exportDocument(existing);
        /* The confirmation stays up. Taking a download is not deciding, and a
           panel that closed itself here would read as the import having run. */
      });
    }
  }

  function commitYearImport(incoming) {
    state.doc = incoming;
    var ok = writeDoc(incoming);

    /* Whatever was open belonged to the document that has just been replaced.
       Cleared rather than re-resolved, because a class id that exists in both
       files is a coincidence and not a match. */
    state.planbook = null;
    state.classId = null;
    state.roster = null;
    setPref('openYear', incoming.year);
    setPref('openClassId', '');
    $('rosterList').innerHTML = '';
    $('status').className = 'save-indicator waiting';
    $('status').textContent = 'Waiting for a roster';

    renderClassPanel();
    renderClassBar();
    render();

    $('classPanel').insertAdjacentHTML('afterbegin', ok
      ? '<div class="notice"><strong>' + escapeText(incoming.year) + ' imported — ' +
        countPhrase(Y.describeDocument(incoming)) + '.</strong>' +
        'It is stored in this browser, at this address, and nowhere else. Opened ' +
        'anywhere else — another browser, another computer, or the same app from a ' +
        'file — it will not be there until this file is imported again (§23).</div>'
      : '<div class="notice notice-bad"><strong>Imported, but not saved.</strong>' +
        'The classes are on screen and will be gone when this tab closes, because ' +
        'this browser is refusing to store anything. The file you imported is ' +
        'untouched — keep it.</div>');
  }

  function countPhrase(described) {
    return described.classes + ' class' + (described.classes === 1 ? '' : 'es') +
      ' and ' + described.students + ' student' + (described.students === 1 ? '' : 's');
  }

  /* Date only. A time of day implies a precision that a file carried between two
     computers does not have. */
  function whenText(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return 'at an unknown date';
    return date.toLocaleDateString(undefined,
      { year: 'numeric', month: 'short', day: 'numeric' });
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

  /* ── Add and drop, on screen ──────────────────────────────────────────────
     The rules are in year.js; what lives here is the asking. Roster membership
     is structural, so none of it happens on one click — the class a student is
     moved into is chosen from a list that names what they are being moved out
     of, and a drop is confirmed with the thing that makes it safe said out loud:
     the student stays in the document, so a sheet already printed still splits.

     Every one of these writes through writeDoc, so a store that is refusing to
     save says so rather than showing a roster change that is not on disk. */

  /* A saved class, open for printing — as opposed to a Planbook tab or a
     dropped-in roster, neither of which this app may edit. */
  function openSavedClass_() {
    if (!state.doc || !state.classId || state.planbook) return null;
    return Y.classById(state.doc, state.classId);
  }

  function rosterRowActions(studentId) {
    var klass = openSavedClass_();
    if (!klass) return '';
    var elsewhere = Y.activeClasses(state.doc).length > 1;
    return '<div class="row-actions">' +
      (elsewhere ? '<button class="class-action-btn" data-move-student="' +
        escapeText(studentId) + '">Move</button>' : '') +
      '<button class="class-action-btn" data-drop-student="' +
        escapeText(studentId) + '">Drop</button>' +
    '</div>';
  }

  function wireRosterRowActions(box) {
    bind(box, 'data-move-student', function (id) { chooseMoveTarget(id); });
    bind(box, 'data-drop-student', function (id) { confirmDrop(id); });
  }

  function studentLabel(student) {
    return student ? (student.last + ', ' + student.first) : 'that student';
  }

  function confirmDrop(studentId) {
    var klass = openSavedClass_();
    if (!klass) return;
    var student = Y.studentById(state.doc, studentId);

    $('classPanel').innerHTML =
      '<div class="notice">' +
        '<strong>Drop ' + escapeText(studentLabel(student)) + ' from ' +
          escapeText(klass.name) + '?</strong>' +
        '<ul class="notice-list">' +
          '<li>They stay in this year, with the same student ID. Sheets already ' +
            'printed for them still split (§20).</li>' +
          '<li>They stop getting a sheet when this class prints.</li>' +
          '<li>Add them back any time with <strong style="display:inline">Add ' +
            'students</strong> on the class — nothing is destroyed here.</li>' +
        '</ul>' +
        '<div class="notice-actions">' +
          '<button class="class-action-btn primary" id="dropYes">Drop from ' +
            escapeText(klass.name) + '</button>' +
          '<button class="class-action-btn" id="dropNo">Cancel</button>' +
        '</div>' +
      '</div>';

    $('dropYes').addEventListener('click', function () {
      var dropped;
      try {
        dropped = Y.dropFromClass(state.doc, klass.id, studentId);
      } catch (err) {
        return fail(err.message);
      }
      var ok = writeDoc(state.doc);
      afterRosterChange(ok, escapeText(studentLabel(dropped)) + ' is no longer in ' +
        escapeText(klass.name) + '. They are still in this year and can be added back.');
    });
    $('dropNo').addEventListener('click', function () { renderClassPanel(); });
  }

  /* The destination IS the confirmation — a list of classes, each naming what the
     student is being moved out of. A dropdown that applied on change would make
     a structural edit out of a mis-click. */
  function chooseMoveTarget(studentId) {
    var klass = openSavedClass_();
    if (!klass) return;
    var student = Y.studentById(state.doc, studentId);
    var targets = Y.activeClasses(state.doc).filter(function (c) { return c.id !== klass.id; });

    $('classPanel').innerHTML =
      '<div class="notice">' +
        '<strong>Move ' + escapeText(studentLabel(student)) + ' out of ' +
          escapeText(klass.name) + ' — into which class?</strong>' +
        'The student record does not move; only which roster they are on. Their ID ' +
        'stays the same, so sheets already printed still split.' +
        '<div class="notice-actions">' +
          targets.map(function (c) {
            return '<button class="class-action-btn" data-move-to="' + escapeText(c.id) +
              '">' + escapeText(c.name) +
              (c.roster.indexOf(studentId) !== -1 ? ' · already in it' : '') + '</button>';
          }).join('') +
          '<button class="class-action-btn" id="moveNo">Cancel</button>' +
        '</div>' +
      '</div>';

    bind($('classPanel'), 'data-move-to', function (toId) {
      var result;
      try {
        result = Y.moveStudent(state.doc, klass.id, toId, studentId);
      } catch (err) {
        return fail(err.message);
      }
      var ok = writeDoc(state.doc);
      var to = Y.classById(state.doc, toId);
      afterRosterChange(ok, escapeText(studentLabel(result.student)) +
        (result.alreadyThere
          ? ' was already in ' + escapeText(to.name) + ', so they have only been taken ' +
            'out of ' + escapeText(klass.name) + '.'
          : ' has moved from ' + escapeText(klass.name) + ' to ' + escapeText(to.name) + '.'));
    });
    $('moveNo').addEventListener('click', function () { renderClassPanel(); });
  }

  /* Adding is a list with boxes rather than one student at a time, because the
     real case is a timetable change that moved four people at once. It is also
     the way back from a drop, which is what lets a drop exist in an app that has
     no delete (§20). */
  function addStudentsTo(classId) {
    var klass = Y.classById(state.doc, classId);
    if (!klass) return fail('That class is no longer in this document.');
    var options = Y.candidatesFor(state.doc, classId);

    if (!options.length) {
      $('classPanel').innerHTML =
        '<div class="notice">' +
          '<strong>Everyone in ' + escapeText(state.doc.year) + ' is already in ' +
            escapeText(klass.name) + '.</strong>' +
          'To bring in a student this year has never seen, import a roster into the ' +
          'class — that is the path that can assign an ID, and it asks first.' +
          '<div class="notice-actions">' +
            '<button class="class-action-btn primary" id="addImport">Import a roster</button>' +
            '<button class="class-action-btn" id="addNo">Back</button>' +
          '</div>' +
        '</div>';
      $('addImport').addEventListener('click', function () { pickRosterFor(classId); });
      $('addNo').addEventListener('click', function () { renderClassPanel(); });
      return;
    }

    $('classPanel').innerHTML =
      '<div class="notice">' +
        '<strong>Add to ' + escapeText(klass.name) + '</strong>' +
        'Everyone in ' + escapeText(state.doc.year) + ' who is not already on this ' +
        'roster. Where they are now is shown, because a student can be in two classes ' +
        'at once and that should be a choice rather than a surprise.' +
        '<ul class="notice-list" style="list-style:none; margin-left:0;">' +
          options.map(function (o) {
            return '<li><label style="display:flex; gap:8px; align-items:baseline;">' +
              '<input type="checkbox" data-add-id="' + escapeText(o.student.id) + '">' +
              '<span><strong style="display:inline">' +
                escapeText(studentLabel(o.student)) + '</strong> · ID ' +
                escapeText(o.student.id) + ' · ' +
                (o.classes.length
                  ? 'in ' + escapeText(o.classes.map(function (c) { return c.name; }).join(', '))
                  : 'in no class') +
              '</span></label></li>';
          }).join('') +
        '</ul>' +
        '<div class="notice-actions">' +
          '<button class="class-action-btn primary" id="addYes" disabled>Add nobody</button>' +
          '<button class="class-action-btn" id="addNo">Cancel</button>' +
        '</div>' +
      '</div>';

    var boxes = $('classPanel').querySelectorAll('[data-add-id]');
    var count = function () {
      var picked = [];
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].checked) picked.push(boxes[i].getAttribute('data-add-id'));
      }
      return picked;
    };
    /* The button counts what it is about to do, and says so before it does it
       (§6) — including when that is nothing. */
    var recount = function () {
      var n = count().length;
      $('addYes').disabled = n === 0;
      $('addYes').textContent = n === 0 ? 'Add nobody'
        : 'Add ' + n + ' student' + (n === 1 ? '' : 's');
    };
    for (var i = 0; i < boxes.length; i++) boxes[i].addEventListener('change', recount);

    $('addYes').addEventListener('click', function () {
      var picked = count();
      if (!picked.length) return;
      var added = [];
      try {
        picked.forEach(function (id) { added.push(Y.addToClass(state.doc, classId, id)); });
      } catch (err) {
        return fail(err.message);
      }
      var ok = writeDoc(state.doc);
      /* Opening the class is the point of adding to it, so the change lands on
         the print list rather than only in the panel. */
      state.classId = classId;
      afterRosterChange(ok, added.length + ' student' + (added.length === 1 ? '' : 's') +
        ' added to ' + escapeText(klass.name) + ' — ' +
        escapeText(added.map(studentLabel).join('; ')) + '. They print at the end of ' +
        'the stack, which is where a teacher looks for somebody who joined in October.');
    });
    $('addNo').addEventListener('click', function () { renderClassPanel(); });
  }

  /* One way back from every roster edit: rebuild the class panel, reopen the
     class if it still has anybody, and say what happened. The message goes in
     last, because openSavedClass redraws the panel it would otherwise sit in. */
  function afterRosterChange(ok, message) {
    var klass = state.classId ? Y.classById(state.doc, state.classId) : null;

    if (klass && klass.roster.length) {
      openSavedClass(state.classId);
    } else {
      /* A class emptied to nothing is not an error — it is a class waiting for a
         roster. rosterFromClass refuses to print it, which is right, but that
         refusal is not the message to show for a drop somebody just made. */
      state.roster = null;
      $('rosterList').innerHTML = '';
      $('status').className = 'save-indicator waiting';
      $('status').textContent = 'Waiting for a roster';
      renderClassPanel();
      renderClassBar();
      render();
    }

    $('classPanel').insertAdjacentHTML('afterbegin', ok
      ? '<div class="notice">' + message + '</div>'
      : '<div class="notice notice-bad"><strong>Changed on screen, but not saved.</strong>' +
        message + ' This browser is refusing to store anything, so it will be gone when ' +
        'the tab closes.</div>');
  }

  /* ── The class bar ─────────────────────────────────────────────────────────
     Drawn on four mockup boards and never built, which is how it came to
     contradict the notes pinned beside it. It is buildable now because a Planbook
     year document carries several classes — a CSV is exactly one.

     It is also multi-class printing, which decisions.md listed as decided and not
     built: the assignment is scoped ABOVE the class, so switching tabs keeps the
     paste and the header fields and re-renders the sheets for the next period.
     Paste once, print several periods. */
  /* TWO SOURCES, ONE STRIP, and never both at once. §19 built this for a loaded
     Planbook document and said in its title that it was "the loaded year, not a
     saved list" — which was true on the day, because the only thing that carried
     several classes was a file held in memory and the note beside it still said
     THE ROSTER IS ALWAYS IMPORTED. §20 reversed that premise the next day and
     this guard outlived it: saved classes are now the usual several-class case,
     and they were the one case with no way to switch between them.

     A loaded backup still wins the strip while it is on screen, because that is
     the document being looked at. Once it is put away (§27) the saved classes
     are the only source, which is the state most printing happens in. */
  /* ALWAYS DRAWN NOW, at any class count — decisions.md §29 amends §19's "a strip
     with one tab on it is furniture." That was true of a strip that only ever
     switched between classes; it stopped being true once the bar became the one
     place a class gets ADDED too, via the dashed slot the mockups always drew
     here (mockups/parts/book.css `.cls-tab-add`) and this build never wired up.
     Zero classes is `+ Add a class` on its own; one or more is real tabs plus a
     short `+`, matching Planbook's own strip. */
  function renderClassBar() {
    var bar = $('classBar');
    var tabs;
    var note;

    if (state.planbook) {
      tabs = planbookClasses(state.planbook).map(function (c) {
        return { id: c.id, name: c.name, count: (c.roster || []).length };
      });
      note = 'Planbook ' + state.planbook.year + ' · the prompt carries across';
    } else if (state.doc) {
      tabs = Y.activeClasses(state.doc).map(function (c) {
        return { id: c.id, name: c.name, count: c.roster.length };
      });
      note = state.doc.year + ' · the prompt carries across';
    } else {
      tabs = [];
    }

    var addSlot = state.addingClass
      ? '<form class="cls-tab-add-form" id="clsTabAddForm">' +
          '<input class="cls-tab-add-input" id="clsTabAddInput" type="text" ' +
            'placeholder="Period 1 — English 10" aria-label="New class name" autocomplete="off">' +
        '</form>'
      : '<button class="cls-tab cls-tab-add" id="clsTabAddBtn" type="button">' +
          (tabs.length ? '+' : '+ Add a class') +
        '</button>';

    bar.innerHTML = tabs.map(function (c) {
      var active = c.id === state.classId;
      return '<button class="cls-tab' + (active ? ' active' : '') + '" ' +
        'data-tab="' + escapeText(c.id) + '"' + (active ? ' aria-current="true"' : '') +
        (c.count ? '' : ' disabled') + '>' +
        escapeText(c.name) +
        '<span class="cls-tab-count">' + c.count + '</span>' +
      '</button>';
    }).join('') + addSlot +
      (note ? '<span class="cls-tab-note">' + escapeText(note) + '</span>' : '');

    var nodes = bar.querySelectorAll('[data-tab]');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].addEventListener('click', function (e) {
        var id = e.currentTarget.getAttribute('data-tab');
        if (state.planbook) openPlanbookClass(id);
        else openSavedClass(id);
      });
    }

    if (state.addingClass) {
      var input = $('clsTabAddInput');
      input.focus();
      $('clsTabAddForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var name = input.value.trim();
        state.addingClass = false;
        if (name) createClass(name);
        else renderClassBar();
      });
      /* Losing focus with nothing typed collapses the slot back to the button.
         A blur mid-type is not a cancel — Escape is the explicit one — so a stray
         click elsewhere while typing a name does not throw the name away. */
      input.addEventListener('blur', function () {
        if (!input.value.trim()) { state.addingClass = false; renderClassBar(); }
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') { state.addingClass = false; renderClassBar(); }
      });
    } else {
      $('clsTabAddBtn').addEventListener('click', function () {
        state.addingClass = true;
        renderClassBar();
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

  /* ── A Planbook backup, offered as classes to create ──────────────────────
     THIS IS A CHANGE OF PURPOSE. A backup used to be browsed and printed from,
     saving nothing; now the first thing it offers is to create its classes in
     this year, fully populated. Printing one without saving is still there on
     every row, because §22 keeps that path for a roster that brings its own
     identity — but it is the smaller of the two now, the same way drop-in went
     underneath the class list.

     The screen lives in the class panel rather than the roster list because
     everything it does writes to the document, and every other thing that writes
     to the document asks from here. */
  function renderClassPicker() {
    var pb = state.planbook;
    var plan = Y.planbookPlan(state.doc || Y.newYearDocument(pb.year), pb);
    var archived = pb.classes.length - plan.classes.length;
    var creatable = plan.classes.filter(function (c) { return !c.exists && c.count; });

    var rows = plan.classes.map(function (c) {
      var note;
      if (!c.count) note = 'No students in the backup';
      else if (c.exists) note = c.count + ' student' + (c.count === 1 ? '' : 's') +
        ' · already created from this backup';
      else note = c.count + ' student' + (c.count === 1 ? '' : 's') +
        (c.nameClash ? ' · there is already a class called ' + escapeText(c.nameClash) +
          ', and this would be a second one' : '');

      return '<li style="margin-top:6px;">' +
        '<label style="display:flex; gap:8px; align-items:baseline;">' +
          (c.exists || !c.count
            ? '<span style="width:13px;">&nbsp;</span>'
            : '<input type="checkbox" data-seed-id="' + escapeText(c.id) + '" checked>') +
          '<span><strong style="display:inline">' + escapeText(c.name) + '</strong> · ' +
            note + '</span>' +
        '</label>' +
        '<span class="notice-actions" style="margin-top:4px;">' +
          (c.exists
            ? '<button class="class-action-btn" data-pb-update="' + escapeText(c.id) +
              '">Update it from this backup</button>' : '') +
          (c.count
            ? '<button class="class-action-btn" data-pb-print="' + escapeText(c.id) +
              '">Print without saving</button>' : '') +
        '</span>' +
      '</li>';
    }).join('');

    $('rosterList').innerHTML = '';
    $('classPanel').innerHTML =
      '<div class="notice">' +
        '<strong>Planbook ' + escapeText(pb.year) + ' · ' + plan.classes.length +
          ' class' + (plan.classes.length === 1 ? '' : 'es') +
          (archived ? ', and ' + archived + ' archived that are not shown' : '') +
        '</strong>' +
        'Create them here and the rosters are kept on this computer, so printing in ' +
        'November needs no file at all. <strong style="display:inline">Planbook’s ' +
        'student IDs come across unchanged</strong>, which is what makes a later ' +
        'update match the same students instead of duplicating everybody. Portfolio ' +
        'folders are left empty — Planbook has none to give.' +
        '<ul class="notice-list" style="list-style:none; margin-left:0;">' + rows + '</ul>' +
        '<div class="notice-actions">' +
          (creatable.length
            ? '<button class="class-action-btn primary" id="seedYes">Create</button>' : '') +
          '<button class="class-action-btn" id="seedNo">' +
            (state.doc && state.doc.classes.length ? 'Back to my classes' : 'Cancel') +
          '</button>' +
        '</div>' +
      '</div>';

    var boxes = $('classPanel').querySelectorAll('[data-seed-id]');
    var ticked = function () {
      var out = [];
      for (var i = 0; i < boxes.length; i++) {
        if (boxes[i].checked) out.push(boxes[i].getAttribute('data-seed-id'));
      }
      return out;
    };
    if (creatable.length) {
      var recount = function () {
        var n = ticked().length;
        $('seedYes').disabled = n === 0;
        $('seedYes').textContent = n === 0 ? 'Create nothing'
          : 'Create ' + n + ' class' + (n === 1 ? '' : 'es');
      };
      for (var i = 0; i < boxes.length; i++) boxes[i].addEventListener('change', recount);
      recount();
      $('seedYes').addEventListener('click', function () { seedClasses(ticked()); });
    }

    $('seedNo').addEventListener('click', function () {
      state.planbook = null;
      renderClassBar();
      renderClassPanel();
    });
    bind($('classPanel'), 'data-pb-print', function (id) { openPlanbookClass(id); });
    bind($('classPanel'), 'data-pb-update', function (id) { updateFromPlanbook(id); });

    $('status').className = 'save-indicator saving';
    $('status').textContent = '↻ Choose a class';
    render();
  }

  function seedClasses(classIds) {
    if (!classIds.length) return;
    var doc = ensureDoc();
    var summary;
    try {
      summary = Y.seedFromPlanbook(doc, state.planbook, classIds);
    } catch (err) {
      return failImport(err.message, function () { renderClassPicker(); });
    }
    var ok = writeDoc(doc);

    /* The backup has done its job. Leaving it loaded would leave two sources for
       the same class on screen at once — the saved one and the snapshot it came
       from — and there would be no way to tell which a tab was printing from. */
    state.planbook = null;
    state.classId = null;
    state.roster = null;
    renderClassBar();
    renderClassPanel();
    render();

    $('classPanel').insertAdjacentHTML('afterbegin', ok
      ? '<div class="notice"><strong>' + summary.classes + ' class' +
        (summary.classes === 1 ? '' : 'es') + ' created — ' +
        escapeText(summary.names.join('; ')) + '.</strong>' +
        summary.studentsAdded + ' student' + (summary.studentsAdded === 1 ? '' : 's') +
        ' added to this year' +
        (summary.studentsReused
          ? ', and ' + summary.studentsReused + ' who are in more than one of these ' +
            'classes were added once and put on both rosters'
          : '') +
        '. They keep the student IDs Planbook gave them, so nothing here has been ' +
        're-numbered. Take an export — this computer is now the only place these ' +
        'classes exist (§23).</div>'
      : '<div class="notice notice-bad"><strong>Created on screen, but not saved.</strong>' +
        'This browser is refusing to store anything, so these classes will be gone when ' +
        'the tab closes. The backup file is untouched.</div>');
  }

  /* An already-seeded class, updated from a newer backup — the same reconcile the
     CSV path uses, which is the entire reason Planbook's ids are kept. */
  function updateFromPlanbook(classId) {
    var pbClass = null;
    state.planbook.classes.forEach(function (c) { if (c.id === classId) pbClass = c; });
    if (!pbClass) return fail('That class is no longer in this backup.');

    var plan;
    try {
      plan = Y.reconcile(state.doc, classId, Y.planbookStudents(state.planbook, pbClass));
    } catch (err) {
      return failImport(err.message, function () { renderClassPicker(); });
    }
    confirmReconcile(plan);
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
      /* charAt, not [0]: a roster JSON that someone hand-edited can carry a
         student with no first name, and an exception here takes the whole list
         off the screen rather than showing one odd-looking row. */
      var initials = String(s.first || '').charAt(0) + String(s.last || '').charAt(0);
      return '<div class="row">' +
        '<div class="avatar av' + (i % 10) + '" aria-hidden="true">' + escapeText(initials) + '</div>' +
        '<div class="row-main">' +
          '<div class="row-name">' + escapeText(s.last + ', ' + s.first) + '</div>' +
          '<div class="row-sub">ID ' + escapeText(s.id) + ' · folder …' +
            escapeText(String(s.folderId).slice(-6)) + '</div>' +
        '</div>' +
        '<span class="badge badge-ok">✓ Ready</span>' +
        rosterRowActions(s.id) +
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
    wireRosterRowActions($('rosterList'));
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
    /* Dropping on the box is drop-in print by definition, whatever button was
       pressed before it. */
    state.pick = null;
    if (e.dataTransfer.files[0]) loadRoster(e.dataTransfer.files[0]);
  });
  drop.addEventListener('click', function () { pickDropIn(); });
  $('rosterLink').addEventListener('click', function (e) { e.preventDefault(); pickDropIn(); });
  $('rosterPick').addEventListener('click', function () { pickDropIn(); });
  $('rosterFile').addEventListener('change', function (e) {
    if (e.target.files[0]) loadRoster(e.target.files[0]);
  });

  /* The store comes up before anything is drawn, so a saved class is the first
     thing on screen rather than appearing a beat later. */
  bootStore();
  renderClassPanel();
  /* Drawn at boot, which it never needed to be while only a dropped file could
     fill it — that always arrived after a click. Saved classes are there before
     anything is pressed. */
  renderClassBar();

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
