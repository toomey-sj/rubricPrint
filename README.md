# Rubric Print

One personalized double-sided sheet per student — assignment prompt and a routing
code on the front, scoring rubric on the back. Students hand the sheet in on top of
their work; the whole class stack goes through a duplex copier as one PDF; the
splitter cuts that PDF back into per-student PDFs by the codes.

This is the proof of concept. Filing into Google Drive is not built yet, and
nothing here touches the network.

## Two halves, two sets of rules

**`app/`** is the print surface. Open `app/index.html` by double-clicking it — no
server, no install, no network. Zero dependencies, no build step, no ES modules, so
it still works on the morning the school network is down.

**`tools/`** is the desk-side splitter. It needs npm packages and it runs from a
terminal. It has no offline constraint, because it runs after class rather than
during it.

## Printing

1. Open `app/index.html`.
2. Click the first dashed box and pick a roster CSV (`data/roster-sample.csv` is the
   shape). Columns are matched on their headers and the match is shown on screen, so
   a wrong guess is visible rather than silent.
3. Paste the assignment into **Front** and the scoring into **Back**, straight from
   your Google Doc. Headings, bold, lists and tables come across; Doc fonts and
   colours do not — the sheet uses one type style so every assignment prints alike.
4. Fill in the assignment fields. Watch the byte counter under **Run ID**: the code
   holds 62 bytes and the app refuses to print past that rather than shrinking the
   symbol.
5. Read the pre-flight panel. It will not enable **Print** until six things hold —
   see below.
6. Print **double-sided, flipped on the long edge**, scale **100%**, margins
   **none**, headers and footers **off**.

On the short edge every scoring side comes out upside down. On fit-to-page the code
shrinks below what a copier can read.

## Two roster formats, on purpose

**Import is CSV**, because that is what a spreadsheet exports. **Save is JSON**,
because that is the app’s own format and it round-trips without guessing at columns
again. The app reads either: a CSV is a fresh export, a JSON is a roster saved
earlier.

The splitter reads JSON. So after importing a real class, click **Save as JSON** and
keep that file next to the scan — that saved roster is the handoff between the two
halves.

## What the pre-flight guarantees

| Check | Why it exists |
|---|---|
| 2 pages per student | Anything else shears the duplex run for everyone after it |
| Fronts and backs alternate | Same |
| Every side fits its page | Overflow is clipped, not reflowed — so it must be caught on screen |
| One code per sheet, front only | A second code would start a phantom packet |
| Every code at 674, 48 | That is the rectangle the splitter crops to |
| No background fills | Browsers omit backgrounds unless the viewer ticks a box that is off by default |

## Splitting

```
cd tools
npm install
node split.mjs ../data/out/scan.pdf --run SRE1-2026-09-18 --out ../data/out/packets
```

The report matters more than the PDFs. It names every packet, its page range, and
anything suspicious. **When a student is missing, nothing is written** — a
half-correct split that gets filed is worse than no split, because the mis-filing is
invisible.

If a code will not decode, the splitter dumps the top-right crop of each candidate
page to `undecoded/`. The sheet prints its run ID in readable type under the square,
so you read it with your eyes and hand it back:

```
node split.mjs scan.pdf --run SRE1-2026-09-18 --force-code 7=<that student's folder id>
```

## Checking it without paper

```
cd tools
node qr-selftest.mjs      # encode all five payloads, decode them back with jsQR
node packets-test.mjs     # the boundary rule and every way it goes wrong
node make-test-scan.mjs   # synthesize a duplex scan from a printed sheets.pdf
node verify-sheet.mjs ../data/out/sheets.pdf --run SRE1-2026-09-18
```

`verify-sheet.mjs` is the one that earns its keep: it reads the *printed* PDF through
the same crop the splitter uses, so it proves the codes are readable and correctly
placed before a sheet of paper is spent.

`make-test-scan.mjs --break leading|missed|duplicate` mutates the synthetic scan to
rehearse each failure.

## The QR code

Version 4, error-correction level M, byte mode, 33 × 33 modules, printed at 2 cm.
Payload is `folderId|runId|studentId` — 54 bytes into 62 of capacity.

Byte mode is forced: a Drive folder ID is mixed case with `-` and `_`, which
alphanumeric mode cannot encode. The version is capped at 4 on purpose — a longer
payload fails loudly rather than stepping up to a denser symbol with a worse scan
margin. At 2 cm a version-4 module is about 7 px in a 300 DPI scan and 4.8 px at
200 DPI; jsQR needs roughly 3.

`app/qr.js` is a from-scratch encoder because there is no dependency-free one that
runs from `file://`. It is ~400 lines and covers exactly the slice of ISO/IEC 18004
this needs.

## Not built yet

Drive filing, folder matching and creation, markdown save and reload, splitting one
Doc that holds several prompts, multi-class printing. Blank-page detection is not
needed at all: blank backs are kept and filed, because a blank side is the evidence
that the scanner caught the page and the student really did leave it empty.
