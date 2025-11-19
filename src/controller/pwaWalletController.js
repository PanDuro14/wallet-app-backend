// controllers/pwaWalletController.js
// HTTP requests - Validación entrada/salida - Usa service/db layers
const pwaWalletProcess = require('../processes/pwaWalletProcess');
const pwaWalletDb = require('../db/pwaWalletDb');
const pwaWalletService = require('../services/pwaWalletService');
const notificationService = require('../services/notificationService');

/**
 * GET /api/pwa-wallet/:serial
 * Obtiene datos completos de tarjeta para PWA
 */
const getCard = async (req, res) => {
  try {
    const { serial } = req.params;
    
    if (!serial || typeof serial !== 'string') {
      return res.status(400).json({
        error: 'Serial number inválido',
        code: 'INVALID_SERIAL'
      });
    }
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(serial)) {
      return res.status(400).json({
        error: 'Formato de serial inválido',
        code: 'INVALID_SERIAL_FORMAT'
      });
    }
    
    const cardData = await pwaWalletProcess.getCardDetails(serial);
    
    console.log(`[getCard] Serial: ${serial}, Strips: ${cardData.strips?.collected}/${cardData.strips?.required}`);
    
    res.json(cardData);
    
  } catch (error) {
    console.error('[PWA Wallet Controller] Error en getCard:', error);
    
    const statusCode = error.statusCode || 500;
    
    res.status(statusCode).json({
      error: error.message,
      code: error.code || 'INTERNAL_ERROR',
      ...(process.env.NODE_ENV === 'development' && {
        stack: error.stack
      })
    });
  }
};

/**
 * POST /api/pwa-wallet/add-stamp
 * Agrega strip desde admin panel
 */
const addStampAdmin = async (req, res) => {
  try {
    const { serial, stripNumber } = req.body;

    if (!serial) {
      return res.status(400).json({
        ok: false,
        error: 'Serial es requerido'
      });
    }

    console.log(`[Add Stamp Admin] Serial: ${serial}, Strip: ${stripNumber}`);

    const card = await pwaWalletDb.getUserBySerial(serial);

    if (!card) {
      return res.status(404).json({
        ok: false,
        error: 'Tarjeta no encontrada'
      });
    }

    if (card.card_type !== 'strips') {
      return res.status(400).json({
        ok: false,
        error: 'Esta tarjeta no es de tipo colección'
      });
    }

    const currentStrips = card.strips_collected || 0;
    const requiredStrips = card.strips_required || 10;

    if (currentStrips >= requiredStrips) {
      return res.status(400).json({
        ok: false,
        error: 'collection_complete',
        message: 'La colección ya está completa',
        strips_collected: currentStrips,
        strips_required: requiredStrips
      });
    }

    const newStripsCollected = currentStrips + 1;
    const isComplete = newStripsCollected >= requiredStrips;

    // Actualizar en BD
    const updated = await pwaWalletDb.updateUserStrips(
      card.id,
      newStripsCollected,
      isComplete
    );

    console.log(`✅ [Add Stamp Admin] Strip agregado: ${newStripsCollected}/${requiredStrips}`);

    // Enviar notificación
    try {
      if (isComplete) {
        await notificationService.sendCompletionNotification(
          serial,
          card.id,
          'strips',
          card.lang || 'es'
        );
        console.log(`✅ [addStampAdmin] Notificación COMPLETACIÓN enviada`);
      } else {
        await notificationService.sendStripsUpdateNotification(
          serial,
          card.id,
          newStripsCollected,
          requiredStrips,
          card.lang || 'es'
        );
        console.log(`✅ [addStampAdmin] Notificación PROGRESO: ${newStripsCollected}/${requiredStrips}`);
      }
    } catch (notifError) {
      console.error(`❌ [addStampAdmin] Error notificación:`, notifError.message);
    }

    return res.json({
      ok: true,
      strips_collected: updated.strips_collected,
      strips_required: updated.strips_required,
      reward_title: updated.reward_title,
      isComplete: updated.reward_unlocked
    });

  } catch (error) {
    console.error('[Add Stamp Admin] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Error interno del servidor',
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * POST /api/pwa-wallet/update-points
 * Actualiza puntos desde admin panel
 */
const updatePoints = async (req, res) => {
  try {
    const { serial, delta } = req.body;

    if (!serial) {
      return res.status(400).json({
        ok: false,
        error: 'Serial es requerido'
      });
    }

    if (!Number.isFinite(delta)) {
      return res.status(400).json({
        ok: false,
        error: 'Delta debe ser un número válido'
      });
    }

    console.log(`[Update Points Admin] Serial: ${serial}, Delta: ${delta}`);

    const cardData = await pwaWalletDb.getUserBySerial(serial);
    
    if (!cardData) {
      return res.status(404).json({ 
        ok: false,
        error: 'Tarjeta no encontrada' 
      });
    }

    if (cardData.card_type !== 'points') {
      return res.status(400).json({ 
        ok: false,
        error: 'Tipo de tarjeta incorrecto',
        message: 'Esta tarjeta no usa sistema de puntos'
      });
    }

    const currentPoints = cardData.points || 0;
    const newPoints = Math.max(0, currentPoints + delta);

    const updated = await pwaWalletDb.updateUserPoints(cardData.id, newPoints);

    if (!updated) {
      return res.status(400).json({
        ok: false,
        error: 'Error actualizando puntos'
      });
    }

    try {
      await notificationService.sendPointsUpdateNotification(
        serial, cardData.id, newPoints, cardData.lang || 'es'
      );
      console.log(`✅ [updatePoints] Notificación enviada`);
    } catch (notifError) {
      console.error('❌ [updatePoints] Error notificación:', notifError.message);
    }

    return res.json({
      ok: true,
      points: newPoints,
      previous_points: currentPoints,
      message: delta > 0 
        ? `+${delta} punto${delta !== 1 ? 's' : ''} agregado${delta !== 1 ? 's' : ''}`
        : `${delta} punto${Math.abs(delta) !== 1 ? 's' : ''} restado${Math.abs(delta) !== 1 ? 's' : ''}`
    });

  } catch (error) {
    console.error('[Update Points Admin] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Error interno del servidor',
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * POST /api/pwa-wallet/reset-strips
 * Reinicia colección desde admin panel
 */
const resetStrips = async (req, res) => {
  try {
    const { serial, redeemed = false } = req.body;

    if (!serial) {
      return res.status(400).json({
        ok: false,
        error: 'Serial es requerido'
      });
    }

    console.log(`[Reset Strips Admin] Serial: ${serial}, Redeemed: ${redeemed}`);

    const cardData = await pwaWalletDb.getUserBySerial(serial);
    
    if (!cardData) {
      return res.status(404).json({ 
        ok: false,
        error: 'Tarjeta no encontrada' 
      });
    }

    if (cardData.card_type !== 'strips') {
      return res.status(400).json({ 
        ok: false,
        error: 'Tipo de tarjeta incorrecto',
        message: 'Esta tarjeta no usa sistema de strips'
      });
    }

    // Incrementar contador si es canje
    if (redeemed) {
      await pwaWalletService.incrementRedemptions(serial);
    }

    // Usar service layer
    const success = await pwaWalletService.resetCardStrips(serial);

    if (!success) {
      return res.status(400).json({
        ok: false,
        error: 'Error reseteando strips'
      });
    }

    console.log(`✅ [Reset Strips] Serial ${serial} reseteado`);

    return res.json({
      ok: true,
      message: redeemed 
        ? 'Premio canjeado y colección reiniciada'
        : 'Colección reiniciada',
      strips_collected: 0
    });

  } catch (error) {
    console.error('[Reset Strips Admin] Error:', error);
    return res.status(500).json({
      ok: false,
      error: 'Error interno del servidor',
      detail: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * PATCH /api/pwa-wallet/:serial/stamp
 * Agrega stamp (legacy endpoint)
 */
const addStamp = async (req, res) => {
  try {
    const { serial } = req.params;
    const { admin_key } = req.body;
    
    if (!serial || typeof serial !== 'string') {
      return res.status(400).json({
        error: 'Serial number inválido',
        code: 'INVALID_SERIAL'
      });
    }
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(serial)) {
      return res.status(400).json({
        error: 'Formato de serial inválido',
        code: 'INVALID_SERIAL_FORMAT'
      });
    }
    
    const result = await pwaWalletProcess.addStamp(serial, admin_key);
    
    res.json(result);
    
  } catch (error) {
    console.error('[PWA Wallet Controller] Error en addStamp:', error);
    
    const statusCode = error.statusCode || 500;
    
    res.status(statusCode).json({
      error: error.message,
      code: error.code || 'INTERNAL_ERROR',
      ...(process.env.NODE_ENV === 'development' && {
        stack: error.stack
      })
    });
  }
};

/**
 * POST /api/pwa-wallet/:serial/redeem
 * Canjea recompensa (legacy)
 */
const redeemReward = async (req, res) => {
  try {
    const { serial } = req.params;
    const { admin_key } = req.body;
    
    if (!serial || typeof serial !== 'string') {
      return res.status(400).json({
        error: 'Serial number inválido',
        code: 'INVALID_SERIAL'
      });
    }
    
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(serial)) {
      return res.status(400).json({
        error: 'Formato de serial inválido',
        code: 'INVALID_SERIAL_FORMAT'
      });
    }
    
    const result = await pwaWalletProcess.redeemReward(serial, admin_key);
    
    res.json(result);
    
  } catch (error) {
    console.error('[PWA Wallet Controller] Error en redeemReward:', error);
    
    const statusCode = error.statusCode || 500;
    
    res.status(statusCode).json({
      error: error.message,
      code: error.code || 'INTERNAL_ERROR',
      ...(process.env.NODE_ENV === 'development' && {
        stack: error.stack
      })
    });
  }
};

/**
 * GET /api/pwa-wallet/:serial/stats
 * Obtiene estadísticas
 */
const getCardStats = async (req, res) => {
  try {
    const { serial } = req.params;
    
    if (!serial || typeof serial !== 'string') {
      return res.status(400).json({
        error: 'Serial number inválido',
        code: 'INVALID_SERIAL'
      });
    }
    
    const stats = await pwaWalletProcess.getCardStatistics(serial);
    
    if (!stats) {
      return res.status(404).json({
        error: 'Tarjeta no encontrada',
        code: 'CARD_NOT_FOUND'
      });
    }
    
    res.json(stats);
    
  } catch (error) {
    console.error('[PWA Wallet Controller] Error en getCardStats:', error);
    
    res.status(500).json({
      error: error.message,
      code: 'INTERNAL_ERROR'
    });
  }
};

/**
 * GET /api/pwa-wallet/business/:businessId/assets
 * Verifica assets de negocio
 */
const checkBusinessAssets = async (req, res) => {
  try {
    const { businessId } = req.params;
    
    const id = parseInt(businessId, 10);
    if (isNaN(id) || id <= 0) {
      return res.status(400).json({
        error: 'Business ID inválido',
        code: 'INVALID_BUSINESS_ID'
      });
    }
    
    const assets = await pwaWalletProcess.checkBusinessAssets(id);
    
    res.json(assets);
    
  } catch (error) {
    console.error('[PWA Wallet Controller] Error en checkBusinessAssets:', error);
    
    res.status(500).json({
      error: error.message,
      code: 'INTERNAL_ERROR'
    });
  }
};

// ========================================
// MIDDLEWARES
// ========================================

/**
 * Middleware: validar UUID en params
 */
const validateUuidParam = (paramName = 'serial') => {
  return (req, res, next) => {
    const value = req.params[paramName];
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    if (!value || !uuidRegex.test(value)) {
      return res.status(400).json({
        error: `${paramName} debe ser un UUID válido`,
        code: 'INVALID_UUID'
      });
    }
    
    next();
  };
};

/**
 * Middleware: verificar PIN del negocio
 */
const verifyBusinessPin = async (req, res, next) => {
  try {
    const { serial } = req.params || req.body;
    const { pin, admin_key } = req.body;

    // Backward compatibility con admin_key
    if (admin_key) {
      return next();
    }

    if (!pin) {
      return res.status(401).json({ 
        error: 'PIN requerido',
        message: 'Debes proporcionar el PIN del negocio para esta acción'
      });
    }

    const cardData = await pwaWalletProcess.getCardBySerial(serial);
    
    if (!cardData) {
      return res.status(404).json({ error: 'Tarjeta no encontrada' });
    }

    const businessId = cardData.business_id;
    const isValid = await pwaWalletProcess.verifyBusinessPin(businessId, pin);

    if (!isValid) {
      return res.status(401).json({ 
        error: 'PIN incorrecto',
        message: 'El PIN del negocio no es válido'
      });
    }

    req.businessId = businessId;
    next();

  } catch (error) {
    console.error('[verifyBusinessPin] Error:', error);
    res.status(500).json({ 
      error: 'Error verificando PIN',
      detail: error.message 
    });
  }
};

/**
 * Middleware: manejo global de errores
 */
const errorHandler = (err, req, res, next) => {
  console.error('[PWA Wallet Controller] Error no capturado:', err);
  
  const statusCode = err.statusCode || 500;
  
  res.status(statusCode).json({
    error: err.message || 'Error interno del servidor',
    code: err.code || 'INTERNAL_ERROR',
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack
    })
  });
};

module.exports = {
  // Endpoints PWA Client
  getCard,
  addStamp,
  redeemReward,
  getCardStats,
  checkBusinessAssets,
  
  // Endpoints Admin Panel
  updatePoints,
  addStampAdmin,
  resetStrips,
  
  // Middlewares
  validateUuidParam,
  verifyBusinessPin,
  errorHandler
};