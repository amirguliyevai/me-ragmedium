// ─── PWA Service Worker ───────────────────────────────────────
// Full push notification support + network-first caching

const CACHE = "dash-v5";
const ASSETS = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {})
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Clean old caches
      caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    ])
  );
});

// Network-first with cache fallback for navigation
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  
  // For API calls, always network
  if (event.request.url.includes('/api/')) {
    event.respondWith(fetch(event.request).catch(() => new Response(JSON.stringify({error:'offline'}), {
      status: 503, headers: {'Content-Type': 'application/json'}
    })));
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(res => {
        // Cache successful responses
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, clone));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then(cached => cached || fetch(event.request)))
  );
});

// ─── Push Notifications ──────────────────────────────────────
self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch(e) {
    try { data = { title: 'Dashboard', body: event.data.text() }; }
    catch(e2) { data = { title: 'Dashboard', body: 'New update' }; }
  }

  const options = {
    title: data.title || 'Amir Command',
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'dashboard-notif',
    data: data.data || {},
    vibrate: [200, 100, 200],
    requireInteraction: data.requireInteraction || false,
    actions: data.actions || []
  };

  event.waitUntil(self.registration.showNotification(options.title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const data = event.notification.data || {};
  const action = event.action;
  const url = data.url || '/';

  // Handle actions
  if (action === 'open') {
    clients.openWindow(url);
    return;
  }
  
  // Mark todo as done via API
  if (action === 'mark_done' && data.todoId) {
    fetch('/api/todos/' + data.todoId, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done: true })
    }).catch(() => {});
    // Also navigate to dashboard
    clients.openWindow(url);
    return;
  }

  // Default: focus existing window or open new
  // If agentId is present, open Slack panel via main page
  let targetUrl = url;
  if (data.agentId && url.includes('/slack')) {
    targetUrl = '/?slack=' + encodeURIComponent(data.agentId);
  }
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      if (windowClients.length > 0) {
        const client = windowClients[0];
        client.focus();
        if (targetUrl && targetUrl !== '/') client.navigate(targetUrl);
        return;
      }
      clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('notificationclose', event => {
  // Notification was dismissed — could log analytics here
});
