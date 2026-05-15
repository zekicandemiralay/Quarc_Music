const CACHE = 'skynet-v5';

self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { pathname } = new URL(e.request.url);

  // Never intercept API calls
  if (pathname.startsWith('/api/')) return;

  // All app shell requests (navigation + static assets): cache-first.
  // Vite content-hashes JS/CSS so cached assets are always valid.
  // HTML is served from cache immediately then refreshed in the background —
  // this eliminates the ~10s offline timeout from a network-first strategy.
  e.respondWith(
    caches.match(e.request.mode === 'navigate' ? '/' : e.request).then((cached) => {
      const networkFetch = fetch(e.request).then((res) => {
        if (res.ok) {
          const key = e.request.mode === 'navigate' ? '/' : e.request;
          caches.open(CACHE).then((c) => c.put(key, res.clone()));
        }
        return res;
      }).catch(() => null);
      return cached || networkFetch;
    })
  );
});
