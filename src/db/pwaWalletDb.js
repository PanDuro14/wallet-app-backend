// db/pwaWalletDb.js
// Capa de acceso a datos - Solo consultas SQL puras
const dbConnection = require('./dbConection');
const dbLocal = require('./dbConectionLocal');

let db;
(async () => {
  try {
    await dbConnection.connect();
    console.log('Conexión con la db remota exitosa: pwa DB');
    db = dbConnection;
  } catch (errRemota) {
    console.warn('Error con la db remota. Intentando conexión local... ', errRemota.message);
    try {
      await dbLocal.connect();
      console.log('Conexión con la db local exitosa: pwa DB');
      db = dbLocal;
    } catch (errLocal) {
      console.error('Error al conectar con la db local: ', errLocal.message);
    }
  }
})();

/**
 * Obtiene datos completos de una tarjeta por serial number
 * @param {string} serialNumber - UUID del serial number
 * @returns {Promise<Object|null>} Datos de la tarjeta o null
 */
const getCardBySerial = async (serialNumber) => {
  const query = `
    SELECT 
      u.id,
      u.name,
      u.email,
      u.phone,
      u.serial_number,
      u.loyalty_account_id,
      u.points,
      u.card_type,
      u.strips_collected,
      u.strips_required,
      u.reward_title,
      u.reward_description,
      u.reward_unlocked,
      u.created_at,
      u.business_id,
      b.name as business_name,
      b.email as business_email,
      cd.id as card_detail_id,
      cd.design_json,
      cd.terms
    FROM users u
    JOIN businesses b ON u.business_id = b.id
    LEFT JOIN card_details cd ON u.card_detail_id = cd.id
    WHERE u.serial_number = $1
  `;

  const result = await db.query(query, [serialNumber]);
  return result.rows[0] || null;
};

/**
 * Obtiene solo info básica de usuario por serial
 * @param {string} serialNumber
 * @returns {Promise<Object|null>}
 */
const getUserBySerial = async (serialNumber) => {
  const query = `
    SELECT 
      id,
      business_id,
      card_type,
      strips_collected,
      strips_required,
      reward_unlocked,
      reward_title,
      points
    FROM users
    WHERE serial_number = $1
  `;

  const result = await db.query(query, [serialNumber]);
  return result.rows[0] || null;
};

/**
 * Actualiza strips de un usuario
 * @param {number} userId
 * @param {number} stripsCollected
 * @param {boolean} rewardUnlocked
 * @returns {Promise<Object>}
 */
const updateUserStrips = async (userId, stripsCollected, rewardUnlocked) => {
  const query = `
    UPDATE users 
    SET 
      strips_collected = $1,
      reward_unlocked = $2,
      updated_at = NOW()
    WHERE id = $3
    RETURNING 
      id,
      strips_collected,
      strips_required,
      reward_unlocked,
      reward_title
  `;

  const result = await db.query(query, [stripsCollected, rewardUnlocked, userId]);
  return result.rows[0];
};

/**
 * Actualiza puntos de un usuario
 * @param {number} userId
 * @param {number} points
 * @returns {Promise<Object>}
 */
const updateUserPoints = async (userId, points) => {
  const query = `
    UPDATE users 
    SET 
      points = $1,
      updated_at = NOW()
    WHERE id = $2
    RETURNING id, points
  `;

  const result = await db.query(query, [points, userId]);
  return result.rows[0];
};

/**
 * Reinicia strips después de canjear recompensa
 * @param {number} userId
 * @returns {Promise<Object>}
 */
const resetUserStrips = async (userId) => {
  const query = `
    UPDATE users 
    SET 
      strips_collected = 0,
      reward_unlocked = false,
      updated_at = NOW()
    WHERE id = $1
      AND card_type = 'strips'
      AND reward_unlocked = true
    RETURNING 
      id,
      strips_required,
      reward_title,
      strips_collected,
      reward_unlocked
  `;

  const result = await db.query(query, [userId]);
  return result.rows[0] || null;
};

/**
 * Verifica si existe un logo para un negocio
 * @param {number} businessId
 * @returns {Promise<boolean>}
 */
const hasBusinessLogo = async (businessId) => {
  const query = `
    SELECT 
      CASE WHEN logo IS NOT NULL THEN true ELSE false END as has_logo
    FROM businesses
    WHERE id = $1
  `;

  const result = await db.query(query, [businessId]);
  return result.rows[0]?.has_logo || false;
};

/**
 * Verifica si existen imágenes de strips para un negocio
 * @param {number} businessId
 * @returns {Promise<Object>}
 */
const hasBusinessStripImages = async (businessId) => {
  const query = `
    SELECT 
      CASE WHEN strip_image_on IS NOT NULL THEN true ELSE false END as has_strip_on,
      CASE WHEN strip_image_off IS NOT NULL THEN true ELSE false END as has_strip_off
    FROM businesses
    WHERE id = $1
  `;

  const result = await db.query(query, [businessId]);
  return result.rows[0] || { has_strip_on: false, has_strip_off: false };
};

/**
 * Obtiene estadísticas de una tarjeta
 * @param {string} serialNumber
 * @returns {Promise<Object|null>}
 */
const getCardStats = async (serialNumber) => {
  const query = `
    SELECT 
      u.card_type,
      u.strips_collected,
      u.strips_required,
      u.reward_unlocked,
      u.points,
      u.created_at,
      COUNT(DISTINCT t.id) as total_transactions,
      COALESCE(SUM(t.amount), 0) as total_spent
    FROM users u
    LEFT JOIN transactions t ON u.id = t.user_id
    WHERE u.serial_number = $1
    GROUP BY 
      u.id,
      u.card_type,
      u.strips_collected,
      u.strips_required,
      u.reward_unlocked,
      u.points,
      u.created_at
  `;

  const result = await db.query(query, [serialNumber]);
  return result.rows[0] || null;
};

/**
 * Registra una transacción (si tienes tabla de transacciones)
 * @param {Object} transaction
 * @returns {Promise<Object>}
 */
const createTransaction = async ({ userId, type, amount, description }) => {
  const query = `
    INSERT INTO transactions (user_id, type, amount, description, created_at)
    VALUES ($1, $2, $3, $4, NOW())
    RETURNING id, user_id, type, amount, description, created_at
  `;

  const result = await db.query(query, [userId, type, amount, description]);
  return result.rows[0];
};

/**
 * CORREGIDO: Busca una tarjeta por serial en tabla USERS
 * Usado para verificaciones rápidas
 */
const findCardBySerial = async (serial) => {
  try {
    const result = await db.query(
      `SELECT 
        id,
        serial_number,
        card_type,
        points,
        strips_collected,
        strips_required,
        reward_unlocked,
        business_id,
        loyalty_account_id
       FROM users
       WHERE serial_number = $1`,
      [serial]
    );

    return result.rows[0] || null;

  } catch (error) {
    console.error('[findCardBySerial] Error:', error);
    throw error;
  }
};

/**
 * Obtiene el PIN de un negocio
 */
const getBusinessPin = async (businessId) => {
  try {
    const result = await db.query(
      'SELECT admin_pin FROM businesses WHERE id = $1',
      [businessId]
    );

    return result.rows[0] || null;

  } catch (error) {
    console.error('[getBusinessPin] Error:', error);
    throw error;
  }
};

/**
 * CORREGIDO: Actualiza puntos en tabla USERS por serial
 * @param {string} serial - Serial number (UUID)
 * @param {number} newPoints - Nuevos puntos totales
 * @returns {Promise<boolean>}
 */
const updateCardPoints = async (serial, newPoints) => {
  try {
    const result = await db.query(
      `UPDATE users 
       SET points = $1,
           updated_at = NOW()
       WHERE serial_number = $2
       RETURNING id, points`,
      [newPoints, serial]
    );

    return result.rows.length > 0;

  } catch (error) {
    console.error('[updateCardPoints] Error:', error);
    throw error;
  }
};

/**
 * CORREGIDO: Resetea strips en tabla USERS por serial
 * @param {string} serial - Serial number (UUID)
 * @returns {Promise<boolean>}
 */
const resetCardStrips = async (serial) => {
  try {
    const result = await db.query(
      `UPDATE users 
       SET strips_collected = 0,
           reward_unlocked = false,
           updated_at = NOW()
       WHERE serial_number = $1
       RETURNING id, strips_collected, reward_unlocked`,
      [serial]
    );

    return result.rows.length > 0;

  } catch (error) {
    console.error('[resetCardStrips] Error:', error);
    throw error;
  }
};

/**
 * CORREGIDO: Incrementa contador de canjes en tabla USERS
 * Verifica primero si la columna existe para evitar errores
 */
const incrementRedemptions = async (serial) => {
  try {
    // Verificar si la columna total_redemptions existe
    const columnCheck = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' 
      AND column_name = 'total_redemptions'
    `);

    // Si la columna existe, incrementar
    if (columnCheck.rows.length > 0) {
      await db.query(
        `UPDATE users 
         SET total_redemptions = COALESCE(total_redemptions, 0) + 1,
             updated_at = NOW()
         WHERE serial_number = $1`,
        [serial]
      );
      console.log('[incrementRedemptions] Contador incrementado');
    } else {
      console.warn('[incrementRedemptions] Columna total_redemptions no existe, skipping...');
    }

    return true;

  } catch (error) {
    console.error('[incrementRedemptions] Error (no crítico):', error.message);
    // No lanzar error, solo loguear (es opcional)
    return false;
  }
};

module.exports = {
  // Queries principales
  getCardBySerial,
  getUserBySerial,
  
  // Actualizaciones
  updateUserStrips,
  updateUserPoints,
  resetUserStrips,
  
  // Validaciones
  hasBusinessLogo,
  hasBusinessStripImages,
  
  // Estadísticas
  getCardStats,
  
  // Transacciones (opcional)
  createTransaction, 

  // Funciones admin (corregidas)
  findCardBySerial,
  getBusinessPin,
  updateCardPoints,
  resetCardStrips,
  incrementRedemptions
};