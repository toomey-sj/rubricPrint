# Field test — 14 Sep 2026

First run on physical paper. Five fictional students, printed from `app/index.html`,
photocopier-scanned, split by `tools/split.mjs`. The PDFs and scans this produced have
been deleted; these are the measurements worth keeping.

**Result: the loop closes.** Generate a code → print it → scan it → decode it → cut the
stack → land in the right file. That was the only genuinely unknown part of the project.

## Two scans

| | pages | packets | codes read from the crop | issues |
|---|---|---|---|---|
| 06:48 — single-sided by accident | 12 | 5 of 5 | 2 of 5 | 2 odd-page warnings, correct |
| 06:53 — duplex | 24 | 5 of 5 | **5 of 5** | **none** |

The first scan came out single-sided because that was the copier's default: five sheet
fronts plus seven handwritten pages. The odd-page warnings were the duplex parity check
doing its job — two packets had an odd number of pages, which is impossible in a real
duplex scan.

The second scan is the clean one. Every packet an even number of pages, every output PDF
verified to carry the routing code its own filename claims.

| student | pages | |
|---|---|---|
| Shakespeare | 4 | sheet + 1 written sheet |
| Dickinson | 4 | sheet + 1 |
| Whitman | 6 | sheet + 2 |
| Frost | 4 | sheet + 1 |
| Angelou | 6 | sheet + 2 |

## Where the code actually lands on paper

Measured across the five coded pages of the first scan, as fractions of the page:

| | measured | the sheet's own geometry |
|---|---|---|
| x | 0.832 – 0.928 | 0.826 – 0.941 |
| y | 0.052 – 0.125 | 0.046 – 0.134 |
| skew | under 0.5° | — |
| symbol | 20.1 – 20.5 mm | 20.0 mm |

Printer and scanner are hitting the target to within a pixel. **Position has never been
the problem** — worth remembering if decoding ever regresses, because the instinct will
be to widen the crop and that would be treating the wrong thing.

## The bug this found, and the evidence for the fix

On the first scan only two of five codes read from the cropped region; the rest needed a
full-page pass. Cropping the same pixels out of a full-page render failed identically, so
it was never the viewport-offset mechanism.

It was **thresholding**. A scanned page arrives as anti-aliased greys with paper texture,
and jsQR's tile-based binarizer picked a poor threshold on a small, mostly-white crop.

Measured across the five real coded pages:

| variant | hit rate |
|---|---|
| the old crop, 0.74–1.00 × 0.00–0.21 | **2 / 5** |
| the old crop + Otsu threshold | 5 / 5 |
| a tighter crop | 5 / 5 |
| a wider crop | 5 / 5 |
| full page, 300 DPI | 5 / 5 |
| full page, 200 DPI | 5 / 5 |

Only that one exact window failed, which makes it a pathological case rather than a
direction to tune in. Fix was both, because they are independent: Otsu-threshold the crop
before handing it to jsQR, and widen the window to 0.65–1.00 × 0.00–0.30. Commit `62c628b`.

After the fix, all five read from the crop with no fallback.

## Blank backs survive

Ink coverage per page on the duplex scan found **five fully blank sides** (pages 4, 12, 18,
22, 24) plus several under 1%, which is ruled paper with almost nothing on it. The copier
kept them, the splitter kept them, and each one is inside the right student's PDF.

That is the evidence trail working as intended: if a student says they wrote on the back,
the blank page is in their folder proving the scanner saw it and it was empty.

## Still unproven

- **Handling wear.** Both scans were of sheets that went straight from the printer to the
  scanner. Untested: a sheet creased in a backpack, with a fold through the code.

  Photocopy generation loss was originally listed here and is a mistake. Personalized
  sheets cannot be mass-copied from a master, so every sheet is first-generation in normal
  use — which is what these scans already were.
- **A full class.** Five students, not thirty. Nothing suggests a scaling problem — the
  splitter is linear in pages — but the stack has never been deep enough to jam a feeder.
- **Whose handwriting is whose.** The codes, page counts and filenames were verified
  mechanically. Nobody has confirmed by eye that the pages inside Whitman's PDF are the
  pages that went behind Whitman's sheet.
