// routes/notificationRoutes.js
const express = require('express');
const router = express.Router();
const notificationController = require('../../controller/notificationController');

/**
 * POST /api/v1/notifications/send
 * Envía notificación manual (flexible)
 * Body: { serial?, userId?, type, data?, lang? }
 */
router.post('/send', notificationController.sendManualNotification);

/**
 * POST /api/v1/notifications/reminder/:userId
 * Envía recordatorio de uso a un usuario específico
 * Body: { lang? }
 */
router.post('/reminder/:userId', notificationController.sendReminder);

/**
 * POST /api/v1/notifications/update/:userId
 * Notifica actualización de puntos/strips
 * Body: { lang? }
 */
router.post('/update/:userId', notificationController.sendUpdateNotification);

/**
 * POST /api/v1/notifications/completion/:userId
 * Notifica que completó objetivo
 * Body: { lang? }
 */
router.post('/completion/:userId', notificationController.sendCompletionNotification);

/**
 * POST /api/v1/notifications/welcome/:userId
 * Envía bienvenida al crear tarjeta
 * Body: { lang? }
 */
router.post('/welcome/:userId', notificationController.sendWelcome);

/**
 * POST /api/v1/notifications/batch/reminders
 * Envía recordatorios masivos a usuarios inactivos
 * Body: { inactiveDays?, businessId?, lang? }
 */
router.post('/batch/reminders', notificationController.sendBatchReminders);

/**
 * GET /api/v1/notifications/vapid-public-key
 * Obtiene la VAPID public key
 */
router.get('/vapid-public-key', notificationController.getVapidPublicKey);

/**
 * POST /api/v1/notifications/subscribe
 * Guarda una subscripción push
 */
router.post('/subscribe', notificationController.subscribe);

/**
 * DELETE /api/v1/notifications/unsubscribe
 * Elimina subscripciones de un usuario
 */
router.delete('/unsubscribe', notificationController.unsubscribe);
/**
 * GET /api/v1/notifications/test-vapid
 * Valida configuración de VAPID keys
 */
router.get('/test-vapid', notificationController.testVapid);
module.exports = router;