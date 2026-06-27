const CACHE = 'dash-v28-cyberpunk-v2';
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/'])));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return;
  e.respondWith(fetch(e.request).then(r => {
    const rc = r.clone();
    caches.open(CACHE).then(c => c.put(e.request, rc));
    return r;
  }).catch(() => caches.match(e.request)));
});
