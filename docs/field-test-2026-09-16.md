# Field test — 16 Sep 2026

Phase 3's synthetic half. Four questions, none of which needed paper, and one of them
turned out to have the opposite answer to the one assumed.

Everything here ran on Windows 11, Node 24.18, headless Chrome, against synthetic classes
built by `tools/make-class.mjs`. **No real class and no real print** — that is still owed,
and it is what the rest of phase 3 is for.

## 0 · Two tools had to exist first

Neither of these is a measurement, but nothing below could be taken without them.

**Nothing in the repo could make a class bigger than 18.** The three sheets PDFs in
`data/out` came from real documents of 5, 12 and 18 students. `tools/make-class.mjs` builds
one of any size, with no randomness at all, so a timing run is comparable against the one
before it and a failure reproduces from the same command.

**Every `sheets.pdf` in this project had been made by a person pressing Ctrl+P.** That is
unrepeatable and does not scale. `tools/print-sheets.mjs` drives the served app and prints
through `Page.printToPDF` at the documented settings — margin 0, backgrounds off, the
page's own `@page` rule — which is the same rendering path the print dialog drives.

## 1 · The print dialog, finally in the loop

**The question.** Phase 1 closed saying its synthetic sheets "prove the tooling but not the
print dialog", because they were generated straight from `app/qr.js` at the sheet's own
geometry. Does a PDF that has actually been through the browser's print path still decode
inside the crop?

**The answer: yes, at every size tried.**

| students | sheet pages | `verify-sheet` | codes decoded |
|---|---|---|---|
| 15 | 30 | PASS | 15 / 15 |
| 30 | 60 | PASS | 30 / 30 |
| 60 | 120 | PASS | 60 / 60 |
| 150 | 300 | PASS | 150 / 150 |

255 fronts, **no decode failures**, no back carrying a code, and every symbol inside the
crop window with 178px of slack at 300 DPI — about 15.1mm of feeder skew before it starts
to clip. The printed symbol measures **20.0mm**, which is the check that catches a print
dialog having quietly scaled the page.

What this does *not* cover is toner, feeder skew and a scanner's own binarisation. It
removes everything between the app and the PDF, and nothing between the PDF and paper.

## 2 · Time is linear, and the assumption holds

**The question.** The roadmap said "nothing suggests a scaling problem — the splitter is
linear in pages — but no feeder has been loaded deep." Confirm it rather than assume it.

| students | scan pages | split | per page | packets |
|---|---|---|---|---|
| 15 | 90 | 14.7 s | 0.164 s | 15 / 15 |
| 30 | 180 | 37.0 s | 0.206 s | 30 / 30 |
| 60 | 360 | 68.8 s | 0.191 s | 60 / 60 |
| 150 | 900 | 196.4 s | 0.218 s | 150 / 150 |

**Linear, at roughly 0.2 s per page across a tenfold range.** A full 150-student year group
splits in three minutes sixteen. Every packet was found at every size.

Printing is not the bottleneck and barely moves: **6.3–7.3 s regardless of class size**, at
a flat ~110 MB. Chrome renders 300 sheet pages about as fast as it renders 30.

## 3 · Memory is the finding, and the usual knob does not touch it

**The question.** "Watch memory." Peak working set, sampled every 150ms.

| students | scan pages | split peak | `verify-sheet` peak |
|---|---|---|---|
| 15 | 90 | 925 MB | 369 MB (30 pages) |
| 30 | 180 | 1,594 MB | — |
| 60 | 360 | 2,843 MB | 1,190 MB (120 pages) |
| 150 | 900 | **4,338 MB** | **2,624 MB** (300 pages) |

Both tools accumulate. `verify-sheet` is the hungrier of the two per page — about 8.7 MB
per page against the splitter's 4.8 — which is counter-intuitive, since it reads half as
many pages and writes nothing.

**The curve flattens between 360 and 900 pages** (2.5× the pages, 1.5× the memory), which
looks like V8 being lazy rather than a leak. So: cap the heap and see whether the peak is a
requirement or an appetite.

| run | wall clock | peak |
|---|---|---|
| default heap | 196 s | 4,338 MB |
| `--max-old-space-size=1024` | 187 s | 4,474 MB |
| `--max-old-space-size=512` | 189 s | **5,780 MB** |

**Capping the JS heap does not reduce the peak. It raises it.** All three runs completed
and found 150 of 150, so this is not a cliff — but it does settle where the memory lives:
**not in V8's old space**, which is the only thing that flag governs.

### Where it actually lives

Asked directly — is this the scan file, or something during the split? — it is neither the
file nor one big allocation. **It is one image buffer per page, and they pile up.**

| | |
|---|---|
| The scan file itself | 16.1 MB for 150 students (3.2 MB for 30). Loaded twice, and irrelevant either way. |
| Normal pass, per page | the crop only — 893 × 990 px at 300 DPI = **3.4 MB** |
| Deep pass, per page | the whole page at 200 DPI — 1700 × 2200 px = **14.3 MB** |

900 pages × 3.4 MB is **2.96 GB**, against ~4.8 MB per page actually observed; the
remainder is pdf.js's own per-page work and the output packets. So the peak is not one
enormous thing, it is nine hundred medium ones that should have been released and were not.
`renderPage` already calls `page.cleanup()`, so pdf.js's side *is* released — it is the
canvas bitmaps that linger, because they are native allocations whose true size V8 cannot
see, so nothing ever makes it feel urgent about collecting them. Which is also why shrinking
the JS heap made the peak worse: the JS heap was never the thing filling up.

**An earlier draft of this note said a rendered page is 2550 × 3300 px / 33.6 MB.** That is
true only of the deep pass, and overstated the common case fourfold — the normal pass never
renders a whole page at all.

### One class at a time, which is what actually happens

The figures above are a whole year group in a single scan. Nobody does that: a class is
printed, collected and scanned as its own stack. Measured at **35 students — a normal
class**, 210 pages:

| | time | peak |
|---|---|---|
| print the sheets | 6.3 s | 105 MB |
| `verify-sheet` | 6.4 s | 734 MB |
| **split, normal** | **23.7 s** | **1.7 GB** — 35 of 35 |
| split, one code scribbled | 122.5 s | 3.5 GB — refused, exit 1 |

**1.7 GB and twenty-four seconds is a non-issue**, less than a browser with a few tabs open.

The bad-day row is the one worth knowing: **a code that will not decode roughly doubles the
memory as well as the time**, because the deep pass renders whole pages rather than corner
crops. 3.5 GB is comfortable on 8 GB of RAM and would struggle on 4 GB.

**And that is the case the teacher's own check removes.** A damaged code spotted while
grading costs one reprinted cover sheet — the symbol is derived from
`folderId|runId|studentId` rather than stored, so a reprint is byte-identical and
interchangeable with the original (decisions.md, Known limits). §13's grade-then-scan order
already puts a human in front of every cover sheet before the scanner sees it, so this is a
check that fits the existing workflow rather than an extra step.

It does not eliminate the deep pass, because the failures that survive a visual check are
the ones that happen *after* it: feeder skew, a fold from handling, a toner streak, the
scanner's own thresholding. Those need paper to measure.

Two consequences, and both are for later phases rather than now:

- **`--max-old-space-size` is not the lever**, so any future fix has to release the native
  buffers — rendering at the crop rather than the page, or `page.cleanup()` per page, or
  reusing one canvas. Untested, all three.
- **A 4 GB laptop will not split a 150-student scan** in one go. An 8 GB one will, with the
  fan on. One class at a time is fine on anything — see above — so the number that belongs
  in the tester's guide is not the scary one: it is *split one class per scan, and a
  scribbled code costs you double*.

**Not measured:** whether the peak is resident pages or reserved address space under
Windows' accounting, and whether the same figures hold on macOS. `WorkingSet64` is resident
memory, which is the number that matters to a laptop, but the split between the two
allocators was not instrumented.

## 4 · All three break modes refuse at thirty

**The question.** At five students a swallowed packet is obvious. At thirty, the
median-length heuristic in `packets.mjs` has real data to work against — does it still
catch each failure, and does the refusal still write nothing?

| break | wall clock | exit | what it wrote |
|---|---|---|---|
| `leading` | 30.0 s | 1 | report + 2 undecoded crops, **no packets** |
| `missed` | 175.7 s | 1 | report + 2 undecoded crops, **no packets** |
| `duplicate` | 30.8 s | 1 | report only, **no packets** |

All three refused, all three exited 1, and **not one packet directory was written in any of
them**. The `undecoded/` folder is the diagnostic crop dump, which is the thing that tells a
teacher which page to look at.

The messages held up at scale. `missed` reported both halves of the failure — the warning
that *Achebe, Chinua has 12 pages against a typical 6* and the error that *no routing code
for Angelou, Ralph was found, their work is most likely inside whichever packet came back
longest* — which is the median-length heuristic doing exactly its job on a thirty-student
median rather than a five-student one.

**A missed code costs six times the wall clock.** 30 s becomes 176 s, because losing a
student triggers the full-page re-scan pass over every page in the scan. At 150 students
that extrapolates to roughly **fifteen minutes** for a stack with one scribbled code in it.
That is not a fault — the deep pass is what recovers the student — but it is a number a
teacher standing at a desk needs to have been told, and it is not currently anywhere on
screen. The splitter says "Looking at the full page for the misses..." and then goes quiet
for a quarter of an hour.

## What this changes

Nothing, deliberately. Phase 3's scope is *measure first; the fixes are their own work,
sized by what turns up*. Three things turned up:

1. The memory ceiling, which belongs in the tester's guide (phase 4) and may justify
   rendering work later — though a normal class never approaches it.
2. The silent fifteen minutes during a deep pass, which is a phase 4 error-message problem —
   the splitter already knows how many pages it is about to re-read.
3. `verify-sheet` costing more per page than the splitter, which nobody had noticed because
   it had only ever been pointed at 60-page documents.

**Still owed for phase 3:** one real duplex run with a real class, after grading the paper
(§13), and the decode rate, full-page-pass count, feeder jams and wall clock from that run
recorded here.
