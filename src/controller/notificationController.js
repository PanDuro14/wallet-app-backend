// controllers/notificationController.js
const notificationService = require('../services/notificationService');
const usersProcess = require('../processes/usersProcess');
const db = require('../db/index'); // Usar DB centralizado

/**
 * GET /api/v1/notifications/vapid-public-key
 * Retorna la VAPID public key para subscripciones
 */
const getVapidPublicKey = (req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  
  if (!publicKey) {
    console.error('[getVapidPublicKey] VAPID_PUBLIC_KEY no configurada');
    return res.status(500).json({
      error: 'VAPID key no configurada en servidor'
    });
  }

  console.log('[getVapidPublicKey] VAPID key length:', publicKey.length);
  console.log('[getVapidPublicKey] VAPID key preview:', publicKey.substring(0, 30) + '...');
  console.log('[getVapidPublicKey] VAPID key format valid:', /^[A-Za-z0-9_-]+$/.test(publicKey));

  res.json({
    publicKey: publicKey
  });
};

/**
 * POST /api/v1/notifications/subscribe
 * Guarda una subscripción push en la BD
 */
const subscribe = async (req, res) => {
  try {
    const { userId, subscription } = req.body;

    console.log('[subscribe] Request recibido:', {
      userId,
      hasSubscription: !!subscription,
      endpoint: subscription?.endpoint?.substring(0, 50)
    });

    // Validaciones
    if (!userId) {
      console.error('[subscribe] userId faltante');
      return res.status(400).json({
        error: 'userId es requerido'
      });
    }

    if (!subscription || !subscription.endpoint) {
      console.error('[subscribe] subscription inválida');
      return res.status(400).json({
        error: 'subscription inválida'
      });
    }

    console.log('[subscribe] Validaciones OK');
    console.log('[subscribe] Nueva subscripción:', {
      userId,
      endpoint: subscription.endpoint.substring(0, 50) + '...'
    });

    // Convertir subscription a JSON string
    const subscriptionJson = JSON.stringify(subscription);

    // Verificar si ya existe
    console.log('[subscribe] Verificando si existe...');
    const existing = await db.query(
      'SELECT id FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );

    if (existing.rows.length > 0) {
      console.log('[subscribe] Subscripción existe, actualizando...');
      
      await db.query(
        `UPDATE push_subscriptions 
         SET subscription = $1, updated_at = NOW()
         WHERE user_id = $2`,
        [subscriptionJson, userId]
      );

      console.log('[subscribe] Subscripción actualizada:', existing.rows[0].id);

      return res.json({
        success: true,
        message: 'Subscripción actualizada',
        subscriptionId: existing.rows[0].id
      });
    }

    // Insertar nueva subscripción
    console.log('[subscribe] Insertando nueva subscripción...');
    const result = await db.query(
      `INSERT INTO push_subscriptions (user_id, subscription, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       RETURNING id`,
      [userId, subscriptionJson]
    );

    console.log('[subscribe] Subscripción guardada:', result.rows[0].id);

    res.json({
      success: true,
      message: 'Subscripción guardada exitosamente',
      subscriptionId: result.rows[0].id
    });

  } catch (error) {
    console.error('[subscribe] Error guardando subscripción:', error);
    console.error('[subscribe] Stack:', error.stack);
    
    res.status(500).json({
      error: 'Error guardando subscripción',
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * DELETE /api/v1/notifications/unsubscribe
 * Elimina una subscripción push
 */
const unsubscribe = async (req, res) => {
  try {
    const { userId } = req.body;

    if (!userId) {
      return res.status(400).json({
        error: 'userId es requerido'
      });
    }

    console.log('[unsubscribe] Eliminando subscripciones de userId:', userId);

    const result = await db.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 RETURNING id',
      [userId]
    );

    console.log('[unsubscribe] Eliminadas:', result.rows.length);

    res.json({
      success: true,
      message: 'Subscripciones eliminadas',
      count: result.rows.length
    });

  } catch (error) {
    console.error('[unsubscribe] Error eliminando subscripciones:', error);
    
    res.status(500).json({
      error: 'Error eliminando subscripciones',
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * GET /api/v1/notifications/verify/:userId
 * Verifica si existe subscripción para un usuario
 */
async function verifySubscription(req, res) {
  try {
    const userId = parseInt(req.params.userId);

    if (!userId || isNaN(userId)) {
      return res.status(400).json({ error: 'userId inválido' });
    }

    const result = await db.query(
      'SELECT id, created_at, updated_at FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length > 0) {
      console.log(`[verifySubscription] Usuario ${userId} tiene ${result.rows.length} subscription(s)`);
      return res.json({
        exists: true,
        count: result.rows.length,
        subscriptions: result.rows
      });
    } else {
      console.log(`[verifySubscription] Usuario ${userId} no tiene subscripciones`);
      return res.json({
        exists: false,
        count: 0
      });
    }

  } catch (error) {
    console.error('[verifySubscription] Error:', error);
    return res.status(500).json({
      error: 'Error verificando subscripción',
      details: error.message
    });
  }
}

/**
 * POST /api/v1/notifications/send
 * Envía notificación manual
 */
async function sendManualNotification(req, res) {
  try {
    const { serial, userId, type, data, lang } = req.body;

    if (!serial && !userId) {
      return res.status(400).json({
        error: 'Se requiere serial (Apple) o userId (PWA)'
      });
    }

    if (!type) {
      return res.status(400).json({
        error: 'Se requiere type de notificación'
      });
    }

    const result = await notificationService.sendNotification({
      serial,
      userId,
      type,
      data: data || {},
      lang: lang || 'es'
    });

    return res.json({
      success: true,
      message: 'Notificación enviada',
      results: result
    });

  } catch (error) {
    console.error('[sendManualNotification] Error:', error);
    return res.status(500).json({
      error: 'Error enviando notificación',
      details: error.message
    });
  }
}

/**
 * POST /api/v1/notifications/reminder/:userId
 * Envía recordatorio de uso
 */
async function sendReminder(req, res) {
  try {
    const userId = parseInt(req.params.userId);
    
    const user = await usersProcess.getOneUser(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const result = await notificationService.sendReminderNotification(
      user.serial_number,
      userId,
      req.body.lang || 'es'
    );

    return res.json({
      success: true,
      message: 'Recordatorio enviado',
      results: result
    });

  } catch (error) {
    console.error('[sendReminder] Error:', error);
    return res.status(500).json({
      error: 'Error enviando recordatorio',
      details: error.message
    });
  }
}

/**
 * POST /api/v1/notifications/update/:userId
 * Envía notificación de actualización de puntos o strips
 */
async function sendUpdateNotification(req, res) {
  try {
    const userId = parseInt(req.params.userId);
    const { lang = 'es' } = req.body;

    const user = await usersProcess.getOneUser(userId);

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const result = await notificationService.sendUpdateNotification(
      user.serial_number,
      userId,
      lang
    );

    return res.json({
      success: true,
      message: 'Notificación de actualización enviada',
      results: result
    });

  } catch (error) {
    console.error('[sendUpdateNotification] Error:', error);
    return res.status(500).json({
      error: 'Error enviando notificación de actualización',
      details: error.message
    });
  }
}

/**
 * POST /api/v1/notifications/completion/:userId
 * Envía notificación por completación de objetivo
 */
async function sendCompletionNotification(req, res) {
  try {
    const userId = parseInt(req.params.userId);
    const { lang = 'es' } = req.body;

    const user = await usersProcess.getOneUser(userId);

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const result = await notificationService.sendCompletionNotification(
      user.serial_number,
      userId,
      lang
    );

    return res.json({
      success: true,
      message: 'Notificación de completación enviada',
      results: result
    });

  } catch (error) {
    console.error('[sendCompletionNotification] Error:', error);
    return res.status(500).json({
      error: 'Error enviando notificación de completación',
      details: error.message
    });
  }
}

/**
 * POST /api/v1/notifications/welcome/:userId
 * Envía notificación de bienvenida al generar una tarjeta
 */
async function sendWelcome(req, res) {
  try {
    const userId = parseInt(req.params.userId);
    const { lang = 'es' } = req.body;

    const user = await usersProcess.getOneUser(userId);

    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const result = await notificationService.sendWelcomeNotification(
      user.serial_number,
      userId,
      lang
    );

    return res.json({
      success: true,
      message: 'Notificación de bienvenida enviada',
      results: result
    });

  } catch (error) {
    console.error('[sendWelcome] Error:', error);
    return res.status(500).json({
      error: 'Error enviando notificación de bienvenida',
      details: error.message
    });
  }
}

/**
 * POST /api/v1/notifications/batch/reminders
 * Envía recordatorios masivos
 */
async function sendBatchReminders(req, res) {
  try {
    const { inactiveDays = 7, businessId = null, lang = 'es' } = req.body;

    const result = await notificationService.sendBatchReminders({
      inactiveDays,
      businessId,
      lang
    });

    return res.json({
      success: true,
      message: 'Recordatorios masivos enviados',
      results: result
    });

  } catch (error) {
    console.error('[sendBatchReminders] Error:', error);
    return res.status(500).json({
      error: 'Error enviando recordatorios masivos',
      details: error.message
    });
  }
}

/**
 * GET /api/v1/notifications/test-vapid
 * Valida configuración VAPID
 */
const testVapid = (req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const email = process.env.VAPID_EMAIL;

  const status = {
    publicKey: {
      exists: !!publicKey,
      length: publicKey?.length || 0,
      valid: publicKey && publicKey.length >= 80 && /^[A-Za-z0-9_-]+$/.test(publicKey),
      preview: publicKey ? publicKey.substring(0, 30) + '...' : 'N/A'
    },
    privateKey: {
      exists: !!privateKey,
      length: privateKey?.length || 0,
      valid: privateKey && privateKey.length >= 40 && /^[A-Za-z0-9_-]+$/.test(privateKey),
      preview: privateKey ? privateKey.substring(0, 20) + '...' : 'N/A'
    },
    email: {
      exists: !!email,
      value: email || 'N/A',
      valid: email ? email.startsWith('mailto:') : false
    }
  };

  const allValid = status.publicKey.valid && status.privateKey.valid;

  return res.json({
    configured: allValid,
    details: status,
    recommendation: allValid 
      ? ' VAPID configuradas correctamente' 
      : ' Regenera VAPID keys'
  });
};

module.exports = {
  getVapidPublicKey,
  subscribe,
  unsubscribe,
  verifySubscription,
  sendManualNotification,
  sendReminder,
  sendUpdateNotification,
  sendCompletionNotification,
  sendWelcome,
  sendBatchReminders, 
  testVapid 
};