/*
  Rubric Print service worker — the app shell, cached, so an installed copy opens
  with the network off.

  That is not a nicety here. The original reason this app ran from `file://` was
  that printing day is exactly when the school network is least trustworthy
  (decisions.md §1). Serving it gives that up unless the shell is precached — so
  this file is what pays back the guarantee the move to a URL spent.

  Two rules, and the second is the one that gets broken by accident later:

    1. THE CACHE OWNS THE SHELL; localStorage OWNS THE DATA. Never cache a
       roster, never cache a response from another origin. A stale copy of a
       class list is worse than none, and a catch-all fetch handler is how
       somebody else's data ends up in the Cache Storage of a shared laptop. The
       origin test in `fetch` below is that rule written as code.

    2. SHELL is hand-maintained and CACHE is hand-bumped. Add a file to app/ and
       it will work in every test you run — a live network serves it — and then be
       missing the first time a teacher opens the app on a plane. Add it to SHELL
       and bump CACHE in the same commit that creates the file.

  Borrowed wholesale from Planbook's sw.js, including the two scars below, which
  were paid for on a live domain rather than found by reading.
*/

/* Bump on every deploy that changes anything in SHELL. The name IS the version:
   `activate` deletes every cache that is not this one, which is what makes a
   deploy replace the shell rather than layer on top of it. */
const CACHE = 'rubric-print-shell-v1';

/* `./index.html` is deliberately NOT in this list, and putting it back breaks the
   app on the first navigation. Cloudflare Pages answers `/index.html` with a 308
   to `/`. `addAll` follows that redirect and stores a response whose `redirected`
   flag is set; serving one of those to a navigation is a spec violation, and
   Safari refuses it outright with "the response served by the service worker has
   redirections" — a white screen on the home-screen icon. `./` is the same bytes
   without the redirect, and it is what a teacher's URL asks for anyway.

   Inherited from Planbook, where it was found on a live iPad minutes after the
   domain went up. Nothing local could have caught it: the redirect is the host's,
   so it does not exist until the app is on Pages.

   No apostrophes inside this array, comments included — Planbook has a checker
   that reads it by matching quoted strings, and one apostrophe swallows every
   entry to the next one. Same convention here so the list can be checked the same
   way when that script is worth writing. */
const SHELL = [
  './',
  './manifest.webmanifest',
  './app.js',
  './qr.js',
  './year.js',
  './icons/icon-152.png',
  './icons/icon-167.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  /* No waiting for every old tab to close. A shell update that sits behind a tab
     somebody left open all term is an update nobody gets. */
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names.filter((n) => n !== CACHE).map((n) => caches.delete(n))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  /* Anything that is not a plain same-origin GET goes to the network untouched
     and unstored. */
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  /* A navigation TO THE APP has to land on the cached shell, or a home-screen
     launch with the network off shows the browser's offline page — which, to
     someone whose class list is in there, reads as data loss.

     THE PATH TEST MATTERS. Answering every navigation out of the cache is fine
     while the app is the only document at this origin, and wrong the moment one
     is added: a privacy page, a help page, anything. Planbook shipped that bug
     and its policy URL rendered the gradebook on every device with the worker
     installed — invisible from exactly where it gets tested, because a cold fetch
     has no worker and sees the right page.

     So: the app's own document comes from the cache, and anything else at this
     origin falls through untouched. */
  if (req.mode === 'navigate') {
    if (url.pathname === self.registration.scope.replace(self.location.origin, '') ||
        url.pathname === '/' || url.pathname.endsWith('/index.html')) {
      event.respondWith(
        caches.match('./', { ignoreSearch: true })
          .then((hit) => hit || fetch(req))
      );
    }
    return;
  }

  /* Cache first for the shell, because it is versioned by CACHE and a network
     round trip buys nothing. Anything not in the cache goes to the network and is
     NOT added — the list is hand-maintained on purpose, so a silent runtime cache
     would hide exactly the omission rule 2 exists to catch. */
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req))
  );
});
