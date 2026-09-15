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

**Still true, and no longer the whole reason — 15 Sep 2026.** The OAuth fact above stands.
But this section was also carrying an unstated second claim, that the *splitter* needs
Node, and that one is measured false: the same decode ran in a browser at the same hit
rate, 18 of 18 ([field-test-2026-09-15.md](field-test-2026-09-15.md)). Three of its four
dependencies were browser libraries all along. So the two halves rest on the `file://`
origin alone — serve the app and both reasons go at once. §24 says why that now matters.

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

~~**The roster is always imported, never authored in the app.**~~ **Reversed 14 Sep 2026 —
see §20.** Classes are created in the app and rosters persist; import is how a roster gets
*in*, not the only place it can live. The rest of this section stands: CSV in, JSON out,
columns matched and shown.

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

## 19 · The class bar — first the loaded year, and now a saved list too

Added 14 Sep 2026. The header's class strip was drawn on four mockup boards and never
built — the one element on the whole canvas with no note pinned to it, and the notes
around it said the opposite ("THE ROSTER IS ALWAYS IMPORTED"). It is buildable now
because a Planbook year document carries several classes; a CSV is exactly one, and a
strip with one tab on it is furniture.

**The tabs are the open document, held in memory.** No roster is stored anywhere. Drop
the backup, and the classes in it become the bar; switching tabs re-reads that class out
of the same document.

**Amended 15 Sep 2026 — the title of this section was true for one day.** It said "not a
saved list" because on 14 Sep the only thing that carried several classes was a file held
in memory, and the note beside the mockup still said THE ROSTER IS ALWAYS IMPORTED. §20
reversed that premise the next morning, and the guard in `renderClassBar` — *return empty
unless a Planbook document is loaded* — outlived the reason for it. Saved classes became
the ordinary several-class case and were the one case with no way to switch between them,
which was noticed and then written down as a follow-up rather than fixed. That was the
wrong call: it was not a decision standing on an argument, it was an argument that had
already expired.

**So both sources drive the strip, and never both at once.** A loaded backup wins it while
it is on screen, because that is the document being looked at; once it is put away (§27)
the saved classes hold it, which is the state most printing happens in. §19's own test for
whether to draw it at all survives unchanged and applies to either: **a strip with one tab
on it is furniture**, so it needs two.

**This is also multi-class printing**, which was listed below as decided and not built.
The assignment is scoped *above* the class, so switching tabs keeps the paste and the
header fields and re-renders the sheets for the next period. Paste once, print several
periods.

**What persists is two ids and a year label.** `rubricprint_openYear` and
`rubricprint_openClassId` in `localStorage`, through a whitelist that refuses any
undeclared key — lifted from Planbook's `src/prefs.js` along with its reason: the likely
cause of an undeclared key is someone reaching for `localStorage` to stash something that
belongs in a document. Here that something would be a roster.

~~**No roster is ever persisted, and that is a decision rather than an omission.**~~
**Reversed the same day — see §20.** The two arguments below are kept because one of them
was wrong in a way worth remembering, and the other became the risk §20 accepts on purpose:

1. `file://` has no dependable storage. IndexedDB is refused outright by Firefox and
   Safari at an opaque origin, and Chromium keys it to the file's path, so it vanishes
   silently if the folder moves. `localStorage` does work, but student names and IDs in a
   store shared across every local HTML file is not a trade worth making for saving one
   drag. — **Measured 15 Sep and half wrong: `localStorage` is NOT path-keyed, and does
   survive the folder moving (§23). The shared-store half was right.**
2. **The file is already the store, and it cannot go stale.** Re-reading the backup every
   time means the roster always matches the Planbook document it came from. A saved copy
   would quietly disagree the first time a student transferred out — and that is the
   mis-filing this project keeps refusing, arriving by a new route.

So reopening is a shortcut, not a cache: drop the same year's file again and the class
you were on opens directly, because the *id* was remembered and the *roster* was re-read.
A different year, a deleted class or an emptied one falls through to the picker rather
than guessing.

**Where each argument ended up.** The first was overstated: `localStorage` works on
`file://` in the browsers this is used in, and a 150-student roster is ~15 KB against a
5 MB budget, so the size objection never bit at this scale. The privacy point was weaker
still — Planbook already keeps IEP and 504 data in the same browser on the same machine,
and the boundary in both cases is the lock on the drawer.

The second argument was sound but assumed its conclusion: a copy can only go *stale*
against a source you have declared authoritative. §20 declares that the app holds the
roster, at which point there is nothing to be stale against — and what replaces staleness
is **drift**, two systems editing the same children independently. §20 accepts that
knowingly rather than pretending it away.

What survives unchanged is the behaviour described above: this section's class bar is
still the loaded document, and §20's store is a separate thing layered over it.

## 20 · The app holds the class list

Decided 14 Sep 2026. **This reverses §8's "the roster is always imported, never authored in
the app."** Classes are created in the app, rosters are populated into them, and both
persist between sessions.

The reason is a mismatch of rates. A roster changes a few times a term; a rubric prints
weekly. Re-importing before every print pays a per-print tax for a per-term event, and the
tax is paid on the morning when there is least time to pay it.

**The shape is Planbook's, deliberately.** One document per school year: a flat `students`
array, and each class holding `roster: [studentId]`. So moving a student between classes is
list membership rather than a record that moves, and a student in two classes exists once.
Copying the shape also keeps a future merge of the two apps a merge rather than a
translation.

**Dropping a student removes them from the roster and keeps the student.** A sheet already
printed carries their ID, and if their work comes back in next week's scan the splitter
still has to resolve it. A dropped student who vanishes from the document turns a
recoverable packet into `unknown_student`.

**What this accepts is drift**, and it is accepted rather than solved. Two systems can now
hold a roster for the same children and be edited independently. The mitigation is that a
class created from a Planbook backup keeps Planbook's `s_…` ids, so a later re-import
reconciles — same student, same id, add the new, name the missing — instead of duplicating
everyone.

Rejected: reading Planbook's live document, which needs this half served and is §1's
territory; and syncing back to Planbook, which would make this app a writer of someone
else's record.

## 21 · A student ID is permanent the moment it is printed

It is inside the QR code, it is what the splitter joins on (§15), and after a print run it
is on paper in a stack on a desk. **So an ID is never regenerated.** Renumber a student and
every sheet already printed for them becomes unroutable — `unknown_student`, and the run
refuses.

**Pre-assigned beats generated, always.** A school ID is stable, meaningful, and survives a
re-import. The app generates only where the field is blank, and doing so is a confirmed act
rather than a quiet default — the current importer invents `String(1001 + i)` silently,
which is exactly how two sections both come to number themselves from 1001 and why
`roster_id_collision` exists.

**Generated IDs are unique across the year, not the class**, and they are readable:
`2026-0042`, not an opaque token. `--force-code` takes a student ID, and that is a value a
teacher reads off a sheet and types under time pressure when a code will not decode.
`7=2026-0042` survives that; `7=s_3f9a1b2c4d` is a transcription error waiting to happen.
The prefixed form is also visibly *not* a school ID, so the two can never be confused and a
generated ID cannot collide with a real one.

A year may therefore hold two ID shapes — `2026-0042` generated, `s_…` from Planbook. That
is deliberate. The splitter treats IDs as opaque, and the Planbook ones are what make
re-import reconcile (§20).

**The record kept for recovery is the roster file itself, with the ID column filled in.**
One artifact doing two jobs: it is the name-to-ID map that cannot be reconstructed if the
store is lost while sheets are in a stack, and it makes the next import clean. A separate
audit file was rejected because it solves only the first — and a blank-ID CSV re-imported
unchanged would mint a *second* set of IDs for the same children, with sheets already
printed under the first.

The honest limit: a browser cannot report that a download was saved. So the file is offered,
the offer is recorded, and the app keeps saying so until another is taken. It is not a hard
gate, because a gate satisfied by dismissing a dialog teaches people the gate is noise.

## 22 · Drop-in print survives, under one rule

Both modes are kept: a roster dropped in and printed with nothing saved, and classes that
persist. Persistence is what most printing will use, so **the class list is the front door
and drop-in is the smaller path underneath** — the reverse of how the app opens today.

Two modes create exactly one trap, and it is severe: drop a CSV with no IDs, let the app
generate them, print thirty sheets, close the browser. The IDs are gone and the stack is
unroutable. That failure is not reachable in either mode alone.

**The rule that removes it: a roster that brings its own identity may print and be
forgotten; a roster whose identity the app had to invent is kept.** So a CSV with student
IDs prints drop-in, a Planbook backup prints drop-in — its ids come pre-assigned — and a CSV
with blank IDs is promoted to a saved class by the act of generating them. Nothing for
anyone to remember, and the reason is honest: minting a permanent identifier is inherently
stateful, so whatever minted it has to hold it.

The rejected alternative was to allow generation in drop-in mode and rest recovery entirely
on the downloaded file. Coherent, but it stakes something irreversible on the one action the
app cannot verify (§21).

**The mode is visible, because mode confusion is the whole risk.** A saved class is an
ordinary tab in the class bar; a dropped-in one is a tab marked as unsaved. A loaded
drop-in roster can be promoted with one button, which is also how most people will discover
persistence at all.

**A store that is not storing must say so, loudly and permanently.** `localStorage` throws
in a private window and can be refused for a `file://` page; `setPref` already returns
`false` and nothing currently looks. A teacher who believes a class is saved and is wrong
finds out next September. Following Planbook's save chip: red, and it stays red, because a
condition that flaps is a condition nobody reads.


## 23 · What `file://` storage actually does

Measured 15 Sep 2026, Chrome on Windows 11, headless with a fresh profile. §19 and §20
both argued from assumptions about this; these are the numbers.

| | |
|---|---|
| `localStorage` from `file://` | **works**, and persists across browser restarts |
| Two local files at different paths | **share one store** — the origin is `file://`, not the path |
| Moving the app's folder | **keeps the data**, for the same reason |
| `file://` ↔ `http://localhost` | **separate stores**, as different origins always are |

Two corrections this forces on things written earlier:

- §19 said Chromium "keys it to the file's path, so it vanishes silently if the folder
  moves." **That is wrong for `localStorage`** — the whole point of the measurement. It
  remains true of IndexedDB, which is one reason not to reach for it here.
- It also means the privacy caveat is real rather than theoretical: **any other local HTML
  file opened in the same browser can read this app's store.** Not a reason to avoid
  storing a roster — the boundary is the same lock on the same drawer as a paper
  gradebook, and Planbook keeps far more sensitive data behind it — but it is a reason the
  store holds a roster and never anything more sensitive than one.

**The consequence that bites in practice:** a year built at `http://localhost` during
development is invisible to the same app opened by double-clicking, and vice versa. They
are not lost, they are in a different box, and the only way between the boxes is the
export file. Which is why import is not optional bookkeeping — an export with no way back
in is half a recovery path, and the same gap separates two computers, two browsers, and a
teacher who has just been given a new laptop.

**Not measured:** Firefox and Safari. Both have historically been stricter about
`file://` than Chromium, and neither has been tested here. Anyone relying on this should
assume Chrome or Edge until that changes.


## 24 · Who this is for, and what that settles

Decided 15 Sep 2026. **This is a standalone app, to be shared with other teachers**, who
will print these rubrics and may also split their own scans into portfolio packets. Not a
personal tool, and **not a Planbook module** — that was considered at length and rejected.

Three things follow, and they are not preferences:

**It has to be a URL.** "Conveniently share" cannot mean a zip of a folder plus `npm
install`. That is the end of `file://` as the distribution story — not today, but as the
destination.

**The splitter has to leave the terminal.** No teacher opens a command line to file a class
set, so a shareable product that keeps the split desk-side is a product whose second half
nobody else can use. [field-test-2026-09-15.md](field-test-2026-09-15.md) measured whether
it can: the same pipeline, in a browser, decoded **18 of 18** codes across the same
108-page scan the Node splitter had just done, and `pdf-lib` wrote the packets. Three of
the four dependencies were browser libraries all along; the fourth exists to fake a canvas.

**§1's two halves lose their technical basis — but only once it is served.** §1 says OAuth
cannot work from `file://`, which is still true. It was also silently carrying "and the
splitter needs Node", which is now false. Serve the app and the first reason goes with the
origin; move the decode into the page and the second goes too. §1 is not repealed here; it
is now contingent on a choice rather than a fact, and that is a different thing to leave in
the file unmarked.

**What is NOT settled** is when. The app works today, on paper, from a file. Nothing here
argues for stopping phase 2 to rebuild the shell — a saved class list is wanted whichever
way the app is delivered, and `app/year.js` is pure and ports unchanged. What this changes
is the target the remaining phases aim at: phase 6 was designed as a Node command because
Drive could not be reached from `file://`, and that premise now has a second answer.

The expensive version of this decision is making it **after** a teacher has a year stored:
then it is a migration between storage engines across an origin change, with the export
file as the only bridge. Which is an argument for settling the *when* before testers start,
not for settling it this afternoon.


## 25 · Served as a PWA, storing nothing on the server

Decided 15 Sep 2026, and it follows from §24 rather than adding to it. The app goes to
`rubricprint.hwgteach.com` as a Cloudflare Pages site, alongside `planbook` and `bbstyler`.
**Nothing is saved to the website.** There is no backend, no API, no analytics, no
third-party script — rosters live in the browser's own storage on the teacher's machine and
are read and written by the page itself.

**The service worker is what pays back what the URL spent.** The original argument for
`file://` was that printing day is when the school network is least trustworthy (§1). A
served page loses that — unless the shell is precached, which it now is. Verified by
killing the server and reloading: the page, all three scripts and the class panel came up
from Cache Storage with nothing listening on the port. That is *better* than `file://`,
because an installed app also survives the folder being moved, the laptop being replaced
and a teacher who has no idea where the file went.

**Installable matters more than it looks.** iOS evicts a non-installed site's storage after
about a week of non-use; home-screen installs are exempt. For an app whose entire value is a
class list that persists, "add to home screen" is data safety rather than polish — Planbook
learned this and says so in its own data model.

Built 15 Sep 2026, as **a row and not a banner**. What it reports — this app is not installed
and there are classes in it to lose — is a standing condition rather than an event, and a
dismissible nag either flaps or teaches people to close it unread, which is the same argument
§22 makes about the save chip. So it sits beside Backup and transfer, which is the other half
of the same worry, it appears only once there is a class to lose, and it goes away when it
stops being true. Where a browser offers `beforeinstallprompt` the row installs; on iOS,
where no browser fires that event because they are all WebKit underneath, it gives the Share →
Add to Home Screen instruction and names the week.

**`localStorage` stays, for now.** Serving makes IndexedDB available and Planbook uses it,
so consistency argues for switching. The counter-argument is size: Planbook's year document
is 3–6 MB because it carries 15k scores and 22k attendance marks, and this one carries
classes and names — a 150-student year is around 15 KB, three orders of magnitude inside the
budget. Synchronous and simple wins until something stores more than a roster. **The
threshold to revisit at** is saved assignments: a rubric library of a hundred pastes is a
few hundred KB, still fine, but it is the first thing that grows without a ceiling.

**What is published is `app/`, not the repository.** Set as the output directory with no
build command, which is also what keeps `data/` and `tools/` off a public server. Details
and the one Cloudflare zone setting that is not in this repo: [deploy.md](deploy.md).

**`file://` still works and is no longer the point.** Opening `app/index.html` from disk
still prints. The manifest and worker fail there and both failures are non-fatal on purpose.
But storage does not cross origins (§23), so the two are separate installations of the same
app, and the export file is the only bridge. Nobody should be told to use both.

---

## 26 · Import replaces a whole year, and is the first thing here that destroys anything

Decided 15 Sep 2026, when import was built. §20 says **v1 has no destructive action at
all** — archiving keeps everything, nothing is deleted — and that is still true of every
button except this one. Importing a year file over a year that is already on the computer
replaces it, and the replaced document is gone.

That is not an oversight and it is not fixable by merging. **Two year documents for the
same year cannot be reconciled**, because the thing that would have to match is the whole
document: two classes with the same name and different rosters, a student in one and not
the other, a `lastStudentSeq` that has moved on in both. Merging would have to guess, and
the thing it would be guessing about is which children are in which class.

So the whole-document replace stands, with three guards, and the guards are the decision:

- **It is proposed with both sides counted.** The confirmation states what is in the file
  and what is on the computer — classes, students, and when each was last changed — before
  either is touched. §6, at its most literal.
- **It offers to export what it is about to replace**, in the same panel, and taking that
  download does not dismiss the confirmation. Downloading is not deciding.
- **Every refusal ends with "Nothing on this computer has been changed."** Build, validate,
  then swap: `readYearDocument` parses, walks the migration ladder and checks the shape
  against what `newYearDocument()` produces, and `app.js` writes nothing until it has
  returned. A half-applied import would be worse than a refused one, because the thing it
  half-replaced is the class list.

**Recognition is one field, deliberately.** `lastStudentSeq` is what says a document is
ours; everything else about it is `validateYearDocument`'s job to report precisely. Deciding
"not ours" because some other field is the wrong shape would send a damaged export down the
branch that says it is a Planbook backup — a true sentence about the wrong file.

**Detection order, for the third time (§18, and the roster reader).** A Rubric Print export
is checked for before Planbook, because it is also a year document with `schemaVersion`,
`year`, `classes` and `students`, and it satisfies `looksLikePlanbook` on every field. In
the other order, dropping an export on the roster box opened the class picker and printed
from *placeholder* folder IDs, discarding the real ones the file was carrying — which no
message anywhere would have mentioned.

What is still owed is the other half: a **delete**, with a confirm that counts what it
destroys. §20 called that a later decision rather than an omission, and it still is — but
"no destructive action" has stopped being a description of the app, and this is where that
changed.

---

## 27 · A Planbook backup creates classes; printing from it without saving is the smaller path

Decided 15 Sep 2026. **This changes what the file is for.** §18 made a Planbook year backup
a third roster source: browse it, pick a class, print, save nothing. It now offers first to
**create its classes in this year, fully populated**, which is the thing a September
afternoon actually wants — a whole timetable in one action instead of a CSV per section.

Printing one without saving stays, on every row. §22 says a roster that brings its own
identity may print and be forgotten, and Planbook's ids are pre-assigned, so that path is
legitimate. It is now the *second* offer rather than the only one, in the same way drop-in
went underneath the class list.

**Two ids are kept, and the second one is the less obvious.**

Planbook's **student** ids come across unchanged. That is §20's whole mitigation for the
drift this accepts — two systems holding a roster for the same children — because `s_…`
surviving is what makes a later update *reconcile* rather than mint a second identity for
everyone (§21, §26).

Planbook's **class** id is kept as ours. Our class ids are `c_` plus ten characters and so
are Planbook's, so nothing downstream can tell which minted a given one — and it means
dropping the same backup in again *finds the class it already made* and offers to update it,
instead of building a second one beside it. **A name is not a key**: two years of "Period 1 —
English 10" are different classes, and a class renamed mid-year is still the same class.
Where a class of the same name already exists under a *different* id, that is named on
screen and not merged, because merging on a name is exactly how two years become one roster.

**Seeding is all-or-nothing.** Every selected class is read and checked before any of them
is created, so a backup with one dangling roster id does not leave three classes made, a
fourth half-made, and a panel showing a year nobody asked for. Same rule the splitter runs
on: nothing is written when a student is missing.

**The backup is put away once its classes are real**, and this is the part that would
otherwise rot. Leaving it loaded leaves two sources for the same class on screen at once —
the saved class and the snapshot it came from — with nothing saying which a tab is printing
from. For the same reason, §19's remembered-class shortcut now only fires while the backup
is *purely* a drop-in: once any of its classes has been created here, the picker is shown
rather than jumping straight to printing from the staler of the two copies.

**What this does not do** is sync. Nothing is written back to Planbook, and a class created
here drifts from the backup it came from the moment either is edited. The update path is
manual, asks before it drops anybody, and is the only reconciliation there is.

---

## Deliberately not built

| | note |
|---|---|
| Drive filing | The PoC stops at per-student PDFs. This is the obvious next piece. |
| Folder matching, creation, moving | Drawn and disabled in the mockups. Folder IDs come from the CSV for now, and §15 is what makes that safe to live with: placeholder IDs can print for a term and still split once the real ones arrive. |
| Saving assignments and reloading them | **Not built.** An assignment carries no student data, so unlike a roster it is freely shareable — and unlike a roster it is *meant* to freeze (§7), which is why the objection in §20 does not apply to it. The format is open: JSON round-trips the sanitised HTML exactly and already exists as `data/assignment-sample.json`; markdown with frontmatter reads better and shares better but handles tables badly, which phase 5 cares about. Decide it there. (An earlier version of this row cited a markdown sketch "in the mockup notes". There is no such sketch — the word `frontmatter` appears nowhere outside this file.) |
| Splitting one Doc that holds several prompts | Deferred entirely by pasting front and back separately. The sample Doc holds five prompts for one essay. |
| Multi-class printing | **Built for a Planbook year (§19)** — the class bar switches period and the paste carries across. Not available from a CSV, which holds one class. |
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
