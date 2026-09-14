# Decisions, and why

The code says what it does. This says why, for the choices where the reasoning is not
recoverable from reading it. Written 14 Sep 2026, at the end of the proof of concept.

Design mockups, eleven screens with reasoning attached:
<https://claude.ai/code/artifact/b03cc902-6fb2-4210-a565-e6a2ca34f809>

Style authority: <https://github.com/wildbil2me/edu-style-guide> — 155 numbered rules.
Cite the ID in a comment when a rule drove a line (`CODE-09`).

---

## 1 · Two surfaces, because of one hard fact

**Google's OAuth cannot work from a `file://` origin.** The redirect URI is rejected and
`fetch` sends `Origin: null`, which Google's APIs refuse. That is not a preference to
revisit; it is why the project has two halves.

- **`app/`** — the print surface. Opens by double-clicking, no server, no network, zero
  dependencies, no ES modules. Printing day is exactly when the school network is least
  trustworthy, so this half must work without it.
- **`tools/`** — the desk side. npm packages are fine; it runs after class.

Anything that needs Drive belongs in the second half, or in an Apps Script beside it.
Nothing that needs Drive may creep into the first.

## 2 · The code is the anchor; everything else varies

The prompt and the rubric change every assignment. The name-and-code block never does.
That asymmetry is the architecture: **the app owns a fixed frame and treats the content
below it as an opaque payload it never has to understand.**

Consequences, all load-bearing:

- The header band is **fixed height**. A long name truncates inside it rather than pushing
  the code down. `.sheet-head-qr` cannot shrink.
- The code sits at **left 674, top 48, 94 × 94 on an 816 × 1056 page**. That rectangle is
  the contract between `app/index.html` and `tools/lib/pdf.mjs`. Change one, change both.
  A pre-flight check asserts it on every sheet.
- The code is on **page 1 only**, however many pages the sheet runs to.
- Ingestion can therefore change later without touching the QR, the split, or the filing.

## 3 · The boundary rule

**A code starts a packet, and every page after it belongs to that student until the next
code.** Nothing else is inferred.

This requires the sheet to go into the feeder **face-up, on top of the student's work** —
which is why the front says "Keep this sheet on top of your work" in print.

The back carries **no code**. A second code per sheet would start a phantom packet and cut
every student in half. A pre-flight check asserts every back has zero.

## 4 · The payload

`folderId|runId|studentId` — 54 bytes. Version 4, EC level M, byte mode, 33 × 33 modules,
printed at 2 cm.

- **Byte mode is forced.** A Drive folder ID is mixed case with `-` and `_`; alphanumeric
  mode cannot encode those.
- **Version is capped at 4**, not auto-selected upward. A payload that outgrows the budget
  fails loudly rather than stepping to a denser symbol with a worse scan margin at the same
  physical size. The app shows a live byte counter against 62.
- `app/qr.js` is a from-scratch encoder because no dependency-free one runs from `file://`.

## 5 · Blank backs are kept and filed

A reversal from an earlier design, and the most useful decision in the project.

A blank side is **evidence**: it proves the scanner caught the page and that the student's
second side really was empty. So the app never has to be *right* about what is blank — it
only labels, and a wrong label costs nothing.

That deleted a whole subsystem: blank detection as a filing decision, the keep/drop
controls, the "could not judge" state, and the risk of quietly discarding a page someone
wrote two sentences on. The splitter simply keeps every page.

The count filed always reconciles with the count scanned. That is the property that lets
you answer a student who says they turned in a second side.

## 6 · The app proposes, a person confirms

True of columns, packet boundaries, folder matches and prompt boundaries alike. **Nothing
structural happens invisibly.** It is what makes the thing trustworthy with a term of
someone's work, and it should govern anything added later.

Corollary: **nothing is written when a student is missing.** A half-correct split that gets
filed is worse than no split, because the mis-filing is invisible. The splitter exits
non-zero and writes only the report.

## 7 · Assignment content arrives by paste

Considered and rejected: pointing the app at the Doc, and a Google Docs mail-merge add-on.

Pointing at the Doc costs the offline print surface (see §1). The add-on is the better
long-term answer on **fidelity** — Docs renders its own content perfectly — but Apps Script
cannot see pagination, so it cannot detect when a student's section runs long and shears
the duplex alignment for everyone after them. That is silent and expensive. Revisit it if
prompts start carrying images, diagrams or fiddly tables; the sample was plain text and
HTML handles that flawlessly.

Paste won on a specific fact: **the Doc is frozen once printing starts** — corrections go
on the board — so paste costs one action per assignment.

**The paste is a snapshot, not a workaround.** The copy the app holds is the record of what
was actually handed out, and it stays true after the Doc is edited for next year. A live
link would have quietly rewritten history. That matters because the portfolio is the point:
without the prompt, a folder of essays is answers with no questions.

## 8 · Two roster formats, on purpose

**Import is CSV** — that is what a spreadsheet exports. **Save is JSON** — that is the
app's own format, and it round-trips without guessing at columns again. The app reads
either. The splitter reads JSON, so the saved roster is the handoff between the halves.

Columns are **matched on their headers and the match is shown on screen**, so a wrong guess
is visible rather than silently printing the wrong name on the wrong sheet. The parser is
quote-aware because the column that matters is usually called `Last, First` and holds
values like `Shakespeare, William` — both carry a comma.

**The roster is always imported, never authored in the app.** The door left open is on the
folder side: creating missing portfolio folders, and moving them when a student changes
class.

## 9 · The rubric has no fixed shape

The real one is a single holistic scale — 0–6 / 7 / 8 / 9 — plus two flat penalties. Not a
criteria × levels grid. An early draft assumed a grid and was wrong.

**The app renders whatever is pasted and has no opinion about rubric shape.** Anything that
assumes criteria-and-levels will break on the first real document.

## 10 · The printed sheet is paper, not an app screen

Five deliberate departures from the style book, each because the surface differs:

1. No navy flood fill — the amber rule carries the identity at almost no ink.
2. Line colours step up to `#d0d8e4` / `#6b7a8d`; `#f3f4f6` vanishes on paper.
3. Nothing is signalled by fill alone, so it survives a greyscale copier.
4. The routing code is pure `#000`, not `#1a1a2e`, for photocopy contrast.
5. Body type is sized for paper, not for a dense roster screen.

And the rule that costs a class set if broken: **no background-color anywhere on a sheet.**
Browsers omit backgrounds unless the viewer ticks "Background graphics", which is off by
default. The amber identity rule is a `border` for exactly this reason. A pre-flight lint
walks every element and fails if any carries a fill, so it cannot creep back.

## 11 · Exactly two pages per student

`.sheet` uses `height`, not `min-height`, with `overflow: hidden`. Overflowing content
**clips loudly on one sheet** instead of reflowing onto a third page and shifting every
student after it by one — which shears the entire duplex run invisibly.

The pre-flight compares `scrollHeight` to `clientHeight` per side and names anyone who
overruns. Six checks in total gate the Print button; they are listed in the README.

## 12 · Binarize before decoding

From the field test. jsQR's own tile-based binarizer picks a poor threshold on a small,
mostly-white crop of a scanned page. Otsu-thresholding the crop first took the hit rate
from 2/5 to 5/5 on real paper. Full detail and the measurement table in
[field-test-2026-09-14.md](field-test-2026-09-14.md).

## 13 · Grade the paper, then scan it

Decided 14 Sep 2026, once the rubric gained checkboxes the teacher ticks by hand.

The order is **collect → grade on paper → scan → split → file.** Scanning first would
archive a blank rubric: the boxes would be ticked after the page had already been captured,
and the grade would exist only on a sheet that then gets recycled. A portfolio of work with
no marks on it is half the record.

Two consequences worth keeping:

- **The filed PDF is the graded artifact.** The student's work, the prompt they answered and
  the scored rubric are one document, because all three were on the paper when it went
  through the feeder. Nothing has to be stitched together afterwards.
- **The human check moves upstream.** Grading means handling each student's stack — sheet on
  top, their work beneath — so the question of whether the right work is behind the right
  sheet is answered on paper, before a scan exists. It does not make the split infallible; a
  misdecoded code can still misattribute pages. But it means any error afterwards is a
  machine error on an input a person already validated, which is a far smaller thing to
  reason about.

The cost is that sheets now live on a desk through grading rather than being scanned the same
day. Wear is still a non-issue — they do not go home — and a lost sheet reprints byte-identically,
because the code is derived from `folderId|runId|studentId` rather than stored.

## 14 · Boxes print empty

Whatever a pasted rubric carries, **every checkbox prints unticked.** A pre-ticked box in the
source Doc is an authoring artifact, not an instruction, and printing it would hand thirty
students a rubric that had already scored them.

This is the app having an opinion about content, which §9 otherwise forbids — so it is scoped
as narrowly as possible: the box's *state* is normalised, its presence and position are not.
Per §6 the app says on screen when it has unticked something, rather than doing it silently.

## 15 · Packets are matched on the student ID

Changed 14 Sep 2026, at the start of phase 1. `buildPackets` joined a scanned code to a
roster student on `folderId`. That welded every printed sheet to whatever Drive folder ID
existed the morning it printed: the day the real folders were created, a term of sheets
would stop matching anything and the split would refuse the lot.

The payload already carries all three fields (§4), so the fix costs nothing on paper.
**The join is `roster.id` ↔ the payload's `studentId`.** The folder ID is cargo.

That is what makes deferring Drive safe rather than merely postponed. A whole term can
print on placeholder folder IDs and keep splitting after the real ones arrive.

**A packet carries two folder IDs, and the plain name is the destination.**
`packet.folderId` is the roster's *current* value — where this work goes. `printedFolderId`
is what the paper actually said, kept as evidence and used for nothing else.

The asymmetry is deliberate, and it is chosen around which mistake writes a file. Every
consumer of `folderId` is asking *where does this go*; only a human debugging asks what the
paper said. Had the bare name kept the printed value, a student whose portfolio folder was
legitimately re-pointed mid-year would file **successfully, into a real, valid, wrong
folder** — the invisible mis-filing §6 exists to prevent. The mistake in the other
direction is a wrong answer to a forensic question: annoying, self-correcting, writes
nothing. `report.json` is `schemaVersion: 2` for this reason; a v1 reader taking `folderId`
at face value would file into a placeholder.

**A stale folder ID is a warning when splitting and a failure when verifying.** Same
condition, opposite verdicts, and the difference is which side of the paper you are on. At
split time it means the sheets were printed before the folders existed — the deferral
working, and refusing there would re-impose the exact weld this removed. At verify time the
PDF was generated from this roster minutes ago, so it means you are about to spend thirty
sheets on IDs you have already replaced, and nothing recovers from that but reprinting.
Per §6 the split says so out loud: one warning naming everyone, plus a flag on each packet
so it shows beside the right rows.

**The new key can collide; the old one could not.** A Drive folder ID is 33 effectively
random characters. A student ID is whatever the CSV's ID column held — and when a CSV has
no ID column, the app invents `String(1001 + i)`, so two sections both number themselves
from 1001. A collision routes one student's entire packet into another's folder with
nothing looking wrong anywhere. Hence `roster_id_collision`, checked in the app on import,
in the roster loader before any pixel is rendered, and again in `buildPackets`.

Consequences elsewhere:

- **`--force-code` names a student ID**, not a folder ID. It is also the number a teacher
  can read off the roster panel, rather than 33 characters to copy correctly under time
  pressure, and it is resolved against the roster at parse time so a typo fails by name.
- **The folder ID left the output filename.** Packets are
  `packets/<Last-First-id>/<runId>.pdf`. Baking a placeholder into a filename on disk,
  permanently, is the same weld in a different place.

## 16 · The roster is named, never defaulted

Every tool used to read `data/roster-sample.json` from a fixed path. A real class would
have split against five fictional poets — silently, because the codes on the paper match
nothing on the roster actually loaded, and "no packets found" reads like a scanner problem
rather than the wrong file.

`--roster <path>` is **required on all five tools**, the two test scripts included, and
there is deliberately no fallback. The npm scripts name the sample explicitly, so the
fixture is visible in the command rather than buried in a source file.

The tools now distinguish two exit codes. **1 means the run found problems in the paper** —
a successful run reporting a real-world fault. **2 means the command was wrong** and goes
to stderr, so anything wrapping the splitter can tell "this class needs attention" from
"you typed it wrong".

## 17 · Every run is archived, but the scan is not copied

`data/runs/<runId>/` holds the run's `report.json`, `report.txt`, and a **copy** of the
roster it used — copied, not referenced, because next term's edit to the same file would
otherwise rewrite this run's history.

Written on the refusal path too. That is precisely the run somebody needs to reconstruct
later, and the old behaviour left it beside the packets to be clobbered by the re-run that
fixed it.

**The scan itself is not copied in.** A duplex class scan is hundreds of megabytes, and
duplicating it every run would cost more than it buys. What the archive keeps is the
SHA-256 and the absolute path, which is enough to prove which bytes a report describes.
Keeping the original until the term's grading is done is a desk rule — a re-split needs it,
and it is the only way back from a wrong boundary.

## 18 · A Planbook year backup is a third roster source

Added 14 Sep 2026. The app reads a Planbook year document — the JSON that app's own
backup button writes — alongside a roster CSV and a saved roster JSON. It holds several
classes, so it is the one source that asks a question: pick the class, then the roster
loads. Archived classes are not offered.

**This only became possible because of §15.** A Planbook student has an id and no
portfolio folder. While the splitter joined on `folderId` that was fatal — there was
nothing to match on. Joining on `studentId` means the folder can be `placeholder-<id>`
and the split still lands in the right place, with `folder_changed` naming it the day
real Drive IDs arrive. The feature is a consequence of the phase-1 change, not a
coincidence.

Detection runs **before** the roster-shape check, because a Planbook document also has a
top-level `students` array. Without that ordering it parses as a roster and fails with
"60 students have no portfolio folder" — true, and no help at all in working out what
happened.

**Still a file, still `FileReader`, still no network.** The app does not open Planbook's
IndexedDB and could not: a `file://` page has no access to another origin's storage, and
Planbook is served over https. A backup file is a snapshot the teacher chose to hand
over, which is the same bargain as the paste (§7) — and it keeps §1 intact.

A dangling roster id — a class listing a student the document does not contain — is
refused rather than skipped. Planbook's own screens resolve a stale id to something that
exists, which is right for a screen; a sheet printed for nobody is a sheet nobody hands
in.

**What this is really testing.** Whether the rubric printer is a second app or a Planbook
module. Planbook already owns years, classes, rosters and students; this adds a QR
encoder and a prompt. Reading its backup file is the cheapest way to find out whether the
data model fits before anything is committed to. It does fit: 18 students out of a
Planbook class print, verify, scan and split with no errors, and the payload is 53 of 62
bytes.

---

## Deliberately not built

| | note |
|---|---|
| Drive filing | The PoC stops at per-student PDFs. This is the obvious next piece. |
| Folder matching, creation, moving | Drawn and disabled in the mockups. Folder IDs come from the CSV for now, and §15 is what makes that safe to live with: placeholder IDs can print for a term and still split once the real ones arrive. |
| Markdown save and reload of assignments | **Decided, not built.** Format sketched in the mockup notes: frontmatter for the header values, `---` between prompts, the back named in frontmatter rather than detected by heading text. Makes boundary detection deterministic after the first pass, and an assignment file carries no student data so it is freely shareable. |
| Splitting one Doc that holds several prompts | Deferred entirely by pasting front and back separately. The sample Doc holds five prompts for one essay. |
| Multi-class printing | The assignment is scoped **above** the class: paste once, print several periods. Not yet reflected in the app. |
| Blank-page detection | Not needed at all — see §5. |

## Known limits, and how they are handled

- **Handling wear is a near-non-issue.** Sheets live one class period: handed out at the
  start, collected at the end, so they do not go home and do not get folded into a
  backpack. Take-home essays are seen digitally, so no printed sheet travels at all.

  And a lost or damaged sheet reprints cleanly. The code is *derived* from
  `folderId|runId|studentId` rather than stored, so a reprint produces a byte-identical
  symbol and the replacement is interchangeable with the original. Losing a sheet costs
  one page, not a recovery procedure.
- **Attribution is checked while grading, by design.** Nobody needs to verify the split
  independently: the teacher reads every packet anyway, and a page in the wrong packet is
  obvious the moment it is graded. Grading *is* the verification pass, not an extra step —
  which is why the splitter does not need to be trusted blindly, only to be honest about
  what it was unsure of.

  **Not yet built, and the gap this exposes:** when grading catches a mis-file, there is no
  way to move pages between packets. `--force-code` covers a code that would not decode; it
  does not cover "these two pages belong to the student before." That is the natural
  companion to Drive filing on the roadmap.

- **Rollout is laddered on purpose.** Homework assignments first, where a mis-file costs
  little and is caught the same day, before major assessments. A full class of thirty has
  not been run; nothing suggests a scaling problem, since the splitter is linear in pages.
- **Whether an assignment ever needs an image or a complex table.** If yes, revisit the
  Docs add-on (§7). If no, paste is settled.
