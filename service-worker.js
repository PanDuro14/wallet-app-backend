// ========================================
// service-worker.js 
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

// ===== PUSH NOTIFICATIONS - CORREGIDO =====
self.addEventListener('push', (event) => {
  console.log('[SW] 📨 Push event received');
  
  // Datos por defecto
  let notificationData = {
    title: 'Windoe Loyalty',
    body: 'Tienes una nueva actualización',
    icon: '/public/WindoeLogo192.png',
    badge: '/public/WindoeLogo192.png',
    vibrate: [200, 100, 200],
    data: {},
    actions: [],
    requireInteraction: false,
    tag: 'windoe-notification'
  };

  // Intentar parsear el payload
  if (event.data) {
    try {
      const payload = event.data.json();
      console.log('[SW] 📦 Payload recibido:', payload);

      // El payload puede venir en diferentes estructuras
      // Opción 1: { notification: {...} }
      if (payload.notification) {
        console.log('[SW] ✅ Estructura: payload.notification');
        notificationData = {
          title: payload.notification.title || notificationData.title,
          body: payload.notification.body || notificationData.body,
          icon: payload.notification.icon || notificationData.icon,
          badge: payload.notification.badge || notificationData.badge,
          vibrate: payload.notification.vibrate || notificationData.vibrate,
          data: payload.notification.data || {},
          actions: payload.notification.actions || [],
          requireInteraction: payload.notification.requireInteraction || false,
          tag: payload.notification.tag || notificationData.tag
        };
      }
      // Opción 2: { title, body, ... } directamente
      else if (payload.title || payload.body) {
        console.log('[SW] ✅ Estructura: payload directo');
        notificationData = {
          title: payload.title || notificationData.title,
          body: payload.body || notificationData.body,
          icon: payload.icon || notificationData.icon,
          badge: payload.badge || notificationData.badge,
          vibrate: payload.vibrate || notificationData.vibrate,
          data: payload.data || {},
          actions: payload.actions || [],
          requireInteraction: payload.requireInteraction || false,
          tag: payload.tag || notificationData.tag
        };
      }
      // Opción 3: payload desconocido
      else {
        console.warn('[SW] ⚠️ Estructura de payload desconocida:', payload);
      }

      console.log('[SW] 📋 Notificación a mostrar:', notificationData);

    } catch (err) {
      console.error('[SW] ❌ Error parseando payload:', err);
      console.log('[SW] 📄 Payload raw:', event.data.text());
    }
  } else {
    console.log('[SW] ℹ️ Push sin datos, usando defaults');
  }

  // Mostrar notificación y notificar a clientes
  event.waitUntil(
    Promise.all([
      // Mostrar la notificación
      self.registration.showNotification(notificationData.title, {
        body: notificationData.body,
        icon: notificationData.icon,
        badge: notificationData.badge,
        vibrate: notificationData.vibrate,
        data: notificationData.data,
        actions: notificationData.actions,
        requireInteraction: notificationData.requireInteraction,
        tag: notificationData.tag
      }).then(() => {
        console.log('[SW] ✅ Notificación mostrada:', notificationData.title);
      }),
      
      // Notificar a la PWA para que actualice
      notifyClientsToRefresh()
    ])
  );
});

// ===== NOTIFICATION CLICK =====
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] 🖱️ Notification clicked');
  console.log('[SW] Action:', event.action);
  console.log('[SW] Data:', event.notification.data);

  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        console.log('[SW] Clientes abiertos:', clientList.length);
        
        // Si hay un cliente con la PWA abierta, enfocarlo
        for (const client of clientList) {
          if (client.url.includes('/wallet/') && 'focus' in client) {
            console.log('[SW] ✅ Enfocando cliente existente:', client.url);
            return client.focus();
          }
        }
        
        // Si no hay cliente abierto, abrir uno nuevo
        if (clients.openWindow) {
          const url = event.notification.data?.url || '/';
          console.log('[SW] 🆕 Abriendo nueva ventana:', url);
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
  
  console.log('[SW] 📢 Notificando a', clientList.length, 'clientes');
  
  for (const client of clientList) {
    if (client.url.includes('/wallet/')) {
      console.log('[SW] 📤 Enviando mensaje UPDATE_AVAILABLE a:', client.url);
      client.postMessage({ 
        type: 'UPDATE_AVAILABLE',
        message: 'Nueva actualización disponible',
        timestamp: Date.now()
      });
    }
  }
}

// ===== BACKGROUND SYNC =====
self.addEventListener('sync', (event) => {
  console.log('[SW] 🔄 Background sync:', event.tag);
  
  if (event.tag === 'sync-wallet') {
    event.waitUntil(Promise.resolve());
  }
});

console.log('[SW] ✅ Service Worker loaded and ready');