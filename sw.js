/* Field Book service worker: keeps the app itself on the phone so it opens with no signal.
   Job data and photos are saved by the app (IndexedDB), not here. */
const V = 'fb-shell-v2';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'favicon-32.png'];
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';
const RUNTIME = 'fb-runtime-v1';

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(V);
    await c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })));
    try { await c.add(LIB); } catch (_) { /* picked up later by the runtime cache */ }
  })());
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('fb-') && k !== V && k !== RUNTIME) await caches.delete(k);
    await self.clients.claim();
  })());
});

const wait = ms => new Promise(r => setTimeout(r, ms));

/* App files: try the network first (so updates arrive), fall back to the saved copy after 4 s or when offline. */
async function networkFirst(req, key) {
  const c = await caches.open(V);
  const net = fetch(key === 'index.html' ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' }) : new Request(req, { cache: 'no-cache' }))
    .then(res => { if (res && res.ok) c.put(key, res.clone()); return res; });
  const saved = c.match(key, { ignoreSearch: true }).then(m => m || (key === 'index.html' ? c.match('./') : undefined));
  try {
    const first = await Promise.race([net, wait(4000).then(() => 'slow')]);
    if (first !== 'slow') return first;
    return (await saved) || (await net);
  } catch (_) {
    const m = await saved;
    if (m) return m;
    return new Response('<h1>No signal</h1><p>Open Field Book once with signal so it can save itself on this phone.</p>', { status: 503, headers: { 'Content-Type': 'text/html' } });
  }
}

/* Library, fonts, video thumbnails: use the saved copy, fetch only if missing. */
async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) (await caches.open(RUNTIME)).put(req, res.clone());
    return res;
  } catch (_) {
    return Response.error();
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.hostname.endsWith('supabase.co')) return;           // live data: handled by the app
  if (req.mode === 'navigate' && u.origin === location.origin) { e.respondWith(networkFirst(req, 'index.html')); return; }
  if (u.origin === location.origin) {
    const scope = new URL(self.registration.scope).pathname;
    const key = (u.pathname.startsWith(scope) ? u.pathname.slice(scope.length) : u.pathname) || './';
    e.respondWith(networkFirst(req, key === 'index.html' || key === './' ? 'index.html' : key));
    return;
  }
  if (/(^|\.)cdn\.jsdelivr\.net$|^fonts\.googleapis\.com$|^fonts\.gstatic\.com$|^i\.ytimg\.com$/.test(u.hostname)) { e.respondWith(cacheFirst(req)); }
});
