// Assembles parts/<Name>.body.html + parts/book.css into <Name>.dc.html artboards.
// The book CSS is shared so every artboard is provably built from the same literal
// values as style-guide.html; per-artboard extras go in <Name>.extra.css.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..');
const book = readFileSync(join(HERE, 'book.css'), 'utf8');

const names = readdirSync(HERE)
  .filter((f) => f.endsWith('.body.html'))
  .map((f) => f.replace('.body.html', ''));

// <!--QR:sheet--> pulls in parts/qr-sheet.svg, so the artboard bodies stay readable
// instead of carrying a few hundred hand-typed <rect>s each.
const inlineQr = (html) =>
  html.replace(/<!--QR:([a-z-]+)-->/g, (_, which) =>
    readFileSync(join(HERE, `qr-${which}.svg`), 'utf8').trim());

for (const name of names) {
  const body = inlineQr(readFileSync(join(HERE, `${name}.body.html`), 'utf8'));
  const extraPath = join(HERE, `${name}.extra.css`);
  const extra = existsSync(extraPath) ? `\n${readFileSync(extraPath, 'utf8')}` : '';
  const page = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
${book}${extra}
  </style>
</helmet>
${body.trimEnd()}
</x-dc>
</body>
</html>
`;
  writeFileSync(join(OUT, `${name}.dc.html`), page);
  console.log(`built ${name}.dc.html  (${(page.length / 1024).toFixed(1)} KB)`);
}
