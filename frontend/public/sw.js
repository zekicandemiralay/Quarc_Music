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

// Friend-request notifications (see backend/src/lib/webPush.js) — the push
// payload is always JSON: { title, body, url }.
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data.json(); } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title || 'Quarc Music', {
      body: data.body || '',
      icon: '/logo.png',
      badge: '/logo.png',
      data: { url: data.url || '/' },
    })
  );
});

// Reuse an already-open tab if there is one (navigating it to the right
// place) rather than opening a second instance of the app.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if ('navigate' in client) {
          try {
            const navigated = await client.navigate(url);
            return navigated?.focus ? navigated.focus() : undefined;
          } catch {
            return client.focus();
          }
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
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
