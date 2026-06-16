const CACHE = '__SW_VERSION__';

// __PRECACHE_MANIFEST__ is injected by the vite build plugin.
// In dev it is undefined, so we fall back to an empty list.
const PRECACHE = self.__PRECACHE_MANIFEST__ || [];

self.addEventListener('install', (e) => {
  // Pre-cache every asset while the user is online so offline works immediately.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all([
        c.add('/'),
        ...PRECACHE.map((url) => c.add(url).catch(() => {})),
      ]))
      .then(() => self.skipWaiting())
  );
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
  if (pathname.startsWith('/api/')) return;

  // Cache-first: serve from cache instantly, refresh in background.
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
