/* Rendering PDF pages to pixels, and reading routing codes out of them.
   Shared by verify-sheet.mjs and split.mjs so both crop to the same rectangle. */
import { readFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import jsQR from 'jsqr';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

/* ── The splitter contract ───────────────────────────────────────────────────
   app/index.html puts the routing code at left 674px, top 48px, 94 × 94px on an
   816 × 1056 page. As fractions of the page that is x 0.826–0.941, y 0.046–0.134,
   and a real scan measured 0.832–0.928 × 0.052–0.125 with under half a degree of
   skew — so the sheet and the paper agree.

   The window is widened well past that and still covers about a tenth of the page.
   It was widened from 0.74/0.21 after a real scan: jsQR read the code on only two
   of five pages in the tighter window and on all five in this one, with the code
   sitting comfortably inside both. The narrow window was a pathological case for
   jsQR's tile-based thresholding rather than a positioning error — see binarize().
   Change the sheet layout and change this. */
export const CROP = { x0: 0.65, y0: 0.00, x1: 1.00, y1: 0.30 };

/* 300 DPI puts a 2cm version-4 symbol at ~7.2 px per module. jsQR wants about 3,
   so there is real margin — and the render is never the bottleneck, the scan is. */
export const DPI = 300;

export async function openPdf(path) {
  const data = new Uint8Array(await readFile(path));
  return pdfjs.getDocument({ data, useSystemFonts: true }).promise;
}

/* Renders one page, optionally only a crop of it. Passing a crop makes pdfjs
   rasterize just that region rather than the whole page, which is a ~20x saving
   on both the render and the decode. */
export async function renderPage(doc, pageNo, { dpi = DPI, crop = null } = {}) {
  const page = await doc.getPage(pageNo);
  const scale = dpi / 72;
  const full = page.getViewport({ scale });

  let viewport = full;
  let width = Math.ceil(full.width);
  let height = Math.ceil(full.height);

  if (crop) {
    const left = Math.floor(full.width * crop.x0);
    const top = Math.floor(full.height * crop.y0);
    width = Math.ceil(full.width * (crop.x1 - crop.x0));
    height = Math.ceil(full.height * (crop.y1 - crop.y0));
    viewport = page.getViewport({ scale, offsetX: -left, offsetY: -top });
  }

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  page.cleanup();

  return { ctx, canvas, width, height };
}

/* Otsu's method: pick the threshold that best separates the histogram's two peaks,
   then force every pixel to pure black or pure white.

   This is not a nicety. On the first real scan jsQR read only two of five codes
   straight from the rendered crop and all five once binarized — a scanned page
   arrives as anti-aliased greys with paper texture, and jsQR's own tile-based
   binarizer can pick a poor threshold on a small, mostly-white crop. Deciding
   black-and-white ourselves over the whole crop removes that variable, and it
   should only help further once these sheets have been through a photocopier. */
export function binarize(pixels) {
  const histogram = new Array(256).fill(0);
  const grey = new Uint8Array(pixels.data.length / 4);
  for (let i = 0; i < grey.length; i++) {
    const value = (pixels.data[i * 4] * 0.299 +
                   pixels.data[i * 4 + 1] * 0.587 +
                   pixels.data[i * 4 + 2] * 0.114) | 0;
    grey[i] = value;
    histogram[value]++;
  }

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * histogram[t];
  let sumBelow = 0, countBelow = 0, bestVariance = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    countBelow += histogram[t];
    if (!countBelow) continue;
    const countAbove = grey.length - countBelow;
    if (!countAbove) break;
    sumBelow += t * histogram[t];
    const meanBelow = sumBelow / countBelow;
    const meanAbove = (sum - sumBelow) / countAbove;
    const variance = countBelow * countAbove * (meanBelow - meanAbove) ** 2;
    if (variance > bestVariance) { bestVariance = variance; threshold = t; }
  }

  const out = new Uint8ClampedArray(pixels.data.length);
  for (let i = 0; i < grey.length; i++) {
    const value = grey[i] > threshold ? 255 : 0;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = value;
    out[i * 4 + 3] = 255;
  }
  return out;
}

/* A decoded code, or null. jsQR also reports the symbol's corners, which is how
   verify-sheet checks the code landed where the sheet promised it would. */
export function readCode({ ctx, width, height }, { threshold = true } = {}) {
  const pixels = ctx.getImageData(0, 0, width, height);
  const found = jsQR(threshold ? binarize(pixels) : pixels.data, width, height);
  if (found) return { payload: found.data, corners: found.location };

  /* One retry on the untouched greys. Otsu assumes two clear peaks; a crop that is
     almost entirely paper has only one, and then the raw image is the better bet. */
  if (!threshold) return null;
  const raw = jsQR(pixels.data, width, height);
  return raw ? { payload: raw.data, corners: raw.location } : null;
}

/* folderId|runId|studentId — anything else is reported rather than guessed at. */
export function parsePayload(payload) {
  const parts = String(payload).split('|');
  if (parts.length !== 3) return { ok: false, reason: 'not three fields', payload };
  const [folderId, runId, studentId] = parts;
  if (!folderId || !runId || !studentId) return { ok: false, reason: 'empty field', payload };
  return { ok: true, folderId, runId, studentId, payload };
}
