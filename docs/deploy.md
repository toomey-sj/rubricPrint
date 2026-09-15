# Deploying to rubricprint.hwgteach.com

**Not deployed yet — running on localhost until it is fit to share.** This file is
the plan, written while the decisions were fresh. To run it now:

```
cd tools
npm start          # http://localhost:8080/
```

**Use that port.** Saved classes belong to the origin, and the port is part of it —
a class saved at :8080 is invisible at :8081 and the app comes up looking like it
lost everything.

Cloudflare Pages, static assets only, **no build**. Same shape as
`planbook.hwgteach.com` and `bbstyler.hwgteach.com`.

## What gets published

**`app/` only** — set as the build output directory, with no build command.

That is not a tidiness choice. It is what keeps `data/` and `tools/` off the public
site: `data/` holds roster fixtures today and is where a real class would land if
anyone ever put one there, and nothing in `tools/` belongs on a web server.

```
Build command            (leave empty)
Build output directory   app
```

The site root is then `app/`, so `index.html`, `sw.js`, `manifest.webmanifest`,
`_headers` and `icons/` all sit at `/`.

## Nothing is sent anywhere

There is no backend, no API, no analytics and no third-party script. The page is
HTML, three scripts and five PNGs. Rosters live in the browser's own storage on the
teacher's machine and are read and written by the page itself — see
[decisions.md §20 and §23](decisions.md).

The one thing to keep true: **never add a script tag pointing off-origin.** The
service worker refuses to cache cross-origin responses on purpose, but it cannot
stop a page from loading one.

## The zone setting that is not in this repo

`app/_headers` pins `Cache-Control: no-cache` on `sw.js` and the shell document. A
Cloudflare zone has its own **Browser Cache TTL**, four hours by default on a new
zone, and it rewrites `Cache-Control` on anything the edge caches — which includes
`.js`.

**Caching → Configuration → Browser Cache TTL → Respect Existing Headers.**

Without it, `_headers` is correct in the repo and does not bind on the wire, and the
first symptom is teachers running a stale service worker for four hours after a
deploy. HTML hides the problem, because the edge does not cache HTML by default.
Planbook hit exactly this on its first deploy. After any zone change, re-read
`/sw.js` on the wire rather than trusting the file.

## Deploying a change to the shell

`CACHE` in [app/sw.js](../app/sw.js) is a hand-bumped string, and `activate` deletes
every cache that is not the current one. So:

1. Add any new file in `app/` to `SHELL` in `sw.js`.
2. Bump `CACHE` — `rubric-print-shell-v1` → `v2` — **in the same commit**.
3. Push. Pages deploys from the repo.

Miss step 1 and it works in every test you run, because a live network serves the
file, and is missing the first time someone opens the app offline.

## Icons

Committed PNGs, drawn by `node tools/make-icons.mjs` — bare Node and zlib, no
dependency. Regenerate rather than editing binaries.

## Known rough edge

`app/index.html?demo` fetches `../data/…`, which is not published. It is a headless
test fixture guarded behind a query string, it is how `verify-sheet.mjs` gets a PDF
to check, and no teacher will reach it — but it is dead on the live site, and if it
is ever wanted there the fixtures have to move inside `app/`.

## Still true: it works from a file

`app/index.html` opened by double-clicking still works. The manifest and the worker
fail to load at a `file://` origin and both failures are non-fatal by design.
Storage does not carry across — `file://` and `https://rubricprint.hwgteach.com` are
different origins, so a class saved in one is invisible to the other (§23). The
export file is the bridge.
