/* Rendering PDF pages to pixels, and reading routing codes out of them.
   Shared by verify-sheet.mjs and split.mjs so both crop to the same rectangle. */
import { readFile } from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import jsQR from 'jsqr';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

/* ── The splitter contract ───────────────────────────────────────────────────
   app/index.html puts the routing code at left 674px, top 48px, 94 × 94px on an
   816 × 1056 page. As fractions of the page that is x 0.826–0.941, y 0.046–0.134.
   The crop below is widened well past that for feeder skew and scan offset, and
   still covers under 5% of the page. Change the sheet layout and change this. */
export const CROP = { x0: 0.74, y0: 0.00, x1: 1.00, y1: 0.21 };

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

/* A decoded code, or null. jsQR also reports the symbol's corners, which is how
   verify-sheet checks the code landed where the sheet promised it would. */
export function readCode({ ctx, width, height }) {
  const pixels = ctx.getImageData(0, 0, width, height);
  const found = jsQR(pixels.data, width, height);
  if (!found) return null;
  return { payload: found.data, corners: found.location };
}

/* folderId|runId|studentId — anything else is reported rather than guessed at. */
export function parsePayload(payload) {
  const parts = String(payload).split('|');
  if (parts.length !== 3) return { ok: false, reason: 'not three fields', payload };
  const [folderId, runId, studentId] = parts;
  if (!folderId || !runId || !studentId) return { ok: false, reason: 'empty field', payload };
  return { ok: true, folderId, runId, studentId, payload };
}
