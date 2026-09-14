# Roadmap

**Status: phase 1 complete, phase 2 next.** Last updated 14 Sep 2026.

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
| Where the house style ends | phase 4 | Full fidelity puts a tester's fonts and colours on paper. Structure-yes / appearance-no is the likely middle. |
| My Drive or a shared drive | phase 5 | Shared drives change ownership — files belong to the drive, better for continuity when a teacher leaves. Decide before the root folder is created. |
| Partial filing or all-or-nothing | phase 5 | Splitting refuses everything on any error. Filing is per-student independent, so a loud skip is coherent. Opposite rules, so make it deliberate. |

## Settled

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

**Still owed:** the same run against a *real* thirty-student roster and a real print. The
synthetic sheets were generated straight from `app/qr.js` at the sheet's own geometry, which
proves the tooling but not the print dialog.

**Out of scope:** anything touching Google. Any change to the sheet layout, the QR geometry,
or the crop.

---

## Phase 2 · Prove it at class scale

**Goal:** find out what breaks between five students and a hundred and fifty.

The open question in [decisions.md](decisions.md) is that a full class is untested. Nothing
suggests a scaling problem — the splitter is linear in pages — but no feeder has been loaded
deep. Cheapest unknown in the project to close, most expensive to be wrong about.

- [ ] Synthetic rehearsal: `make-test-scan` at 30 students, then 150 across five sections.
      Time the split, watch memory, confirm linearity rather than assuming it.
- [ ] All three break modes at 30 — `--break leading|missed|duplicate`. At five students a
      swallowed packet is obvious; at thirty the median-length heuristic in `packets.mjs` has
      real data to work against, which is where it should be checked.
- [ ] One real duplex run with a full class — **after grading the paper**, per §13. Duplex,
      long edge, 100%, no margins, headers and footers off.
- [ ] Record decode rate from the crop, how many needed the full-page pass, feeder jams, and
      wall-clock from stack to packets — into the run archive and a dated field-test note.

**Done when:** one real thirty-student class has gone stack → packets end to end, and the
decode rate and wall-clock are numbers rather than impressions.

**Out of scope:** fixing what it finds. Measure first — the fixes are their own work, sized
by what turns up.

---

## Phase 3 · Survive another teacher

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

## Phase 4 · Input fidelity

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

## Phase 5 · Filing into Drive

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

Phases 1–3 are sequential; each produces what the next one needs. Phase 4 is specified by the
rubric corpus phase 3 collects. Phase 5 is specified by whether phase 2 shows the split is
trustworthy enough to build on.

Estimates are shape, not schedule. Phase 5 is the only one with a dependency outside the
project.
