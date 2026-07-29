/* sw.js — offline app shell. API calls always go to the network.

   Strategy, third iteration, and the reasoning matters:
   - v1 was cache-first per file with no update path: fixes never reached
     users. Bad.
   - v2 was network-first per file: fresh when the network was good — but
     each file raced the network INDEPENDENTLY, so a flaky connection could
     assemble a chimera (today's index.html with last week's app.js). A
     mixed shell fails in the worst possible way: silently, with dead
     buttons, and force-closing doesn't help because the mix is cached.
   - v3 (this): the shell is an ATOMIC SNAPSHOT. install pre-caches the
     whole shell into a versioned cache (addAll is all-or-nothing; a failed
     install leaves the old version intact and consistent). Pages are served
     CACHE-FIRST from that one cache, so every open runs exactly one
     version. When a new worker activates, the page reloads itself once
     (see app.js controllerchange) and comes back on the new version —
     which also retires the old "restart the app twice" ritual. */

/* Bump CACHE and the .app-version badge in index.html together every deploy. */
const CACHE = 'frenz-v89';
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

/* Serve from the CURRENT versioned cache; fall back to network (and adopt
   the response into the cache) only for anything the snapshot missed. The
   version-consistency guarantee comes from serving one cache, filled
   atomically at install. */
function fromShell(req) {
  return caches.open(CACHE).then(c =>
    c.match(req, { ignoreSearch: req.mode === 'navigate' }).then(hit => hit ||
      fetch(req).then(res => {
        if (res.ok && req.method === 'GET') {
          const copy = res.clone();
          c.put(req, copy);
        }
        return res;
      })
    )
  );
}

/* ---- durable transport --------------------------------------------------

   A model call issued from the page dies with the page. Lock the phone,
   switch apps, or let the tab get evicted and the reply that was already on
   its way is simply lost — which is what "it reconnects and loses responses"
   actually is most of the time.

   The service worker outlives all of that. The page hands the request over,
   the worker performs it inside waitUntil (which is what keeps the worker
   itself from being shut down mid-flight), and answers on the port. If the
   reply lands with nobody looking, it raises a notification.

   This worker owns TRANSPORT and nothing else — it never touches storage. A
   reply the page never saw is re-requested when the app reopens (that is
   what the outbox in db.js is for), rather than reconstructed here from a
   parked payload. One recovery path that is always right beats two that can
   disagree about what was already delivered.

   What this canNOT do, and no amount of code will: originate a message with
   the app fully closed. That needs a server pushing to the device, and this
   app deliberately has no server — the API key lives on the phone. */

async function anyoneWatching() {
  const cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return cs.some(c => c.visibilityState === 'visible');
}

async function relay(msg, port) {
  const { id, url, opts, timeout, notify } = msg;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), Math.max(1000, timeout || 150000));
  let payload;
  try {
    const res = await fetch(url, Object.assign({}, opts, { signal: ac.signal }));
    // Response objects are not structured-cloneable, so the parts the caller
    // actually reads are sent across as plain data.
    payload = {
      ok: res.ok, status: res.status,
      body: await res.text(),
      headers: { 'retry-after': res.headers.get('retry-after') || null }
    };
  } catch (e) {
    payload = { error: true, aborted: ac.signal.aborted, message: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
  // The port is a one-shot channel to a page that may no longer exist.
  try { port.postMessage(payload); } catch (_) { /* page is gone; the notification is what is left */ }
  if (notify && !payload.error && !(await anyoneWatching())) {
    try {
      await self.registration.showNotification(msg.title || 'New message', {
        body: msg.preview || 'sent you a message',
        tag: 'frenz-reply', renotify: true,
        icon: './icons/icon-192.png', badge: './icons/icon-192.png',
        data: { id }
      });
    } catch (_) { /* permission not granted — nothing to do about it from here */ }
  }
}

self.addEventListener('message', (e) => {
  const msg = e.data;
  if (!msg) return;
  const port = e.ports && e.ports[0];
  // The handshake. A page controlled by an OLDER worker gets no answer here,
  // which is exactly the signal it needs: without this it would hand a
  // request to a worker that never replies and sit out the full timeout
  // before falling back. Cheap question, immediate answer.
  if (msg.type === 'ping') { if (port) port.postMessage({ pong: true }); return; }
  if (msg.type !== 'net' || !port) return;
  // waitUntil is what stops the browser reclaiming this worker while the
  // request is in flight — without it the durability above is theatre.
  e.waitUntil(relay(msg, port));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) if ('focus' in c) return c.focus();
    return self.clients.openWindow('./');
  }));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never intercept the model APIs (or any cross-origin request).
  if (url.origin !== location.origin) return;
  e.respondWith(fromShell(e.request));
});
