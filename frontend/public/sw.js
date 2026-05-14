const CACHE = 'skynet-v2';

// On install: cache '/' and parse every script/link src out of the HTML so
// all Vite-hashed bundles are available offline from the very first visit.
async function precacheAll() {
  const cache = await caches.open(CACHE);

  const res = await fetch('/');
  await cache.put('/', res.clone());

  const html = await res.text();
  const urls = [];
  const re = /(?:src|href)="(\/[^"?#]+)"/g;
  let m;
  while ((m = re.exec(html))) {
    if (!m[1].startsWith('/api/')) urls.push(m[1]);
  }

  await Promise.allSettled(
    urls.map(async (url) => {
      try {
        const r = await fetch(url);
        if (r.ok) await cache.put(url, r);
      } catch {}
    })
  );
}

self.addEventListener('install', (e) => {
  e.waitUntil(precacheAll().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Never intercept API calls — let them hit the network directly
  if (url.pathname.startsWith('/api/')) return;

  if (e.request.mode === 'navigate') {
    // Navigation: serve cached shell instantly, refresh in background
    e.respondWith(
      caches.match('/').then((cached) => {
        const networkUpdate = fetch(e.request)
          .then((res) => { if (res.ok) caches.open(CACHE).then((c) => c.put('/', res.clone())); return res; })
          .catch(() => {});
        return cached || networkUpdate;
      })
    );
    return;
  }

  // Static assets: cache-first, background refresh
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const networkUpdate = fetch(e.request)
        .then((res) => { if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone())); return res; })
        .catch(() => cached);
      return cached || networkUpdate;
    })
  );
});
