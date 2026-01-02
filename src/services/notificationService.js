// services/notificationService.js
const db = require('../db/index');
const { notifyWallet } = require('./apnsService');
const { listPushTokensBySerial } = require('../db/appleWalletdb');
const admin = require('firebase-admin');

// Inicializar Firebase Admin SDK
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKeyId: process.env.FIREBASE_PRIVATE_KEY_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        clientId: process.env.FIREBASE_CLIENT_ID
      })
    });
    
    console.log(' [Firebase Admin] Inicializado correctamente');
  } catch (error) {
    console.error(' [Firebase Admin] Error al inicializar:', error.message);
  }
}

/**
 * Tipos de notificaciones
 */
const NotificationType = {
  REMINDER: 'reminder',
  UPDATE: 'update',
  COMPLETION: 'completion',
  WELCOME: 'welcome',
  REWARD_READY: 'reward_ready'
};

/**
 * Plantillas de mensajes
 */
const NotificationTemplates = {
  es: {
    reminder: {
      title: '¡Te extrañamos! ',
      body: 'Hace tiempo que no usas tu tarjeta. ¡Gana más beneficios visitándonos!',
      icon: ''
    },
    update_points: {
      title: '¡Puntos actualizados! ',
      body: 'Ahora tienes {points} puntos. ¡Sigue acumulando!',
      icon: ''
    },
    update_strips: {
      title: '¡Progreso actualizado! ',
      body: 'Llevas {collected} de {required}. ¡Ya casi completas!',
      icon: ''
    },
    completion_strips: {
      title: '¡Felicidades! ',
      body: '¡Completaste tu colección! Tu premio te está esperando.',
      icon: ''
    },
    completion_points: {
      title: '¡Objetivo alcanzado! ',
      body: '¡Llegaste a {points} puntos! Puedes canjear tu recompensa.',
      icon: ''
    },
    welcome: {
      title: '¡Bienvenido! ',
      body: 'Tu tarjeta está lista. Empieza a acumular beneficios.',
      icon: ''
    },
    reward_ready: {
      title: '¡Premio disponible! ',
      body: '{reward_title} está listo para ti. ¡Ven a canjearlo!',
      icon: ''
    }
  },
  en: {
    reminder: {
      title: 'We miss you! ',
      body: "It's been a while since you used your card. Earn more benefits!",
      icon: ''
    },
    update_points: {
      title: 'Points updated! ',
      body: 'You now have {points} points. Keep earning!',
      icon: ''
    },
    update_strips: {
      title: 'Progress updated! ',
      body: 'You have {collected} out of {required}. Almost there!',
      icon: ''
    },
    completion_strips: {
      title: 'Congratulations! ',
      body: 'You completed your collection! Your reward is waiting.',
      icon: ''
    },
    completion_points: {
      title: 'Goal achieved! ',
      body: 'You reached {points} points! Redeem your reward.',
      icon: ''
    },
    welcome: {
      title: 'Welcome! ',
      body: 'Your card is ready. Start earning benefits.',
      icon: ''
    },
    reward_ready: {
      title: 'Reward available! ',
      body: '{reward_title} is ready for you. Come get it!',
      icon: ''
    }
  }
};

function interpolate(template, data) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = data[key];
    return value !== undefined && value !== null ? String(value) : `{${key}}`;
  });
}

function getNotificationMessage(type, data = {}, lang = 'es') {
  const templates = NotificationTemplates[lang] || NotificationTemplates.es;
  let template;

  switch (type) {
    case NotificationType.UPDATE:
      template = data.card_type === 'strips' ? templates.update_strips : templates.update_points;
      break;
    case NotificationType.COMPLETION:
      template = data.card_type === 'strips' ? templates.completion_strips : templates.completion_points;
      break;
    default:
      template = templates[type] || templates.reminder;
  }

  return {
    title: interpolate(template.title, data),
    body: interpolate(template.body, data),
    icon: template.icon
  };
}

/**
 *  CORREGIDO: Envía notificación a Apple Wallet con { serial } en payload
 */
async function sendAppleWalletNotification(serial) {
  try {
    const tokens = await listPushTokensBySerial(serial);
    
    if (!tokens || tokens.length === 0) {
      console.log('[sendAppleWalletNotification] No tokens para serial:', serial);
      return { success: false, message: 'No tokens found' };
    }

    console.log(`[sendAppleWalletNotification] Enviando APNs a ${tokens.length} dispositivo(s)`);

    //  CRÍTICO: Pasar { serial } como payload para que Apple Wallet actualice
    const results = await Promise.allSettled(
      tokens.map(t => notifyWallet(t.push_token, t.env, { serial }))
    );

    let successful = 0;
    let failed = 0;

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const token = tokens[i];
      
      if (r.status === 'fulfilled') {
        const { status, reason } = r.value;
        console.log('[APNs] Result:', {
          token: token.push_token.substring(0, 8) + '...',
          env: token.env,
          status,
          reason: reason || 'OK'
        });
        
        if (status === 200) {
          successful++;
        } else {
          failed++;
        }
      } else {
        failed++;
        console.error('[APNs] Error:', r.reason?.message || r.reason);
      }
    }

    console.log(`[sendAppleWalletNotification]  Resultado: ${successful}/${tokens.length} exitosos`);

    return {
      success: successful > 0,
      total: tokens.length,
      successful,
      failed
    };
  } catch (error) {
    console.error('[sendAppleWalletNotification] Error fatal:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Obtener subscripciones FCM de un usuario
 */
async function getWebPushSubscriptions(userId) {
  try {
    const result = await db.query(
      'SELECT subscription FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );
    
    return result.rows.map(row => row.subscription);
  } catch (error) {
    console.error('[getWebPushSubscriptions] Error:', error);
    return [];
  }
}

/**
 * ENVIAR NOTIFICACIÓN PWA CON FCM
 */
async function sendPWANotification(userId, type, data = {}, lang = 'es') {
  try {
    const message = getNotificationMessage(type, data, lang);
    
    const subscriptions = await getWebPushSubscriptions(userId);
    
    if (subscriptions.length === 0) {
      console.log(`[FCM]  No hay subscripciones para userId: ${userId}`);
      return { 
        success: false, 
        message: 'No subscriptions found'
      };
    }

    console.log(`[FCM]  Enviando a ${subscriptions.length} dispositivo(s)`);

    const results = await Promise.allSettled(
      subscriptions.map(sub => sendFCMNotification(sub, message, { type, userId, ...data }))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`[FCM]  Resultado: ${successful} éxito(s), ${failed} fallo(s)`);

    // Limpiar subscripciones expiradas
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        const error = results[i].reason;
        if (error?.statusCode === 410 || error?.message?.includes('NotRegistered')) {
          console.log('[FCM]  Limpiando subscripción expirada');
          await removeExpiredSubscription(subscriptions[i]);
        }
      }
    }

    return { 
      success: successful > 0, 
      total: subscriptions.length,
      successful,
      failed
    };

  } catch (error) {
    console.error('[FCM]  Error fatal:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Envía notificación usando Firebase Admin SDK
 */
async function sendFCMNotification(subscription, message, data) {
  try {
    const token = subscription.endpoint.split('/').pop();

    console.log('[FCM] Token:', token.substring(0, 20) + '...');

    let iconUrl = 'https://wallet-app-backend.fly.dev/public/WindoeLogo192.png';
    let badgeUrl = 'https://wallet-app-backend.fly.dev/public/WindoeLogo192.png';
    
    if (data.businessId) {
      iconUrl = `https://wallet-app-backend.fly.dev/api/public/assets/logo/${data.businessId}`;
      badgeUrl = `https://wallet-app-backend.fly.dev/api/public/assets/logo/${data.businessId}`;
      console.log('[FCM] Usando logo del negocio:', data.businessId);
    }

    const payload = {
      token: token,
      notification: {
        title: message.title,
        body: message.body
      },
      data: {
        type: String(data.type || ''),
        userId: String(data.userId || ''),
        businessId: String(data.businessId || ''),
        timestamp: String(Date.now()),
        icon: iconUrl,
        badge: badgeUrl
      },
      webpush: {
        headers: {
          Urgency: 'high'
        },
        notification: {
          title: message.title,
          body: message.body,
          icon: iconUrl,
          badge: badgeUrl,
          requireInteraction: false,
          tag: 'windoe-notification'
        },
        fcm_options: {
          link: '/'
        }
      }
    };

    console.log('[FCM] Enviando con Admin SDK...');
    
    const result = await admin.messaging().send(payload);
    console.log('[FCM] Enviado:', result);
    
    return { success: true, messageId: result };

  } catch (error) {
    console.error('[FCM] Error:', error.message);
    throw error;
  }
}

/**
 * Eliminar subscripción expirada
 */
async function removeExpiredSubscription(subscription) {
  try {
    await db.query(
      'DELETE FROM push_subscriptions WHERE subscription = $1',
      [subscription]
    );
    console.log('[removeExpiredSubscription] Subscription eliminada');
  } catch (error) {
    console.error('[removeExpiredSubscription] Error:', error);
  }
}

/**
 * Función principal: envía notificación a ambos canales
 */
async function sendNotification({ 
  serial,
  userId,
  type,
  data = {},
  lang = 'es'
}) {
  const results = {
    apple: null,
    pwa: null
  };

  if (serial) {
    results.apple = await sendAppleWalletNotification(serial);
  }

  if (userId) {
    results.pwa = await sendPWANotification(userId, type, data, lang);
  }

  return results;
}

// Helpers específicos
async function sendReminderNotification(serial, userId, lang = 'es') {
  return sendNotification({
    serial,
    userId,
    type: NotificationType.REMINDER,
    lang
  });
}

async function sendPointsUpdateNotification(serial, userId, points, lang = 'es') {
  return sendNotification({
    serial,
    userId,
    type: NotificationType.UPDATE,
    data: { points, card_type: 'points' },
    lang
  });
}

async function sendStripsUpdateNotification(serial, userId, collected, required, lang = 'es') {
  return sendNotification({
    serial,
    userId,
    type: NotificationType.UPDATE,
    data: { 
      collected: Number(collected), 
      required: Number(required), 
      card_type: 'strips' 
    },
    lang
  });
}

async function sendCompletionNotification(serial, userId, cardType, lang = 'es') {
  return sendNotification({
    serial,
    userId,
    type: NotificationType.COMPLETION,
    data: { card_type: cardType },
    lang
  });
}

async function sendWelcomeNotification(serial, userId, lang = 'es') {
  return sendNotification({
    serial,
    userId,
    type: NotificationType.WELCOME,
    lang
  });
}

async function sendRewardReadyNotification(serial, userId, rewardTitle, lang = 'es') {
  return sendNotification({
    serial,
    userId,
    type: NotificationType.REWARD_READY,
    data: { reward_title: rewardTitle },
    lang
  });
}

module.exports = {
  NotificationType,
  sendNotification,
  sendAppleWalletNotification,
  sendPWANotification,
  sendReminderNotification,
  sendPointsUpdateNotification,
  sendStripsUpdateNotification,
  sendCompletionNotification,
  sendWelcomeNotification,
  sendRewardReadyNotification,
  getNotificationMessage,
  getWebPushSubscriptions
};