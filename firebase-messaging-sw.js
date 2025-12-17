// firebase-messaging-sw.js
console.log('[Firebase SW] Script cargando...');

importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.0/firebase-messaging-compat.js');

console.log('[Firebase SW] Scripts importados');

try {
  firebase.initializeApp({
    apiKey: "AIzaSyBaDXj8GMbdy3OwwshyNBBClvNjUephmpQ",
    projectId: "windoe-loyalty-wallet",
    messagingSenderId: "556983962648",
    appId: "1:556983962648:web:95da994b6d6b931558876d"
  });

  console.log('[Firebase SW] Firebase inicializado');

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    console.log('[Firebase SW]  Background message recibido:', payload);
    
    const iconUrl = payload.data?.icon || payload.notification?.icon || '/public/WindoeLogo192.png';
    const badgeUrl = payload.data?.badge || payload.notification?.badge || '/public/WindoeLogo192.png';
    
    const notificationTitle = payload.notification?.title || 'Windoe Loyalty';
    const notificationOptions = {
      body: payload.notification?.body || 'Nueva actualización',
      icon: iconUrl,
      badge: badgeUrl,
      data: payload.data || {},
      tag: 'windoe-notification',
      requireInteraction: false
    };

    console.log('[Firebase SW] Mostrando notificación:', notificationTitle);
    console.log('[Firebase SW] Icon:', iconUrl);

    return self.registration.showNotification(notificationTitle, notificationOptions);
  });

  console.log('[Firebase SW] Listener configurado');

} catch (error) {
  console.error('[Firebase SW] Error fatal:', error);
}