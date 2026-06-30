// ─── Agent Team Dashboard — Service Worker ───
// Handles push notifications and notification clicks

const CACHE = 'agent-team-v1';
const ASSETS = ['/'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('push', e => {
  let data = {};
  try {
    data = e.data.json();
  } catch (err) {
    data = { title: 'Agent Team', message: e.data?.text() || 'New notification' };
  }

  const options = {
    body: data.message || 'Agent notification',
    icon: '/icon.png',
    badge: '/badge.png',
    data: { url: data.url || '/' },
    tag: data.tag || 'agent-notification',
    requireInteraction: true,
  };

  e.waitUntil(
    self.registration.showNotification(data.title || 'Agent Team', options)
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url === url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
