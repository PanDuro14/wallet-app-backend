// controllers/notificationController.js
const notificationService = require('../services/notificationService');
const usersProcess = require('../processes/usersProcess');
//  USAR TU CONEXIÓN DE BD

const dbConnection = require('../db/dbConection'); 
const dbLocal = require('../db/dbConectionLocal'); 

let pool; 

(async () => {
  try {
    await dbConnection.connect(); 
    console.log('Conexión con la db remota exitosa: notification controller'); 
    pool = dbConnection; 
  } catch (errRemota){
    console.warn('Error con la db remota. Intentando conexión local... ', errRemota.message); 

    try {
      await dbLocal.connect(); 
      console.log('Conexión con la db local exitosa: notification controller'); 
      pool = dbLocal; 
    } catch (errLocal){
      console.error('Error al conectar con la db local: ', errLocal.message); 
    }
  }
})(); 

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
    
    // Obtener datos del usuario
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
 * Notifica actualización de puntos/strips
 */
async function sendUpdateNotification(req, res) {
  try {
    const userId = parseInt(req.params.userId);
    
    const user = await usersProcess.getOneUser(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    let result;

    // Determinar tipo de tarjeta
    if (user.card_type === 'strips') {
      result = await notificationService.sendStripsUpdateNotification(
        user.serial_number,
        userId,
        user.strips_collected || 0,
        user.strips_required || 10,
        req.body.lang || 'es'
      );
    } else {
      result = await notificationService.sendPointsUpdateNotification(
        user.serial_number,
        userId,
        user.points || 0,
        req.body.lang || 'es'
      );
    }

    return res.json({
      success: true,
      message: 'Notificación de actualización enviada',
      results: result
    });

  } catch (error) {
    console.error('[sendUpdateNotification] Error:', error);
    return res.status(500).json({
      error: 'Error enviando notificación',
      details: error.message
    });
  }
}

/**
 * POST /api/v1/notifications/completion/:userId
 * Notifica que completó objetivo
 */
async function sendCompletionNotification(req, res) {
  try {
    const userId = parseInt(req.params.userId);
    
    const user = await usersProcess.getOneUser(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    // Verificar si realmente completó
    const isComplete = user.card_type === 'strips' 
      ? user.strips_collected >= user.strips_required
      : user.points >= (user.points_required || 1000); // Ajustar según lógica

    if (!isComplete) {
      return res.status(400).json({
        error: 'El usuario aún no ha completado el objetivo'
      });
    }

    const result = await notificationService.sendCompletionNotification(
      user.serial_number,
      userId,
      user.card_type || 'points',
      req.body.lang || 'es'
    );

    return res.json({
      success: true,
      message: 'Notificación de completación enviada',
      results: result
    });

  } catch (error) {
    console.error('[sendCompletionNotification] Error:', error);
    return res.status(500).json({
      error: 'Error enviando notificación',
      details: error.message
    });
  }
}

/**
 * POST /api/v1/notifications/welcome/:userId
 * Envía bienvenida al crear tarjeta
 */
async function sendWelcome(req, res) {
  try {
    const userId = parseInt(req.params.userId);
    
    const user = await usersProcess.getOneUser(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const result = await notificationService.sendWelcomeNotification(
      user.serial_number,
      userId,
      req.body.lang || 'es'
    );

    return res.json({
      success: true,
      message: 'Bienvenida enviada',
      results: result
    });

  } catch (error) {
    console.error('[sendWelcome] Error:', error);
    return res.status(500).json({
      error: 'Error enviando bienvenida',
      details: error.message
    });
  }
}

/**
 * POST /api/v1/notifications/batch/reminders
 * Envía recordatorios masivos a usuarios inactivos
 */
async function sendBatchReminders(req, res) {
  try {
    const { inactiveDays = 7, businessId, lang = 'es' } = req.body;

    // TODO: Implementar query para obtener usuarios inactivos
    // const inactiveUsers = await usersProcess.getInactiveUsers(inactiveDays, businessId);

    const results = {
      total: 0,
      sent: 0,
      failed: 0,
      errors: []
    };

    // Ejemplo de cómo sería:
    /*
    for (const user of inactiveUsers) {
      results.total++;
      try {
        await notificationService.sendReminderNotification(
          user.serial_number,
          user.id,
          lang
        );
        results.sent++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          userId: user.id,
          error: error.message
        });
      }
    }
    */

    return res.json({
      success: true,
      message: 'Recordatorios masivos procesados',
      results
    });

  } catch (error) {
    console.error('[sendBatchReminders] Error:', error);
    return res.status(500).json({
      error: 'Error enviando recordatorios masivos',
      details: error.message
    });
  }
}

// controllers/notificationController.js
// Endpoints para Web Push Notifications

/**
 * GET /api/v1/notifications/vapid-public-key
 * Retorna la VAPID public key para subscripciones
 */
const getVapidPublicKey = (req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  
  if (!publicKey) {
    console.error('[notificationController] VAPID_PUBLIC_KEY no configurada');
    return res.status(500).json({
      error: 'VAPID key no configurada en servidor'
    });
  }

  console.log('[notificationController] VAPID key solicitada');
  
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

    // Validaciones
    if (!userId) {
      return res.status(400).json({
        error: 'userId es requerido'
      });
    }

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({
        error: 'subscription inválida'
      });
    }

    console.log('[notificationController] Nueva subscripción:', {
      userId,
      endpoint: subscription.endpoint.substring(0, 50) + '...'
    });

    // Importar DB
    const dbConnection = require('../db/dbConection');
    const dbLocal = require('../db/dbConectionLocal');
    
    let db;
    try {
      await dbConnection.connect();
      db = dbConnection;
    } catch (err) {
      await dbLocal.connect();
      db = dbLocal;
    }

    // Verificar si ya existe
    const existing = await db.query(
      'SELECT id FROM push_subscriptions WHERE user_id = $1 AND subscription = $2',
      [userId, subscription]
    );

    if (existing.rows.length > 0) {
      console.log('[notificationController] Subscripción ya existe, actualizando...');
      
      await db.query(
        `UPDATE push_subscriptions 
         SET updated_at = NOW()
         WHERE user_id = $1 AND subscription = $2`,
        [userId, subscription]
      );

      return res.json({
        success: true,
        message: 'Subscripción actualizada',
        subscriptionId: existing.rows[0].id
      });
    }

    // Insertar nueva subscripción
    const result = await db.query(
      `INSERT INTO push_subscriptions (user_id, subscription, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       RETURNING id`,
      [userId, subscription]
    );

    console.log('[notificationController] ✅ Subscripción guardada:', result.rows[0].id);

    res.json({
      success: true,
      message: 'Subscripción guardada exitosamente',
      subscriptionId: result.rows[0].id
    });

  } catch (error) {
    console.error('[notificationController] Error guardando subscripción:', error);
    
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

    console.log('[notificationController] Eliminando subscripciones de userId:', userId);

    const dbConnection = require('../db/dbConection');
    const dbLocal = require('../db/dbConectionLocal');
    
    let db;
    try {
      await dbConnection.connect();
      db = dbConnection;
    } catch (err) {
      await dbLocal.connect();
      db = dbLocal;
    }

    const result = await db.query(
      'DELETE FROM push_subscriptions WHERE user_id = $1 RETURNING id',
      [userId]
    );

    console.log('[notificationController] ✅ Eliminadas:', result.rows.length);

    res.json({
      success: true,
      message: 'Subscripciones eliminadas',
      count: result.rows.length
    });

  } catch (error) {
    console.error('[notificationController] Error eliminando subscripciones:', error);
    
    res.status(500).json({
      error: 'Error eliminando subscripciones',
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

module.exports = {
  sendManualNotification,
  sendReminder,
  sendUpdateNotification,
  sendCompletionNotification,
  sendWelcome,
  sendBatchReminders, 
  getVapidPublicKey,
  subscribe,
  unsubscribe
};