# Roadmap

**Status: phases 1 and 2 complete. Phase 3 part-done — everything that can be measured
without a class has been, and the numbers are in
[field-test-2026-09-16.md](field-test-2026-09-16.md). What is left of it needs a real
class, real paper and a teaching day.**
Running on localhost (`cd tools && npm start`) until it is fit to share.
Last updated 16 Sep 2026.

Shareable view of this plan, with the reasoning attached:
<https://claude.ai/code/artifact/02464f20-4a2d-4ce4-bc4d-b7e5f92d99fd>

Reasoning for structural choices lives in [decisions.md](decisions.md). Measurements land in
dated field-test notes beside it, as [field-test-2026-09-14.md](field-test-2026-09-14.md)
did. This file tracks only *what is done and what is next*.

---

## The priority

**Get the paper loop into real classrooms at real scale, and defer everything that touches
Google until the split is proven.**

The field test was five students. Everything downstream of the split — filing, manifests,
undo, folder maps — assumes the split is reliable at thirty. If a real stack turns out to
have a meaningful decode failure rate, or real prompts overflow the sheet more often than
the sample did, that changes the design of whatever was built on top of it.

None of that needs Drive to find out. A folder ID is a string in a QR payload; the whole
loop runs for a term on placeholder IDs, filed by hand.

## Decisions awaiting a call

| | needed by | note |
|---|---|---|
| Where the house style ends | phase 5 | Full fidelity puts a tester's fonts and colours on paper. Structure-yes / appearance-no is the likely middle. |
| My Drive or a shared drive | phase 6 | Shared drives change ownership — files belong to the drive, better for continuity when a teacher leaves. Decide before the root folder is created. |
| Whether filing agrees with splitting's new answer | phase 6 | §28 answered this for splitting — a loud, per-packet skip beats all-or-nothing. Phase 6 reads that section before deciding whether filing follows it or deliberately diverges. |

## Settled

- **19 Sep 2026 — the back is optional, per print run.** A checkbox next to Step 2 turns the
  sheet into a one-page cover (an exam cover, occasionally) — no back is built, none is
  required, and the print-dialog instruction swaps to single-sided, because leaving duplex
  on with one page per student would weld two students onto one physical sheet. A run
  setting, not a saved one: `state.twoSided`, not a document field. Reasoning:
  [decisions.md §30](decisions.md).
- **18 Sep 2026 — the class bar is live at any class count, and is where a class gets added.**
  §19's "a strip with one tab on it is furniture" stopped holding once the bar became the
  only place to add a class, not only switch between them — found from the first real deploy,
  where a teacher with one saved class saw the bar vanish on reload. The dashed `+` slot the
  mockups always drew (`.cls-tab-add`) replaces the button that used to sit at the bottom of
  the class panel. Reasoning: [decisions.md §29](decisions.md).
- **16 Sep 2026 — a missing student quarantines a packet; it no longer stops the run.** A
  missing student used to stop the whole split — nothing written, and recovery meant reading a
  page crop, typing a command by hand, and waiting for a full re-run. Now clean packets always
  file, and anything an issue attaches to goes to a page-numbered `unresolved/` bundle instead —
  a teacher can open and file one by hand with no re-run required. Exit 1 now means "N filed, M
  unresolved," never "wrote nothing." Reasoning and the per-issue-kind table: [decisions.md
  §28](decisions.md).
- **14 Sep 2026 — grade the paper, then scan it.** Collect → grade → scan → split → file, so
  the filed PDF carries the marked rubric. Reasoning and consequences in
  [decisions.md §13](decisions.md).
- **14 Sep 2026 — boxes print empty.** Checkbox state is normalised to unticked at generation,
  whatever the source Doc carries. [decisions.md §14](decisions.md).

---

## Phase 1 · Fit for a real class

**Goal:** the existing loop runs against a real thirty-student roster instead of five
fictional poets.

Today every tool hardcodes `data/roster-sample.json`. A real class would split against
Shakespeare, Dickinson, Whitman, Frost and Angelou — silently, because the codes on the
paper would match nothing. No tester can start until this is gone.

- [x] `--roster <path>` on every tool, required, no fallback. Shared `lib/cli.mjs` (one
      parser — the two hand-rolled ones would have mis-taken the roster path as the
      positional) and `lib/roster.mjs` (load, validate, refuse). Exit 2 and stderr for a
      wrong command, leaving exit 1 to mean the paper had problems. [decisions.md §16](decisions.md).
- [x] Join packets on `studentId`, not `folderId`. A packet now carries both: `folderId` is
      the roster's current value — where it goes — and `printedFolderId` is what the paper
      said. A stale ID is a **warning** when splitting and a **failure** when verifying.
      [decisions.md §15](decisions.md).
- [x] Write packets into a mirrored tree: `packets/<Last-First-id>/<runId>.pdf`. The student
      ID is always appended rather than only on collision, so a namesake cannot overwrite
      anyone and the directory name never moves between runs. The folder ID left the
      filename entirely.
- [x] Archive every run to `data/runs/<runId>/` — report, plus a **copy** of the roster and
      the scan's SHA-256. Written on the refusal path too, which is the run most likely to
      be needed later. The scan is not copied in; **keep it** until the term's grading is
      done. [decisions.md §17](decisions.md).

Three things the work turned up that were not in the plan:

- **`--force-code` would have become a dead end.** It built its payload with the literal
  string `'forced'` as the student ID, so under the new join every forced page became
  `unknown_student` — and the splitter's own on-screen instructions would have been telling
  a teacher to use a flag that no longer worked, at exactly the moment they were stuck. It
  now names a student ID, resolved against the roster at parse time.
- **The new key can collide; the old one could not.** `roster_id_collision` is checked in
  the app on import, in the roster loader, and in `buildPackets`.
- **`qr-selftest` asserted `version === 4`**, which fails on a roster of placeholder folder
  IDs — the exact case this phase exists to make safe. It now asserts the 62-byte budget,
  and pins v4 against a synthetic Drive-length payload separately.

**Done — 14 Sep 2026.** Verified against a synthetic thirty-student class: 60-page sheets
PDF passes `verify-sheet`; a 180-page scan splits into 30 per-student directories; all
three break modes refuse and write nothing; a scribbled-out code recovers via
`--force-code`; and sheets printed on placeholder folder IDs split cleanly against a roster
holding the real ones, reporting `folder_changed` once as a warning. Both suites pass.

**Still owed:** the same run against a *real* thirty-student roster and a real print.
~~The synthetic sheets were generated straight from `app/qr.js` at the sheet's own geometry,
which proves the tooling but not the print dialog.~~ **Half paid, 16 Sep 2026** — sheets now
print through the browser's own print path via `tools/print-sheets.mjs` and verify clean at
15, 30, 60 and 150 students. What is still unproven is paper: toner, feeder skew and a
scanner's own binarisation.

**Out of scope:** anything touching Google. Any change to the sheet layout, the QR geometry,
or the crop.

---

## Phase 2 · The app holds the class

**Goal:** set the classes up once in September and never re-enter a roster to print a
rubric.

Today every print starts by importing a roster. That pays a per-print cost for a per-term
event, on the morning when there is least time to pay it. Reasoning and the rules this has
to obey: [decisions.md §20–§22](decisions.md). It reverses §8.

- [x] **The year document.** One per school year: a flat `students` array, classes holding
      `roster: [studentId]`. Planbook's shape, so moving a student is list membership and a
      future merge of the two apps is a merge rather than a translation. `schemaVersion` and
      a migration ladder **from the first commit** — retrofitting one onto data already on
      someone's disk is the expensive version of this job.
- [x] **Its own store, not the prefs whitelist.** `getPref`/`setPref` exist to stop a
      document being stashed in `localStorage`; this is a document, so it gets its own
      accessor and its own reasoning. **A store that is not storing says so, loudly and
      permanently** — private windows and `file://` both refuse, and a teacher who believes
      a class is saved and is wrong finds out next September.
- [x] **Create a class; populate it from a CSV.** Name and student ID. Folder ID optional —
      store `null`, never a placeholder, and synthesise `placeholder-<studentId>` at print
      time so the three-field payload holds. A stored placeholder is indistinguishable from
      a real ID a year later.
- [x] **Generate IDs only where the field is blank, and only on confirmation.** Unique
      across the year, readable (`2026-0042`), never regenerated. Hand back the imported
      roster with the ID column filled in — that file is both the recovery record and what
      makes the next import clean.
- [x] **Import a year file back in.** Build, validate, then swap: `readYearDocument`
      parses, walks the migration ladder and checks the document against the shape
      `newYearDocument()` produces — derived from a reference document rather than a
      hand-written field list, so a field added there is checked for without anyone
      remembering to come back. Nothing is written until it returns, and every refusal ends
      by saying the store was not touched. Replacing a year that is already stored is the
      first destructive action in the app, so it is proposed with **both sides counted** and
      offers to export what it would replace: [decisions.md §26](decisions.md).
- [x] **Create classes from a Planbook backup, fully populated.** Keeps Planbook's `s_…`
      ids so a later re-import reconciles instead of duplicating everyone — and keeps its
      **class** ids too, so dropping the same backup in again finds the class it already made
      and offers to update it rather than building a second one beside it. Seeding is
      all-or-nothing, and the backup is put away once its classes are real, because two
      sources for one class on screen is a question nobody can answer. This changes what the
      file is for: [decisions.md §27](decisions.md).
- [x] **Add/drop.** Move a student between classes, or drop them from one. A drop leaves the
      student in the document, because a sheet already printed still has to resolve. All three
      are proposed and confirmed: a move picks its destination from a list that names what the
      student is being moved out of, and a drop says out loud that the student is kept. **Add
      students is what makes a drop reversible**, and that is what lets a drop exist in an app
      that still has no delete. Somebody added mid-term goes to the **end** of the roster
      rather than being sorted in — sheets print in roster order and the stack is handed out
      by walking it, so an October arrival belongs at the back rather than moving everyone
      else's position.
- [x] **Re-import reconciles; it never replaces.** An updated CSV into an existing class
      matches on student ID, adds the new, and lists anyone in the class but not in the file
      as a *proposed* drop to confirm (§6) — ticked individually, because the reason somebody
      is missing from a file is as often a filtered spreadsheet as a student who left.
      Replacing wholesale was rejected: it silently drops the missing, and on a class built
      from a blank-ID CSV it destroys the generated IDs — which breaks every sheet already
      printed for them. **A blank-ID file cannot be reconciled at all**, because there is
      nothing to match on; it is refused, pointing at the ID-filled file the app handed back,
      which is the second job that file exists to do (§21). Name changes and arriving folder
      IDs are listed and applied on confirmation; an unchanged file reports that it changed
      nothing and writes nothing, so a re-import is safe to repeat. **The fork is the roster
      being non-empty, not a mode anyone picks** — nobody re-importing a corrected
      spreadsheet thinks of themselves as choosing between two algorithms.
- [x] **Archive a class; nothing is deleted.** Archiving takes it out of the bar and keeps
      everything — the roster stays, and sheets already printed still split. **v1 has no
      destructive action at all**, which is worth having on purpose while the store is new
      and the export habit is not yet formed. Delete, with a confirm that counts what it
      destroys, is a later decision rather than an omission.
- [x] **Export the year, and say when you last did.** Once the app owns the roster, losing
      the store loses the year. Offer the file, record that it was offered, keep saying so —
      but do not hard-block, because a gate satisfied by dismissing a dialog reads as noise.
- [x] **Say that it should be installed.** iOS clears a website's stored data after about a
      week of not opening it and a home-screen install is exempt, which for an app whose whole
      value is a class list that persists is data safety rather than polish (§25). A row beside
      Backup and transfer rather than a banner, shown only once there is a class to lose, gone
      once it is installed.

- [x] **Keep drop-in print, under §22's rule.** A roster that brings its own identity may
      print and be forgotten; one whose identity the app minted is kept. The class list
      becomes the front door and drop-in the smaller path; a loaded drop-in roster can be
      promoted with one button, and its tab says it is unsaved.

**Order of build.** The store and its migration ladder, then create-a-class and CSV import,
then ID generation with its confirmation, then **export** — and export lands in that first
shippable slice rather than later, because the app should not own a roster before there is
a way to get it back out. Planbook's rule: no feature that writes student data ships before
backup does. Add/drop, re-import and the Planbook path follow.

**Done when:** a class created in September prints a rubric in November with no file
touched in between; a student moved between two classes prints on the right sheet; a class
built from a CSV with no IDs cannot lose them silently; and the whole year survives a
browser restart and comes back from its own export file.

**Done — 15 Sep 2026.** All four, driven in a real browser by `npm run test:ui`: a year
exported and imported back comes up with the same students and the same folder IDs after a
reload; a student moved between two classes builds one sheet in the new class carrying
`placeholder-2026-0002|SRE1-2026-09-18|2026-0002` and none in the old; a blank-ID CSV into
a class that has a roster is refused outright; and the whole Planbook sample seeds three
classes and 54 students without spending a single generated ID.

That suite is the other half of the phase. `app/year.js` is pure and covered in
milliseconds, but the layer that decides *which file is being imported and into what* is
only reachable from a browser — and its first run found four faults every pure test had
passed over, each of them the kind that writes a student record somewhere quietly wrong.

**Still owed, and none of it is code.** Everything here was verified in headless Chrome at
`localhost:8080`. It has never run on the deployed site, never on iOS — which is the one
browser the install row exists for, and the one §23 did not measure — and no year has yet
crossed between two actual computers on its export file. The first tester's first day is
where those get found.

**One thing arrived late and was not in the list.** The class bar only ever drew itself for
a loaded Planbook file, which was right on 14 Sep and wrong from the moment §20 made saved
classes the usual several-class case — they were the one case with no way to switch between
them. Both sources drive it now: [decisions.md §19](decisions.md), amended.

**Out of scope:** anything touching Google. Syncing back to Planbook. A year picker — the
`year` field goes in now because retrofitting it is a migration, but there is no second year
to switch to yet.

**The risk this accepts** is drift: two apps can now hold a roster for the same children.
Named rather than solved, and the Planbook-id rule above is what keeps a re-import from
making it worse. If it bites, that is the argument for serving this half and reading
Planbook's live document instead — §1's territory, not a feature request.

---

## Phase 3 · Prove it at class scale

**Goal:** find out what breaks between five students and a hundred and fifty.

The open question in [decisions.md](decisions.md) is that a full class is untested. Nothing
suggests a scaling problem — the splitter is linear in pages — but no feeder has been loaded
deep. Cheapest unknown in the project to close, most expensive to be wrong about.

- [x] Synthetic rehearsal at 15, 30, 60 and 150. **Time is linear** — 0.16 to 0.22 s per
      page across a tenfold range, so a 150-student scan splits in 3m16s, and every packet
      was found at every size. **Memory is the finding:** 925 MB at 90 pages rising to
      4.3 GB at 900, in both the splitter and `verify-sheet`, and capping the JS heap
      *raises* the peak rather than lowering it — so it is native buffers rather than V8's
      old space, and `--max-old-space-size` is not the lever. A 4 GB laptop will not split a
      full year group. Numbers and method: [field-test-2026-09-16.md](field-test-2026-09-16.md).
- [x] All three break modes at 30. Each refused, each exited 1, and **not one packet
      directory was written** in any of them — report and undecoded-crop dump only. The
      median-length heuristic reported both halves of `missed` against a thirty-student
      median: the over-long packet as a warning, the student with no code as the error.
      **A missed code costs six times the wall clock** (30 s becomes 176 s at thirty
      students, because the full-page re-scan runs over everything), which extrapolates to
      about fifteen silent minutes at 150 and is a phase 4 message problem.
- [ ] One real duplex run with a full class — **after grading the paper**, per §13. Duplex,
      long edge, 100%, no margins, headers and footers off.
- [ ] Record decode rate from the crop, how many needed the full-page pass, feeder jams, and
      wall-clock from stack to packets — into the run archive and a dated field-test note.

Two tools had to exist before any of it could run, and both are worth keeping:
`make-class.mjs` builds a synthetic class of any size with no randomness at all, and
`print-sheets.mjs` prints through the browser's own `Page.printToPDF` at the documented
settings. **Every `sheets.pdf` in this project until now had been made by a person pressing
Ctrl+P**, which is unrepeatable and does not scale — and it is also why phase 1's last owed
item was still open. It is now closed except for paper: 255 fronts printed through the real
print path, **no decode failures**, symbol at 20.0mm so nothing scaled the page.

**Done when:** one real thirty-student class has gone stack → packets end to end, and the
decode rate and wall-clock are numbers rather than impressions.

**Out of scope:** fixing what it finds. Measure first — the fixes are their own work, sized
by what turns up.

---

## Phase 4 · Survive another teacher

**Goal:** a tester who didn't build it completes a full cycle without you on the phone.

More important than convenience: a second person's roster and a second person's rubric are
the only way to find out what the column matcher and the paste sanitizer actually do on
documents you didn't write.

- [ ] One command to set up, one to run. No relative paths, no working-directory assumptions.
- [ ] Errors that name the fix. The splitter's undecoded-crop dump plus its `--force-code`
      instruction is the model; bring the rest up to it. A teacher should never see a stack
      trace.
- [ ] A tester's guide: the print settings and why each matters, the six pre-flight checks in
      plain terms, what to do when a code will not decode, and the rule about keeping the scan.
- [ ] Collect the corpus — their roster CSVs (header variants are what the column matcher
      exists for, and it has only ever seen yours), their rubric Docs, their run reports.

**Done when:** two testers have each completed a cycle unaided, and their CSV header variants
parse — or fail with a message that told them what to change.

**Out of scope:** a GUI for the desk-side half. Packaging for anyone beyond the trusted
testers.

---

## Phase 5 · Input fidelity

**Goal:** rubrics print looking like the Doc they came from — tables, merged cells,
checkboxes and all.

The formatting is not lost by pasting; it is discarded on purpose. `app.js` reads
`fontWeight` and `fontStyle` off incoming spans to detect bold and italic, then unwraps them
and strips every attribute from every surviving element — which is where `colspan`, `rowspan`
and alignment die. Fidelity is mostly relaxing that function, not replacing the input.

Confirmed scope of real content: **text, tables, checkboxes and lists. No images.** That
retires the zipped HTML-export import and the image handling entirely.

- [ ] Relax the sanitizer: keep a filtered `style` attribute and the table attributes. The
      allowlist stops being a shape filter and becomes a safety filter.
- [ ] De-fill transform — the one hard exception. Fills cannot come across, because browsers
      omit them unless the viewer ticks "Background graphics". Convert a shaded cell to a
      bordered one, keep the distinction, drop the fill, and say on screen that it happened.
      The pre-flight lint already fails the print on any fill, so without this teachers hit
      that wall on exactly the Docs they actually write.
- [ ] Own the checkbox. However Docs emits a checklist — hosted bullet image, unicode ballot
      box, CSS list-style — all three fail differently on paper, and a hosted marker fails
      specifically on the morning the network is down. Draw it in the sheet's own CSS as a
      border, sized to be ticked with a pen, ~12–14px. **Every box prints empty** whatever the
      source Doc carries (§14), and the app says on screen when it has unticked something.
- [ ] Write the reversal down. The README's line that Doc fonts and colours do not come
      across becomes false. Record it in §10 with both exceptions above.

**Done when:** every rubric Doc collected in phase 3 renders recognisably as itself, passes
the pre-flight, and prints legibly in greyscale.

**Out of scope:** markdown authoring. The zipped HTML-export import. Images and diagrams.

---

## Phase 6 · Filing into Drive

**Goal:** packets land in portfolio folders without a human dragging anything.

Verified: `drive.file` cannot reach folders it did not create, and full `drive` is a
**restricted** scope requiring an annual third-party security assessment — out of reach for
this project. That forces the design rather than merely informing it: **the tool creates
every folder it touches**, stays on the non-sensitive scope, and needs no verification, no
audit, and no weekly re-authentication.

Depends on an IT question — whether a Cloud project can be created in the `stjohnshigh.org`
Workspace org. Internal apps skip verification, the unverified-app screen, the 100-user cap
and the 7-day token expiry; a personal account is not offered the Internal option at all.

- [ ] Folder map, at the **front** of the loop: `portfolio.mjs auth`, then `init` to create
      the root, then `folders` to create one per student and write the IDs back into the
      roster JSON. Folders must exist before anything prints, because the QR payload needs
      the ID.
- [ ] Filing as a separate command. `file.mjs` reads the packets and `report.json`. Dry run
      by default, `--confirm` to write.
- [ ] Idempotence via `appProperties` — run, student, file hash. Absent → upload. Same hash →
      skip. Different hash → update in place, which Drive stores as a new revision rather
      than a duplicate, keeping the file ID and any link already shared. Also makes a
      half-finished run safe to re-run.
- [ ] A deposit manifest: run, timestamp, account, the scan's hash, and per packet the Drive
      file ID and page count. The file IDs are what turn "undo — trash 27 files" into a loop
      instead of an archaeology project.
- [ ] The correction path, which is mostly already built. Wrong folder, right pages: change
      the parent. Wrong boundary: re-split with `--force-code` and re-file, landing as a new
      revision. Both need only that filing be re-runnable without duplicating.

**Done when:** a full class files in one command after a dry run you read; re-running changes
nothing; and a deliberately mis-filed packet can be moved to the right student from the
manifest alone.

**Out of scope:** adopting portfolio folders that already exist by hand — a genuine one-time
problem, but its own work. Multi-class printing.

**Pull this forward if** hand-filing packets every week becomes the reason you stop using the
tool. That signal beats any argument made now about when filing should land.

---

## Sequencing

**Phase 2 was inserted 14 Sep 2026 and everything after it moved down one.** It was not in
the original plan; it arrived from the decision that the app should hold the class list
(§20). What was phase 2 is now phase 3, and so on to phase 6.

Phase 3 is the odd one: it needs a real class, real paper and a teaching day, so it is
gated on the calendar rather than on work. It can run alongside phase 2 rather than after
it, and phase 1's still-owed item — a real thirty-student print — is the first half of it.

Phase 4 is where phase 2 pays off: a tester who sets their classes up once is a tester who
can be handed the thing. Phase 5 is specified by the rubric corpus phase 4 collects, and
also settles the assignment-file format left open under *Deliberately not built*. Phase 6
is specified by whether phase 3 shows the split is trustworthy enough to build on.

Estimates are shape, not schedule. Phase 6 is the only one with a dependency outside the
project.
