// services/pwaWalletService.js
// Lógica de negocio - Transformaciones y validaciones
const pwaWalletDb = require('../db/pwaWalletDb');

/**
 * Parsea design_json de forma segura
 * @param {string|Object} designJson
 * @returns {Object}
 */
const parseDesignJson = (designJson) => {
  if (!designJson) return {};
  
  if (typeof designJson === 'string') {
    try {
      return JSON.parse(designJson);
    } catch (error) {
      //console.warn('[PWA Wallet Service] Error parsing design_json:', error.message);
      return {};
    }
  }
  
  return designJson;
};

/**
 * Construye URLs de assets públicos
 * @param {number} businessId
 * @returns {Object}
 */
const buildAssetUrls = (businessId) => {
  const baseUrl = process.env.PUBLIC_BASE_URL || 
                  process.env.WALLET_BASE_URL || 
                  'https://wallet-app-backend.fly.dev';
  
  // Siempre construir las URLs (la API verificará si existen)
  return {
    logo: `${baseUrl}/api/public/assets/logo/${businessId}`,
    strip_on: `${baseUrl}/api/public/assets/strip-on/${businessId}`,
    strip_off: `${baseUrl}/api/public/assets/strip-off/${businessId}`
  };
};

/**
 * Construye URLs de la PWA
 * @param {string} serialNumber
 * @returns {Object}
 */
const buildPwaUrls = (serialNumber) => {
  const baseUrl = process.env.PUBLIC_BASE_URL || 
                  process.env.WALLET_BASE_URL || 
                  'https://wallet-app-backend.fly.dev';
  
  const pwaUrl = `${baseUrl}/wallet/${serialNumber}`;
  
  return {
    pwa: pwaUrl,
    install: `${pwaUrl}?install=1`,
    share: pwaUrl
  };
};

/**
 * Formatea datos de tarjeta para respuesta API
 * @param {Object} rawData - Datos de DB
 * @returns {Object}
 */
const formatCardResponse = (rawData) => {
  if (!rawData) return null;
  
  // Parsear design_json (aquí están los colores y configuración)
  const designJson = parseDesignJson(rawData.design_json);
  
  //console.log('[PWA Wallet Service] design_json parseado:', {
  //  hasColors: !!designJson.colors,
  //  hasStrips: !!designJson.strips,
  //  cardType: designJson.cardType,
  //  programName: designJson.programName
  //});
  
  // Extraer colores del design_json (prioridad sobre fallbacks)
  const backgroundColor = designJson.colors?.background || '#2d3436';
  const foregroundColor = designJson.colors?.foreground || '#E6E6E6';
  const labelColor = designJson.colors?.label || '#FFFFFF';
  
  // Construir URLs de assets
  const assetUrls = buildAssetUrls(rawData.business_id);
  
  // URLs de PWA
  const pwaUrls = buildPwaUrls(rawData.serial_number);
  
  // Datos base de la tarjeta
  const response = {
    card: {
      serial_number: rawData.serial_number,
      loyalty_account_id: rawData.loyalty_account_id,
      card_type: rawData.card_type || designJson.cardType || 'strips',
      member_since: rawData.created_at,
      qr_data: rawData.serial_number
    },
    
    user: {
      id: rawData.id,
      name: rawData.name,
      email: rawData.email,
      phone: rawData.phone
    },
    
    business: {
      id: rawData.business_id,
      name: rawData.business_name,
      logo_url: assetUrls.logo,
      contact: rawData.business_email
    },
    
    design: {
      background_color: backgroundColor,
      foreground_color: foregroundColor,
      label_color: labelColor,
      program_name: designJson.programName || rawData.business_name || 'Programa de Lealtad',
      terms: rawData.terms || 'Válido en sucursales participantes'
    },
    
    urls: pwaUrls
  };
  
  // Agregar datos específicos según tipo de tarjeta
  if (rawData.card_type === 'strips' || designJson.cardType === 'strips') {
    response.strips = {
      collected: rawData.strips_collected || 0,
      required: rawData.strips_required || designJson.strips?.total || 8,
      reward_title: rawData.reward_title || designJson.strips?.rewardTitle || 'Premio',
      reward_description: rawData.reward_description || designJson.strips?.rewardDescription || '',
      is_complete: rawData.reward_unlocked || false,
      strip_on_url: assetUrls.strip_on,
      strip_off_url: assetUrls.strip_off
    };
  } else {
    response.points = {
      balance: rawData.points || 0,
      label: 'Puntos Acumulados'
    };
  }
  
  return response;
};

/**
 * Valida que una tarjeta sea de tipo strips
 * @param {Object} card
 * @throws {Error}
 */
const validateStripsCard = (card) => {
  if (!card) {
    throw new Error('Tarjeta no encontrada');
  }
  
  if (card.card_type !== 'strips') {
    throw new Error('Esta tarjeta no es de tipo strips');
  }
};

/**
 * Valida que se pueda agregar un sello
 * @param {Object} card
 * @throws {Error}
 */
const validateCanAddStamp = (card) => {
  validateStripsCard(card);
  
  if (card.reward_unlocked) {
    throw new Error('Recompensa ya canjeada. El cliente debe canjear su premio antes de iniciar una nueva colección');
  }
  
  if (card.strips_collected >= card.strips_required) {
    throw new Error('Colección ya completa');
  }
};

/**
 * Valida que se pueda canjear recompensa
 * @param {Object} card
 * @throws {Error}
 */
const validateCanRedeem = (card) => {
  validateStripsCard(card);
  
  if (!card.reward_unlocked) {
    throw new Error('No hay recompensa disponible para canjear');
  }
};

/**
 * Calcula nuevo estado de strips después de agregar uno
 * @param {number} currentCollected
 * @param {number} required
 * @returns {Object}
 */
const calculateNewStripState = (currentCollected, required) => {
  const newCollected = currentCollected + 1;
  const isComplete = newCollected >= required;
  
  return {
    strips_collected: newCollected,
    reward_unlocked: isComplete,
    is_complete: isComplete
  };
};

/**
 * Formatea respuesta de agregar sello
 * @param {Object} updatedCard
 * @returns {Object}
 */
const formatStampResponse = (updatedCard) => {
  const isComplete = updatedCard.reward_unlocked;
  
  return {
    success: true,
    strips_collected: updatedCard.strips_collected,
    strips_required: updatedCard.strips_required,
    is_complete: isComplete,
    reward_title: isComplete ? updatedCard.reward_title : null,
    message: isComplete 
      ? '¡Felicidades! Colección completada ' 
      : `Sello agregado (${updatedCard.strips_collected}/${updatedCard.strips_required})`
  };
};

/**
 * Formatea respuesta de canjear recompensa
 * @param {Object} resetCard
 * @returns {Object}
 */
const formatRedeemResponse = (resetCard) => {
  return {
    success: true,
    message: 'Recompensa canjeada exitosamente',
    reward: resetCard.reward_title,
    new_collection_started: true,
    strips_collected: resetCard.strips_collected,
    strips_required: resetCard.strips_required
  };
};


const findCardBySerial = async(serial) => {
  const card = await pwaWalletDb.findCardBySerial(serial); 
  return card; 
}

const getBusinessPin  = async(businessId) => {
  const card = await pwaWalletDb.getBusinessPin(businessId); 
  return card; 
}

const updateCardPoints = async(serial, newPoints) => {
  const card = await pwaWalletDb.updateCardPoints(serial, newPoints); 
  return card; 
}

const resetCardStrips = async(serial) => {
  const card = await pwaWalletDb.resetCardStrips(serial); 
  return card; 
}

const incrementRedemptions = async(serial) => {
  const card = await pwaWalletDb.incrementRedemptions(serial); 
  return card; 
}


module.exports = {
  // Formateo de datos
  parseDesignJson,
  formatCardResponse,
  formatStampResponse,
  formatRedeemResponse,
  
  // Construcción de URLs
  buildAssetUrls,
  buildPwaUrls,
  
  // Validaciones
  validateStripsCard,
  validateCanAddStamp,
  validateCanRedeem,
  
  // Cálculos
  calculateNewStripState,

  // updates 
  findCardBySerial,
  getBusinessPin,
  updateCardPoints,
  resetCardStrips,
  incrementRedemptions
};