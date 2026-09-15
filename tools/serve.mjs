/* The local server, so the app can be run the way it will actually be deployed.

   THE PORT IS PART OF THE ORIGIN. A class saved at localhost:8080 is invisible at
   localhost:8081 — different origin, different storage, and the app comes up
   looking like it lost everything. So the port is pinned here rather than passed
   in, and `--port` exists only for the case where something else already holds it,
   with a warning attached. (decisions.md §23 measured the same thing across
   file:// and http.)

   ROOT IS app/, NOT THE REPOSITORY, which is the point: Cloudflare Pages publishes
   app/ as the site root (docs/deploy.md), so serving anything else here would mean
   testing a layout that never ships. The service worker's scope, the manifest's
   start_url and every relative path then behave locally exactly as they will live.

   Plain http rather than https, because **localhost is a secure context anyway** —
   service workers register, the app installs, and nobody has to trust a
   self-signed certificate. That changes the day this needs OAuth, and not before.

   Node builtins only. The app has no dependencies and neither does the thing that
   serves it.

   Run:  node serve.mjs            (from tools/)
         npm start                 (same thing) */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize, sep } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, '..', 'app');
const REPO = join(HERE, '..');

const PORT_DEFAULT = 8080;
const args = process.argv.slice(2);
const portFlag = args.indexOf('--port');
const PORT = portFlag !== -1 ? Number(args[portFlag + 1]) : PORT_DEFAULT;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.pdf': 'application/pdf'
};

createServer(async (req, res) => {
  const raw = decodeURIComponent(req.url.split('?')[0]);

  /* Nothing may climb out of what is being served. `normalize` collapses the
     traversal and the leading-.. strip catches what is left. */
  const clean = normalize(raw).replace(/^([.][.][\\/])+/, '');
  const asPath = raw.endsWith('/') ? join(clean, 'index.html') : clean;

  /* /data/ is served from the REPOSITORY, and only here. It is how the `?demo`
     fixture reaches data/roster-sample.csv so tools/verify-sheet.mjs can print a
     PDF headlessly. Cloudflare Pages publishes app/ alone, so none of this exists
     on the deployed site — which is correct: data/ is where a real class would sit.
     If the fixture is ever wanted in production, the fixtures move inside app/
     rather than this rule moving to the host. */
  const underData = /^[\\/]?data[\\/]/.test(asPath);
  const root = underData ? REPO : APP;

  try {
    const body = await readFile(join(root, asPath));
    res.writeHead(200, {
      'Content-Type': TYPES[extname(asPath)] || 'application/octet-stream',
      /* Never let the browser hold the shell locally — the whole point of running
         here is to see the edit you just made. Production pins this deliberately
         and differently; see app/_headers. */
      'Cache-Control': 'no-store'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('not found: ' + raw);
  }
}).listen(PORT, () => {
  console.log('\nRubric Print — http://localhost:' + PORT + '/\n');
  console.log('  serving   ' + APP + sep);
  console.log('  and       /data/  from the repo, for the ?demo fixture only\n');
  if (PORT !== PORT_DEFAULT) {
    console.log('  ⚠  Not the usual port. Saved classes belong to the ORIGIN, so');
    console.log('     anything stored at :' + PORT_DEFAULT + ' will not be visible here,');
    console.log('     and anything saved here will not be there.\n');
  }
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('\nPort ' + PORT + ' is already in use — most likely this server is');
    console.error('already running in another terminal. Use that one rather than a new');
    console.error('port: a different port is a different origin, and your saved classes');
    console.error('would not be there.\n');
    process.exit(2);
  }
  throw err;
});
