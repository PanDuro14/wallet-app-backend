// processes/pwaWalletProcess.js
// Orquestación de lógica de negocio - Combina DB + Service
const pwaWalletDb = require('../db/pwaWalletDb');
const pwaWalletService = require('../services/pwaWalletService');
const bcrypt = require('bcrypt');

/**
 * Obtiene datos completos de una tarjeta formateados para PWA
 * @param {string} serialNumber
 * @returns {Promise<Object>}
 * @throws {Error} Si la tarjeta no existe
 */
const getCardDetails = async (serialNumber) => {
  console.log('[PWA Wallet Process] Obteniendo tarjeta:', serialNumber);
  
  // 1. Obtener datos de DB
  const rawCard = await pwaWalletDb.getCardBySerial(serialNumber);
  
  if (!rawCard) {
    const error = new Error('Tarjeta no encontrada');
    error.statusCode = 404;
    error.code = 'CARD_NOT_FOUND';
    throw error;
  }
  
  console.log('[PWA Wallet Process] Tarjeta encontrada:', {
    id: rawCard.id,
    card_type: rawCard.card_type,
    business_id: rawCard.business_id
  });
  
  // 2. Formatear respuesta
  const formattedCard = pwaWalletService.formatCardResponse(rawCard);
  
  console.log('[PWA Wallet Process] Tarjeta formateada exitosamente');
  
  return formattedCard;
};

/**
 * Agrega un sello/strip a una tarjeta
 * @param {string} serialNumber
 * @param {string} adminKey - Clave de autenticación (opcional)
 * @returns {Promise<Object>}
 * @throws {Error} Si no se puede agregar el sello
 */
const addStamp = async (serialNumber, adminKey = null) => {
  console.log('[PWA Wallet Process] Agregando sello a:', serialNumber);
  
  // TODO: Validar adminKey si es necesario
  // if (adminKey !== process.env.ADMIN_KEY) {
  //   throw new Error('Clave de administrador inválida');
  // }
  
  // 1. Obtener tarjeta actual
  const card = await pwaWalletDb.getUserBySerial(serialNumber);
  
  if (!card) {
    const error = new Error('Tarjeta no encontrada');
    error.statusCode = 404;
    throw error;
  }
  
  console.log('[PWA Wallet Process] Estado actual:', {
    strips_collected: card.strips_collected,
    strips_required: card.strips_required,
    reward_unlocked: card.reward_unlocked
  });
  
  // 2. Validar que se pueda agregar sello
  try {
    pwaWalletService.validateCanAddStamp(card);
  } catch (validationError) {
    validationError.statusCode = 400;
    throw validationError;
  }
  
  // 3. Calcular nuevo estado
  const newState = pwaWalletService.calculateNewStripState(
    card.strips_collected,
    card.strips_required
  );
  
  console.log('[PWA Wallet Process] Nuevo estado calculado:', newState);
  
  // 4. Actualizar en DB
  const updatedCard = await pwaWalletDb.updateUserStrips(
    card.id,
    newState.strips_collected,
    newState.reward_unlocked
  );
  
  console.log('[PWA Wallet Process] Sello agregado:', {
    strips_collected: updatedCard.strips_collected,
    is_complete: updatedCard.reward_unlocked
  });
  
  // 5. Formatear respuesta
  return pwaWalletService.formatStampResponse(updatedCard);
};

/**
 * Canjea una recompensa completada y reinicia la colección
 * @param {string} serialNumber
 * @param {string} adminKey - Clave de autenticación (opcional)
 * @returns {Promise<Object>}
 * @throws {Error} Si no hay recompensa para canjear
 */
const redeemReward = async (serialNumber, adminKey = null) => {
  console.log('[PWA Wallet Process] Canjeando recompensa:', serialNumber);
  
  // TODO: Validar adminKey
  
  // 1. Obtener tarjeta actual
  const card = await pwaWalletDb.getUserBySerial(serialNumber);
  
  if (!card) {
    const error = new Error('Tarjeta no encontrada');
    error.statusCode = 404;
    throw error;
  }
  
  // 2. Validar que se pueda canjear
  try {
    pwaWalletService.validateCanRedeem(card);
  } catch (validationError) {
    validationError.statusCode = 400;
    throw validationError;
  }
  
  console.log('[PWA Wallet Process] Canjeando recompensa:', card.reward_title);
  
  // 3. Reiniciar strips
  const resetCard = await pwaWalletDb.resetUserStrips(card.id);
  
  if (!resetCard) {
    const error = new Error('No se pudo canjear la recompensa');
    error.statusCode = 500;
    throw error;
  }
  
  console.log('[PWA Wallet Process] Recompensa canjeada, colección reiniciada');
  
  // 4. Registrar transacción (opcional)
  try {
    await pwaWalletDb.createTransaction({
      userId: card.id,
      type: 'reward_redeemed',
      amount: 0,
      description: `Recompensa canjeada: ${resetCard.reward_title}`
    });
  } catch (txError) {
    console.warn('[PWA Wallet Process] No se pudo registrar transacción:', txError.message);
  }
  
  // 5. Formatear respuesta
  return pwaWalletService.formatRedeemResponse(resetCard);
};

/**
 * Obtiene estadísticas de una tarjeta
 * @param {string} serialNumber
 * @returns {Promise<Object|null>}
 */
const getCardStatistics = async (serialNumber) => {
  console.log('[PWA Wallet Process] Obteniendo estadísticas:', serialNumber);
  
  const stats = await pwaWalletDb.getCardStats(serialNumber);
  
  if (!stats) {
    return null;
  }
  
  // Calcular métricas adicionales
  const daysSinceMember = Math.floor(
    (Date.now() - new Date(stats.created_at).getTime()) / (1000 * 60 * 60 * 24)
  );
  
  return {
    card_type: stats.card_type,
    member_since: stats.created_at,
    days_as_member: daysSinceMember,
    ...(stats.card_type === 'strips' ? {
      strips: {
        collected: stats.strips_collected,
        required: stats.strips_required,
        percentage: Math.round((stats.strips_collected / stats.strips_required) * 100),
        is_complete: stats.reward_unlocked
      }
    } : {
      points: {
        balance: stats.points
      }
    }),
    activity: {
      total_transactions: parseInt(stats.total_transactions),
      total_spent: parseFloat(stats.total_spent)
    }
  };
};

/**
 * Verifica el estado de disponibilidad de assets de un negocio
 * @param {number} businessId
 * @returns {Promise<Object>}
 */
const checkBusinessAssets = async (businessId) => {
  console.log('[PWA Wallet Process] Verificando assets del negocio:', businessId);
  
  const [hasLogo, stripImages] = await Promise.all([
    pwaWalletDb.hasBusinessLogo(businessId),
    pwaWalletDb.hasBusinessStripImages(businessId)
  ]);
  
  const assetUrls = pwaWalletService.buildAssetUrls(
    businessId,
    hasLogo,
    stripImages.has_strip_on,
    stripImages.has_strip_off
  );
  
  return {
    business_id: businessId,
    assets_available: {
      logo: hasLogo,
      strip_on: stripImages.has_strip_on,
      strip_off: stripImages.has_strip_off
    },
    urls: assetUrls,
    all_assets_ready: hasLogo && stripImages.has_strip_on && stripImages.has_strip_off
  };
};

/**
 * Obtiene datos básicos de una tarjeta por serial
 */
const getCardBySerial = async (serial) => {
  try {
    const card = await pwaWalletDb.getUserBySerial(serial);
    return card;
  } catch (error) {
    console.error('[getCardBySerial] Error:', error);
    throw error;
  }
};

/**
 * Verifica el PIN de un negocio
 * Soporta PINs hasheados (bcrypt) y texto plano (legacy)
 */
const verifyBusinessPin = async (businessId, pin) => {
  try {
    // Obtener PIN almacenado del negocio
    const business = await pwaWalletService.getBusinessPin(businessId);
    
    if (!business || !business.admin_pin) {
      console.warn(`[verifyBusinessPin] No PIN found for business ${businessId}`);
      return false;
    }

    const storedPin = business.admin_pin;

    // Si el PIN está hasheado con bcrypt ($2a$, $2b$, $2y$)
    if (storedPin.startsWith('$2')) {
      const isMatch = await bcrypt.compare(pin, storedPin);
      return isMatch;
    }

    // Si el PIN está en texto plano (legacy, no recomendado)
    return pin === storedPin;

  } catch (error) {
    console.error('[verifyBusinessPin] Error:', error);
    return false;
  }
};

/**
 * Actualiza puntos de una tarjeta
 * @param {string} serial - Serial de la tarjeta
 * @param {number} delta - Cantidad a sumar/restar
 * @returns {Object} { success, points }
 */
const updateCardPoints = async (serial, delta) => {
  try {
    // Validar que delta sea número
    if (!Number.isFinite(delta)) {
      return { 
        success: false, 
        error: 'Delta debe ser un número válido' 
      };
    }

    // Obtener datos actuales con getUserBySerial
    const card = await pwaWalletDb.getUserBySerial(serial);
    
    if (!card) {
      return { success: false, error: 'Tarjeta no encontrada' };
    }

    const currentPoints = card.points || 0;
    const newPoints = Math.max(0, currentPoints + delta); // No permitir negativos

    // Actualizar en BD usando updateUserPoints con id
    const updated = await pwaWalletDb.updateUserPoints(card.id, newPoints);

    if (!updated) {
      return { success: false, error: 'Error actualizando puntos' };
    }

    return {
      success: true,
      points: newPoints,
      previous_points: currentPoints
    };

  } catch (error) {
    console.error('[updateCardPoints] Error:', error);
    return { 
      success: false, 
      error: 'Error en la operación',
      detail: error.message 
    };
  }
};

/**
 * Reinicia la colección de strips de una tarjeta
 * @param {string} serial - Serial de la tarjeta
 * @param {boolean} redeemed - Si es un canje (true) o reset simple (false)
 * @returns {Object} { success }
 */
const resetCardStrips = async (serial, redeemed = false) => {
  try {
    // Obtener datos actuales
    const card = await pwaWalletDb.getUserBySerial(serial);
    
    if (!card) {
      return { success: false, error: 'Tarjeta no encontrada' };
    }

    // Si es un canje, incrementar contador de canjes
    if (redeemed) {
      await pwaWalletDb.incrementRedemptions(serial);
    }

    // Usar la función correcta de DB
    // resetUserStrips requiere id y valida reward_unlocked
    // Para admin necesitamos resetear sin validación
    const reset = await pwaWalletDb.resetCardStrips(serial);

    if (!reset) {
      return { success: false, error: 'Error reseteando strips' };
    }

    return { success: true };

  } catch (error) {
    console.error('[resetCardStrips] Error:', error);
    return { 
      success: false, 
      error: 'Error en la operación',
      detail: error.message 
    };
  }
};

module.exports = {
  // Operaciones principales
  getCardDetails,
  addStamp,
  redeemReward,
  
  // Utilidades
  getCardStatistics,
  checkBusinessAssets, 

  getCardBySerial,
  verifyBusinessPin,
  updateCardPoints,
  resetCardStrips
};