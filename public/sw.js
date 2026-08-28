const CACHE = 'pv-v2';
const STATIC_ASSETS = [
  '/',
  '/predictions.html',
  '/pricing.html',
  '/statistics.html',
  '/blog.html',
  '/images/logo.png',
  '/images/logo.svg',
  '/manifest.json',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Network-first for API calls (always fresh data)
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // Network-first for CSS and JS — always get the latest, cache as fallback
  if (/\.(css|js)$/.test(url.pathname)) {
    e.respondWith(
      fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
        }
        return res;
      }).catch(() => caches.match(request))
    );
    return;
  }

  // Cache-first for images and fonts (change rarely)
  if (/\.(png|svg|webp|jpg|jpeg|woff2?|ico)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Network-first for HTML pages, fallback to cache
  e.respondWith(
    fetch(request).then(res => {
      if (res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(request, clone));
      }
      return res;
    }).catch(() => caches.match(request).then(cached => cached || caches.match('/')))
  );
});
