// services/notificationService.js - CORREGIDO
const { notifyWallet } = require('./apnsService');
const { listPushTokensBySerial } = require('../db/appleWalletdb');
const webpush = require('web-push');

//  USAR TU CONEXIÓN DE BD
const dbConnection = require('../db/dbConection'); 
const dbLocal = require('../db/dbConectionLocal'); 

let pool; 

(async () => {
  try {
    await dbConnection.connect(); 
    console.log('Conexión con la db remota exitosa: notification service'); 
    pool = dbConnection; 
  } catch (errRemota){
    console.warn('Error con la db remota. Intentando conexión local... ', errRemota.message); 

    try {
      await dbLocal.connect(); 
      console.log('Conexión con la db local exitosa: notification service'); 
      pool = dbLocal; 
    } catch (errLocal){
      console.error('Error al conectar con la db local: ', errLocal.message); 
    }
  }
})(); 

//  Configurar VAPID
webpush.setVapidDetails(
  'mailto:tu-email@example.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

/**
 * Tipos de notificaciones disponibles
 */
const NotificationType = {
  REMINDER: 'reminder',
  UPDATE: 'update',
  COMPLETION: 'completion',
  WELCOME: 'welcome',
  REWARD_READY: 'reward_ready'
};

/**
 * Plantillas de mensajes según el tipo
 */
const NotificationTemplates = {
  es: {
    reminder: {
      title: '¡Te extrañamos! 👋',
      body: 'Hace tiempo que no usas tu tarjeta. ¡Gana más beneficios visitándonos!',
      icon: '🎁'
    },
    update_points: {
      title: '¡Puntos actualizados! ⭐',
      body: 'Ahora tienes {points} puntos. ¡Sigue acumulando!',
      icon: '⭐'
    },
    update_strips: {
      title: '¡Progreso actualizado! 🎫',
      body: 'Llevas {collected} de {required}. ¡Ya casi completas!',
      icon: '🎫'
    },
    completion_strips: {
      title: '¡Felicidades! 🎉',
      body: '¡Completaste tu colección! Tu premio te está esperando.',
      icon: '🏆'
    },
    completion_points: {
      title: '¡Objetivo alcanzado! 🎯',
      body: '¡Llegaste a {points} puntos! Puedes canjear tu recompensa.',
      icon: '🎁'
    },
    welcome: {
      title: '¡Bienvenido! 🎉',
      body: 'Tu tarjeta está lista. Empieza a acumular beneficios.',
      icon: '👋'
    },
    reward_ready: {
      title: '¡Premio disponible! 🎁',
      body: '{reward_title} está listo para ti. ¡Ven a canjearlo!',
      icon: '🎁'
    }
  },
  en: {
    reminder: {
      title: 'We miss you! 👋',
      body: "It's been a while since you used your card. Earn more benefits by visiting us!",
      icon: '🎁'
    },
    update_points: {
      title: 'Points updated! ⭐',
      body: 'You now have {points} points. Keep earning!',
      icon: '⭐'
    },
    update_strips: {
      title: 'Progress updated! 🎫',
      body: 'You have {collected} out of {required}. Almost there!',
      icon: '🎫'
    },
    completion_strips: {
      title: 'Congratulations! 🎉',
      body: 'You completed your collection! Your reward is waiting for you.',
      icon: '🏆'
    },
    completion_points: {
      title: 'Goal achieved! 🎯',
      body: 'You reached {points} points! You can redeem your reward.',
      icon: '🎁'
    },
    welcome: {
      title: 'Welcome! 🎉',
      body: 'Your card is ready. Start earning benefits.',
      icon: '👋'
    },
    reward_ready: {
      title: 'Reward available! 🎁',
      body: '{reward_title} is ready for you. Come get it!',
      icon: '🎁'
    }
  }
};

/**
 * Interpola variables en el mensaje
 */
function interpolate(template, data) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = data[key];
    console.log(`[interpolate] ${key} = ${value} (${typeof value})`);
    return value !== undefined && value !== null ? String(value) : `{${key}}`;
  });
}

/**
 * Obtiene el mensaje apropiado según tipo y datos
 */
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
 * Envía notificación a Apple Wallet
 */
async function sendAppleWalletNotification(serial) {
  try {
    const tokens = await listPushTokensBySerial(serial);
    
    if (!tokens || tokens.length === 0) {
      console.log(`[Apple Notification] No tokens para serial: ${serial}`);
      return { success: false, message: 'No tokens found' };
    }

    const results = await Promise.allSettled(
      tokens.map(t => notifyWallet(t.push_token, t.env))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`[Apple Notification] Serial ${serial}: ${successful} éxitos, ${failed} fallos`);

    return {
      success: successful > 0,
      total: tokens.length,
      successful,
      failed
    };
  } catch (error) {
    console.error('[Apple Notification] Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 *  OBTENER SUBSCRIPCIONES DE UN USUARIO (CORREGIDO)
 */
async function getWebPushSubscriptions(userId) {
  try {
    //  Verificar que pool esté disponible
    if (!pool) {
      console.warn('[getWebPushSubscriptions] Pool no disponible aún');
      return [];
    }

    const result = await pool.query(
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
 *  ENVIAR NOTIFICACIÓN PWA (WEB PUSH) - FUNCIONAL
 */
async function sendPWANotification(userId, type, data = {}, lang = 'es') {
  try {
    const message = getNotificationMessage(type, data, lang);
    
    const payload = {
      notification: {
        title: message.title,
        body: message.body,
        icon: '/public/WindoeLogo192.png',
        badge: '/public/WindoeLogo192.png',
        vibrate: [200, 100, 200],
        data: {
          type,
          userId,
          ...data
        },
        actions: [
          {
            action: 'open',
            title: 'Ver tarjeta'
          }
        ]
      }
    };

    console.log('[PWA Notification] Payload generado:', payload);

    //  OBTENER SUBSCRIPCIONES Y ENVIAR
    const subscriptions = await getWebPushSubscriptions(userId);
    
    if (subscriptions.length === 0) {
      console.log(`[PWA Notification] No hay subscripciones para userId: ${userId}`);
      return { 
        success: false, 
        message: 'No subscriptions found',
        payload 
      };
    }

    console.log(`[PWA Notification] Enviando a ${subscriptions.length} dispositivos`);

    //  ENVIAR A TODOS LOS DISPOSITIVOS
    const results = await Promise.allSettled(
      subscriptions.map(sub => 
        webpush.sendNotification(sub, JSON.stringify(payload))
      )
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`[PWA Notification] ${successful} enviadas, ${failed} fallidas`);

    //  LIMPIAR SUBSCRIPCIONES EXPIRADAS (410)
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        const error = results[i].reason;
        if (error?.statusCode === 410) {
          await removeExpiredSubscription(subscriptions[i]);
        }
      }
    }

    return { 
      success: successful > 0, 
      total: subscriptions.length,
      successful,
      failed,
      payload 
    };

  } catch (error) {
    console.error('[PWA Notification] Error:', error);
    return { success: false, error: error.message };
  }
}

/**
 *  ELIMINAR SUBSCRIPCIÓN EXPIRADA (CORREGIDO)
 */
async function removeExpiredSubscription(subscription) {
  try {
    //  Verificar que pool esté disponible
    if (!pool) {
      console.warn('[removeExpiredSubscription] Pool no disponible');
      return;
    }

    await pool.query(
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

  // Apple Wallet
  if (serial) {
    results.apple = await sendAppleWalletNotification(serial);
  }

  // PWA
  if (userId) {
    results.pwa = await sendPWANotification(userId, type, data, lang);
  }

  return results;
}

/**
 * Helpers específicos
 */

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
  console.log('[sendStripsUpdateNotification] PARAMS:', {
    serial,
    userId,
    collected,
    required,
    lang
  });

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

async function registerToken(serial, userId,) {
  
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