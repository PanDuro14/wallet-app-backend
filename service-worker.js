// ========================================
// service-worker.js - VERSIÓN CORREGIDA
// ========================================

const CACHE_NAME = 'windoe-wallet-v1';
const urlsToCache = [
  '/',
  '/public/wallet.html',
  '/public/WindoeLogo128.png', 
  '/public/WindoeLogo192.png',
  '/public/WindoeLogo512.png'
];

// ===== INSTALACIÓN =====
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching files');
        return Promise.all(
          urlsToCache.map((url) => {
            return fetch(url, { cache: 'reload' })
              .then((response) => {
                if (!response.ok) {
                  throw new Error(`Failed to cache ${url}: ${response.status}`);
                }
                return cache.put(url, response);
              })
              .catch((err) => {
                console.warn(`[SW] Could not cache ${url}:`, err.message);
              });
          })
        );
      })
      .then(() => {
        console.log('[SW] Installation complete');
        return self.skipWaiting();
      })
  );
});

// ===== ACTIVACIÓN =====
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  
  const cacheWhitelist = [CACHE_NAME];
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (!cacheWhitelist.includes(cacheName)) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] Activation complete');
        return self.clients.claim();
      })
  );
});

// ===== FETCH =====
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        return fetch(event.request)
          .then((response) => {
            if (!response || response.status !== 200 || response.type === 'opaque') {
              return response;
            }

            const responseToCache = response.clone();

            caches.open(CACHE_NAME)
              .then((cache) => {
                cache.put(event.request, responseToCache);
              });

            return response;
          });
      })
      .catch(() => {
        return caches.match('/public/wallet.html');
      })
  );
});

// ===== PUSH NOTIFICATIONS =====
self.addEventListener('push', (event) => {
  console.log('[SW] Push received:', event);

  let data = {
    title: 'Windoe Loyalty',
    body: 'Tienes una nueva actualización',
    icon: '/public/WindoeLogo192.png',
    badge: '/public/WindoeLogo192.png'
  };

  if (event.data) {
    try {
      const payload = event.data.json();
      console.log('[SW] Push payload:', payload);

      if (payload.notification) {
        data = {
          title: payload.notification.title || data.title,
          body: payload.notification.body || data.body,
          icon: payload.notification.icon || data.icon,
          badge: payload.notification.badge || data.badge,
          data: payload.notification.data || {},
          actions: payload.notification.actions || []
        };
      }
    } catch (err) {
      console.error('[SW] Error parsing push data:', err);
    }
  }

  //  MOSTRAR NOTIFICACIÓN Y ENVIAR MENSAJE A LA PWA
  event.waitUntil(
    Promise.all([
      // Mostrar notificación
      self.registration.showNotification(data.title, {
        body: data.body,
        icon: data.icon,
        badge: data.badge,
        vibrate: [200, 100, 200],
        data: data.data,
        actions: data.actions,
        requireInteraction: false,
        tag: 'windoe-notification'
      }),
      //  Notificar a la PWA para que se recargue
      notifyClientsToRefresh()
    ])
  );
});

// ===== NOTIFICATION CLICK =====
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event);

  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if (client.url.includes('/wallet/') && 'focus' in client) {
            return client.focus();
          }
        }
        
        if (clients.openWindow) {
          const url = event.notification.data?.url || '/';
          return clients.openWindow(url);
        }
      })
  );
});

// ===== MENSAJE A CLIENTES =====
async function notifyClientsToRefresh() {
  const clientList = await clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  });
  
  for (const client of clientList) {
    if (client.url.includes('/wallet/')) {
      console.log('[SW] Enviando mensaje de actualización a cliente:', client.url);
      client.postMessage({ 
        type: 'UPDATE_AVAILABLE',
        message: 'Nueva actualización disponible'
      });
    }
  }
}

// ===== BACKGROUND SYNC =====
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'sync-wallet') {
    event.waitUntil(Promise.resolve());
  }
});

console.log('[SW] Service Worker loaded');
