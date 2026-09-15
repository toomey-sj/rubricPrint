# Field test — 15 Sep 2026

Two measurements taken to settle architecture questions that had been argued from
assumption. Neither involved paper.

## 1 · The splitter runs in a browser

**The question.** The project is two halves because `app/` must open from `file://` and
`tools/` needs npm packages and a terminal (§1). If the goal is an app a teacher can be
handed, the terminal half is the wall: nobody is going to install Node to file a class set.
So — do the splitter's dependencies actually require Node, or only the way they are
currently wired?

**The method.** A probe page running the *same* pipeline `tools/lib/pdf.mjs` runs — same
`CROP`, same 300 DPI, the same Otsu `binarize()` copied across, the same jsQR — against the
same 108-page synthetic scan the Node splitter had just processed.

| | Node (`split.mjs`) | Browser probe |
|---|---|---|
| Pages | 108 | 108 |
| Codes decoded | 18 | **18** |
| Distinct payloads | 18 | **18** |
| Wall clock | 12.5 s | 19.5 s (181 ms/page) |

**Identical hit rate.** The browser is about 1.6× slower, which for a class-sized scan is
twenty seconds against twelve and irrelevant next to the scanner itself. The browser figure
also includes pdf.js worker startup.

`pdf-lib` was tested separately in the same page: it loaded the scan, copied a six-page
range into a new document, set the title and subject, and saved — the exact operations
`split.mjs` performs when it writes a packet.

**So the whole loop runs in a browser: read, decode, split, write.**

### What each dependency actually needed

| | |
|---|---|
| `pdfjs-dist` | A **browser** library. `tools/` imports its *legacy Node* build — the unusual one. |
| `jsqr` | Browser-first; already runs beside `app/` in spirit. |
| `pdf-lib` | Pure JS, no Node APIs. |
| `@napi-rs/canvas` | The only genuinely Node-shaped piece, and it exists **to fake a `<canvas>` a browser already has**. |

Three of the four were browser libraries the whole time, and the fourth is a shim for
something the browser provides natively.

### What this does to §1

§1's stated reason for two surfaces is that **Google's OAuth cannot work from a `file://`
origin**. That remains true, and it is unaffected by any of this.

But it was doing double duty. It was also carrying an unstated second claim — that the
splitter *needs* Node — and that one is now disproven. The two reasons come apart:

- Serve the app, and the OAuth objection goes with the `file://` origin.
- Move the decode into the page, and the npm objection goes too.

Neither is disproven for the app **as it stands today**, which is still a `file://` page.
What is disproven is that the split must live in a terminal for technical reasons. It lives
there because that is where it was built.

### Not measured

Memory on a very large scan; a phone or an iPad; Firefox and Safari. A 150-student stack is
~540 pages, five times what was run here, and the probe held one canvas and one page at a
time by design — but "linear and small" is an expectation, not a measurement.

## 2 · `file://` storage

Chrome on Windows 11, headless, fresh profile. Recorded in full at
[decisions.md §23](decisions.md); the short form:

| | |
|---|---|
| `localStorage` from `file://` | works, survives a browser restart |
| Two local files, different paths | **share one store** — the origin is `file://`, not the path |
| Moving the app's folder | keeps the data |
| `file://` vs `http://localhost` | separate stores |

This corrected [decisions.md §19](decisions.md), which had claimed Chromium keys
`localStorage` to the file path so it vanishes when the folder moves. It does not. That
remains true of IndexedDB, which is one reason not to reach for it from a file.

## Reproducing either

The storage probe and the splitter probe were both written to `data/out/`, which is
gitignored, and are gone. The splitter probe is about eighty lines: import
`pdfjs-dist/build/pdf.mjs`, point `GlobalWorkerOptions.workerSrc` at
`pdf.worker.mjs`, render each page at `CROP`/`DPI` into a canvas, copy `binarize()` out of
`tools/lib/pdf.mjs` verbatim, and hand the result to `jsQR`. It needs a static server,
because ES modules do not load from `file://`.
