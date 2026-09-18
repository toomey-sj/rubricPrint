# Working in this repo

One personalized double-sided sheet per student — assignment prompt and a routing code
on the front, scoring rubric on the back. Students hand the sheet in on top of their
work; the class stack goes through a duplex copier as one PDF; the splitter cuts that
PDF back into per-student PDFs by the codes.

**Read [docs/decisions.md](docs/decisions.md) before changing anything structural.** The
code says what it does; that file says why, for the choices where the reasoning is not
recoverable from reading it. Current plan and progress: [docs/roadmap.md](docs/roadmap.md).

## Two halves, two sets of rules

**`app/`** is the print surface. It ships to **rubricprint.hwgteach.com** as a Cloudflare
Pages PWA — static assets, no build step, no backend, **nothing saved to the server**
([docs/deploy.md](docs/deploy.md), `decisions.md` §25). `app/` is the published root, which
is what keeps `data/` and `tools/` off the web. It still opens by double-clicking too: the
manifest and service worker fail non-fatally at a `file://` origin.

Still zero dependencies, no bundler, no ES modules — `sw.js` is the only build-adjacent
piece. Printing day is when the school network is least trustworthy, so the shell is
precached and the app opens with the network off. **Add a file to `app/` and you must add it
to `SHELL` in `sw.js` and bump `CACHE` in the same commit**, or it works in every test you
run and is missing the first time somebody opens the app offline.

**`tools/`** is the desk-side splitter. npm packages are fine and it runs from a terminal,
because it runs after class rather than during it.

**Google's OAuth cannot work from a `file://` origin** — the redirect URI is rejected and
`fetch` sends `Origin: null`. That is not a preference to revisit; it is the reason the
project has two halves. Anything that needs Drive belongs in `tools/`. Nothing that needs
Drive may creep into `app/`.

## Contracts that cannot break

Changing any of these changes the other side too, and needs its reasoning recorded in
`docs/decisions.md` — not in a commit message.

| Contract | Where it lives |
|---|---|
| Routing code at **left 674, top 48, 94 × 94** on an 816 × 1056 page | `app/app.js:8` `QR_BOX` ↔ `tools/lib/pdf.mjs` `CROP` |
| **Exactly 2 pages per student** — `height` not `min-height`, `overflow: hidden`, so content clips loudly instead of reflowing and shearing the duplex run | `app/index.html` `.sheet` |
| **One code per sheet, front only.** A second code starts a phantom packet and cuts every student in half | `app/app.js` `backSheet()`, asserted in `preflight()` |
| **No `background-color` anywhere on a `.sheet`.** Browsers omit fills unless the viewer ticks "Background graphics", which is off by default. Every line is a border or a text colour | `app/index.html`, linted in `preflight()` |
| **A code starts a packet**, and every page after it belongs to that student until the next code. Nothing else is inferred | `tools/lib/packets.mjs` `buildPackets()` |
| **Packets join on `studentId`, never `folderId`.** A packet's `folderId` is the roster's current value — where it goes; `printedFolderId` is what the paper said. Joining on the folder would weld every sheet to the ID that existed at print time | `tools/lib/packets.mjs`, `docs/decisions.md` §15 |
| **62-byte payload budget.** `folderId\|runId\|studentId`, version 4, EC level M, byte mode, capped on purpose so a long payload fails loudly rather than densifying | `app/qr.js`, counter in `updatePayloadSize()` |

The header band is fixed height and `.sheet-head-qr` cannot shrink, because a long name
must truncate rather than push the code out of its rectangle.

## Principles that govern new work

- **The app proposes, a person confirms.** True of columns, packet boundaries, folder
  matches alike. Nothing structural happens invisibly.
- **Nothing is written silently.** A half-correct split that gets filed as if it were clean is
  worse than no split, because the mis-filing is invisible. So a packet whose boundary isn't
  trustworthy is separated and named — a page-ranged bundle in `unresolved/` — rather than
  filed or discarded; a missing student no longer stops the packets that are clean. Reasoning
  and the exact per-issue rule: `docs/decisions.md` §28.
- **Blank backs are kept and filed.** A blank side is evidence that the scanner caught the
  page. The count filed always reconciles with the count scanned.
- **The app has no opinion about rubric shape.** The real rubric is a holistic scale, not a
  criteria × levels grid. Anything that assumes a grid breaks on the first real document.
- **The paste is a snapshot, not a workaround.** The copy the app holds is the record of
  what was actually handed out, and stays true after the Doc is edited next year.

## House style

- **Cite style-guide rule IDs in comments and commit messages** when a rule drove the
  change — `(ARCH-04, CODE-04)`, `CODE-09`. Authority:
  <https://github.com/wildbil2me/edu-style-guide>.
- **Comments explain why, not what.** This codebase is unusually heavily commented on
  purpose, and the comments carry field-test evidence and rejected alternatives. Match that
  density. A comment that restates the line below it is noise; a comment naming the measured
  reason a threshold exists is the point.
- Section banners: `/* ── Name ─────────────────────────── */`.
- `app/` is plain ES5-flavoured script inside an IIFE — `var`, function declarations, string
  concatenation, `'use strict'`. No modules, no arrow functions, no template literals. This
  is not legacy; it is the zero-dependency constraint.
- `tools/` is modern ESM — `const`/`let`, arrow functions, template literals, top-level
  await.
- `tools/lib/packets.mjs` is deliberately pure: no PDF, no filesystem, no rendering. Keep it
  that way, because that is where the boundary rule gets its real test coverage.

## Checking it without paper

**Every tool requires `--roster <path>`** and there is no fallback to the sample — see
`docs/decisions.md` §16. Exit 1 means the paper had problems; exit 2 means the command was
wrong, and goes to stderr.

```
cd tools
npm test                   # all three pure suites, against data/roster-sample.json
node packets-test.mjs --roster ../data/roster-sample.json   # the boundary rule, and every way it goes wrong
node qr-selftest.mjs  --roster ../data/roster-sample.json   # encode all payloads, decode them back with jsQR
node verify-sheet.mjs ../data/out/sheets.pdf --roster ../data/class.json --run SRE1-2026-09-18
node make-test-scan.mjs --roster ../data/class.json         # synthesize a duplex scan from a printed sheets.pdf

node make-class.mjs --students 30 --name "Period 1" --out ../data/class-30.json
node print-sheets.mjs --roster ../data/class-30.json --out ../data/out/sheets-30.pdf

npm start                  # http://localhost:8080/ — and it must be 8080
npm run test:ui            # the app's own screens, in a real browser
```

`npm test` is three pure suites and needs nothing but Node. **`test:ui` is separate
because it needs a browser and a running server**, and it drives the half of the app that
Node cannot reach: which file is being imported and into what, what a confirmation says
before anything is written, and whether a refusal really did leave the store alone. Its
first run found four faults every pure test had passed over. It speaks CDP directly
(`tools/lib/browser.mjs`, node builtins only) — no puppeteer, and no dependency added to
a folder whose other half is dependency-free on purpose.

`verify-sheet.mjs` is the one that earns its keep: it reads the printed PDF through the same
crop the splitter uses, proving the codes are readable and correctly placed before a sheet of
paper is spent. `make-test-scan.mjs --break leading|missed|duplicate` rehearses each failure.

**`print-sheets.mjs` is how a sheets PDF gets made now.** Every one in `data/out` used to be
a person pressing Ctrl+P, which is unrepeatable and does not scale past a class. It drives
the served app through `Page.printToPDF` at the documented settings — margin 0, backgrounds
off, the page's own `@page` rule — so it exercises the same rendering path the print dialog
does. Needs `npm start` and a browser, same as `test:ui`. `make-class.mjs` feeds it a
synthetic class of any size, deterministically, and refuses to write a roster carrying a
repeated ID or name.

**What that costs at scale is measured**, not assumed: time is linear at ~0.2 s a page, and
memory reaches 4.3 GB on a 150-student scan — native buffers, so `--max-old-space-size` does
not touch it. [docs/field-test-2026-09-16.md](docs/field-test-2026-09-16.md).

## Traps

- **Don't widen the crop when decoding regresses.** Position has never been the problem — a
  real scan measured inside the sheet's own geometry to within a pixel. The fix that worked
  was Otsu-thresholding the crop before handing it to jsQR. See `binarize()` and
  [docs/field-test-2026-09-14.md](docs/field-test-2026-09-14.md).
- **Google Docs wraps clipboard HTML** in `<b id="docs-internal-guid-…" style="font-weight:normal">`.
  Keep that `<b>` naively and the entire assignment prints bold.
- **Never reintroduce a default roster path.** Every tool takes `--roster` and fails without
  it. A fallback to the sample means a real class splits against five fictional poets,
  silently, and "no packets found" reads like a scanner fault rather than the wrong file.
- **`app/` cannot `fetch()` a sibling file** from `file://` — the origin is opaque and the
  request is refused as cross-origin. Files arrive through `FileReader` after the user picks
  or drops them. The `?demo` fixture uses `fetch` and therefore only runs over http.

## Roster sources

Three, and they converge on one shape — `{ class, students: [{ id, last, first, folderId }] }`.
A roster CSV, a roster JSON the app saved, and **a Planbook year backup**, which holds
several classes and so asks which one. Planbook detection runs before the roster-shape
check because a Planbook document also has a top-level `students` array; get that order
wrong and it fails with a true, useless message. Reasoning: `docs/decisions.md` §18.

Planbook students carry no portfolio folder, so theirs is `placeholder-<studentId>`. That
works only because packets join on `studentId` (§15). Do not make folder IDs load-bearing
again.

A Planbook year backup now **creates classes in the year document**, keeping both its
student ids and its class ids so a second drop of the same file updates rather than
duplicates (§27). Printing one of its classes without saving is still there, underneath.
The header **class bar** switches between classes and keeps the paste — that is
multi-class printing (§19), and it serves **saved classes and a loaded backup alike**,
never both at once: the backup holds the strip while it is on screen and hands it to the
saved classes once it is put away. Two tabs minimum, because a strip with one tab on it is
furniture. While a backup is purely a drop-in it also gets the remembered-class shortcut;
once its classes have been created, the picker is shown instead, because printing from the
snapshot and printing from the saved class are two different things. Only two ids and a year label persist as preferences,
through a whitelist in `getPref`/`setPref` that refuses undeclared keys.

**That is changing.** Phase 2 makes the app hold the class list — §8's "never authored in
the app" is reversed by §20. Three rules govern it, and they are cheap now and expensive
later:

- **A student ID is permanent once printed** (§21). It is in the QR and on paper. Never
  regenerate. Pre-assigned beats generated; generation is confirmed, year-unique, and
  readable (`2026-0042`) because `--force-code` makes a human type it.
- **Folder IDs are optional — store `null`, never a placeholder** (§20). Synthesise
  `placeholder-<studentId>` at print time so the three-field payload holds. A stored
  placeholder is indistinguishable from a real ID a year on.
- **Identity brought in may be forgotten; identity the app minted is kept** (§22). That is
  what stops a drop-in print generating IDs and losing them with the tab.

The roster document gets its **own** store, not `PREF_DEFAULTS` — that whitelist exists to
keep documents out of `localStorage`, and weakening it to admit one is how it stops
working.

## Not built yet

Drive filing, folder matching and creation, markdown save and reload, splitting one Doc that
holds several prompts, multi-class printing. Blank-page detection is not needed at all.
