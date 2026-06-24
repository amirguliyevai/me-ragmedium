// ─── PWA Service Worker (Enhanced) ─────────────────────────────
// Offline action queue, background sync, enhanced caching

const CACHE = "dash-v8";
const ASSETS = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

// ─── IndexedDB: Offline Action Queue ───────────────────────────
const DB_NAME = 'galaxy-offline';
const STORE_NAME = 'actionQueue';

function openQueueDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('status')) {
        db.createObjectStore('status', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Queue action when offline
async function queueOfflineAction(action) {
  const db = await openQueueDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  await tx.objectStore(STORE_NAME).add({
    action,
    timestamp: Date.now(),
    retries: 0
  });
  db.close();
  // Try background sync
  if ('serviceWorker' in self.registration && 'SyncManager' in self) {
    await self.registration.sync.register('sync-offline');
  }
}

// Sync offline actions when back online
async function syncOfflineActions() {
  const db = await openQueueDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const actions = await tx.objectStore(STORE_NAME).getAll();
  db.close();

  for (const item of actions) {
    try {
      await fetch(item.action.url, {
        method: item.action.method || 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item.action.payload)
      });
      // Remove from queue
      const db2 = await openQueueDB();
      const delTx = db2.transaction(STORE_NAME, 'readwrite');
      await delTx.objectStore(STORE_NAME).delete(item.id);
      await delTx.commit;
      db2.close();
    } catch(e) {
      break;  // Stop syncing, will retry next time
    }
  }

  // Notify dashboard
  const clients = await self.clients.matchAll();
  clients.forEach(client => {
    client.postMessage({ type: 'sync-complete', count: actions.length });
  });
}

// ─── Install / Activate ───────────────────────────────────────
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
      caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    ])
  );
});

// ─── Network status tracking ──────────────────────────────────
let isOnline = true;

// ─── Fetch Strategy ───────────────────────────────────────────
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') {
    // Handle non-GET API calls (POST/PATCH/DELETE) for offline queue
    if (event.request.url.includes('/api/') && !isOnline) {
      event.respondWith(queueOfflineAction({
        url: event.request.url,
        method: event.request.method,
        payload: null
      }).then(() => new Response('[]', { headers: { 'Content-Type': 'application/json' } })));
    }
    return;
  }

  // For API calls: network-first, fallback to offline response
  if (event.request.url.includes('/api/')) {
    if (!isOnline) {
      event.respondWith(queueOfflineAction({
        url: event.request.url,
        method: event.request.method,
        payload: null
      }));
      event.respondWith(new Response('[]', { headers: { 'Content-Type': 'application/json' } }));
      return;
    }
    event.respondWith(
      fetch(event.request).then(response => {
        isOnline = true;
        return response;
      }).catch(() => {
        isOnline = false;
        self.clients.matchAll().then(clients => {
          clients.forEach(c => c.postMessage({ type: 'network-status', online: false }));
        });
        return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
      })
    );
    return;
  }

  // App shell: cache-first for static assets
  if (ASSETS.some(a => event.request.url.endsWith(a.replace('/', '')) || event.request.url === a)) {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
    return;
  }

  // Everything else: stale-while-revalidate
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetchPromise = fetch(event.request).then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(event.request, clone));
        }
        return response;
      }).catch(() => cached || new Response('Offline', { status: 503 }));
      return cached || fetchPromise;
    })
  );
});

// ─── Background Sync ──────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-offline') {
    event.waitUntil(syncOfflineActions());
  }
});

// ─── Periodic Background Sync ─────────────────────────────────
self.addEventListener('periodicsync', event => {
  if (event.tag === 'sync-offline') {
    event.waitUntil(syncOfflineActions());
  }
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

  if (action === 'open') {
    clients.openWindow(url);
    return;
  }

  if (action === 'mark_done' && data.todoId) {
    fetch('/api/todos/' + data.todoId, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ done: true })
    }).catch(() => {});
    clients.openWindow(url);
    return;
  }

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
  // Notification was dismissed
});
