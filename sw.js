/* sw.js — offline app shell. API calls always go to the network.

   Strategy matters here: the app's code (HTML/CSS/JS) is fetched
   NETWORK-FIRST with a cache fallback, so every fix we ship reaches users on
   their next open instead of being trapped behind a cache-first shell forever
   (which is exactly what v1 of this file did). Static assets that never
   change (icons) stay cache-first. */

const CACHE = 'frenz-v19';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/db.js',
  './js/personas.js',
  './js/api.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function networkFirst(req) {
  return fetch(req).then(res => {
    if (res.ok && req.method === 'GET') {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' }));
}

function cacheFirst(req) {
  return caches.match(req).then(cached => cached || networkFirst(req));
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never intercept the model APIs (or any cross-origin request).
  if (url.origin !== location.origin) return;
  const isCode = e.request.mode === 'navigate' ||
    /\.(html|css|js|webmanifest)$/.test(url.pathname) ||
    url.pathname.endsWith('/');
  e.respondWith(isCode ? networkFirst(e.request) : cacheFirst(e.request));
});
