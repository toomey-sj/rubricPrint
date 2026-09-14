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

---

## Deliberately not built

| | note |
|---|---|
| Drive filing | The PoC stops at per-student PDFs. This is the obvious next piece. |
| Folder matching, creation, moving | Drawn and disabled in the mockups. Folder IDs come from the CSV for now. |
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
