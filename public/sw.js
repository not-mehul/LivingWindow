// Living Window's service worker: keeps the window opening without a connection.
//
// - The page itself: network first (so updates arrive at once), falling back
//   to the last copy when offline.
// - Fingerprinted bundles in assets/: cache first (they never change).
// - Everything else of ours (icons, the manifest, optional recordings):
//   served from the cache when there, refreshed in the background.
// Old fingerprinted bundles are pruned when the page they belonged to is
// replaced.
const CACHE = 'living-window-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Only our own files: radio streams and anything else elsewhere pass straight through.
  if (url.origin !== self.location.origin) return;
  // Range requests (media seeking) aren't cacheable; let the network have them.
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put('./', copy)).then(pruneAssets));
          }
          return response;
        })
        .catch(() => caches.match('./').then((cached) => cached ?? Response.error())),
    );
    return;
  }

  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
            }
            return response;
          }),
      ),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? fresh;
    }),
  );
});

/** Drop cached bundles the current page no longer refers to (after an update). */
async function pruneAssets() {
  const cache = await caches.open(CACHE);
  const page = await cache.match('./');
  if (!page) return;
  const html = await page.text();
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    const name = path.split('/').pop();
    // Only entry bundles are named in the page; lazily loaded chunks are kept.
    if (path.includes('/assets/index-') && name && !html.includes(name)) await cache.delete(request);
  }
}
