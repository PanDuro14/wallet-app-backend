const dbConnection = require('./dbConection'); 
const dbLocal = require('./dbConectionLocal'); 
const { v4: uuidv4 } = require('uuid');

const PASS_TYPE_IDENTIFIER = process.env.PASS_TYPE_IDENTIFIER;
if (!PASS_TYPE_IDENTIFIER || !/^pass\./.test(PASS_TYPE_IDENTIFIER)) {
  console.error('[BOOT] PASS_TYPE_IDENTIFIER inválido o vacío. Debe iniciar con "pass."');
}
let pool; 

(async () => {
  try {
    await dbConnection.connect(); 
    console.log('Conexión con la db remota exitosa: Users'); 
    pool = dbConnection; 
  } catch (errRemota){
    console.warn('Error con la db remota. Intentando conexión local... ', errRemota.message); 

    try {
      await dbLocal.connect(); 
      console.log('Conexión con la db local exitosa: Users'); 
      pool = dbLocal; 
    } catch (errLocal){
      console.error('Error al conectar con la db local: ', errLocal.message); 
    }
  }
})(); 


// Obtener todos los usuarios
const getAllUsers = async () => {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM users';
    pool.query(sql, (error, results) => {
      if (error) return reject(error);
      resolve(results.rows);
    });
  });
};

// Obtener un usuario por ID
const getOneUser = async (id) => {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM users WHERE id = $1';
    pool.query(sql, [id], (error, results) => {
      if (error) return reject(error);
      resolve(results.rows[0]);
    });
  });
};

// Obtener un usuario por el id del negocio 
const getOneUserByBusiness = async(id) => {
  return new Promise((resolve, reject) => {
    const sql = `SELECT * FROM users WHERE business_id = $1`; 
    pool.query(sql, [id], (error, results) => {
      if(error) return reject(error); 
      resolve(results.rows); 
    }); 
  }); 
}

// Crear un nuevo usuario
// En src/services/usersService.js
// Modificar la función createUser

// Crear un nuevo usuario con Promise
// En src/services/usersService.js

// services/usersService.js

/**
 * Crear nuevo usuario con soporte completo de strips y multi-tier
 * VERSIÓN UNIFICADA - Compatible con usersDB.createUser actual
 */
const createUser = (userData) => {
  return new Promise(async (resolve, reject) => {
    try {
      const {
        name, email, phone, business_id, points,
        serial_number, apple_auth_token, apple_pass_type_id, 
        card_detail_id, loyalty_account_id,
        card_type, design_variant,
        strips_collected, strips_required,
        reward_title, reward_description, reward_unlocked
      } = userData;

      console.log('[createUser] Campos recibidos:', {
        name, email, business_id, card_type,
        strips_required, reward_title
      });

      if (!name || !email || !business_id) {
        return reject(new Error('Campos obligatorios: name, email, business_id'));
      }

      if (!serial_number) {
        return reject(new Error('serial_number es obligatorio'));
      }

      const effectiveCardType = card_type || design_variant || 'points';
      
      console.log('[createUser] card_type efectivo:', effectiveCardType);

      let fields = [
        'name', 'email', 'phone', 'business_id', 'points',
        'serial_number', 'apple_auth_token', 'apple_pass_type_id', 
        'card_detail_id', 'loyalty_account_id', 'card_type'
      ];
      
      let values = [
        name, email, phone, business_id, points || 0,
        serial_number, apple_auth_token, apple_pass_type_id, 
        card_detail_id, loyalty_account_id, effectiveCardType
      ];

      if (effectiveCardType === 'strips') {
        fields.push('strips_collected', 'strips_required', 'reward_title', 'reward_description', 'reward_unlocked');
        values.push(
          strips_collected ?? 0,
          strips_required ?? 10,
          reward_title || 'Recompensa',
          reward_description || null,
          reward_unlocked ?? false
        );
        
        console.log('[createUser] Strips fields agregados:', {
          strips_required: strips_required ?? 10,
          reward_title: reward_title || 'Recompensa'
        });
      }

      // CRÍTICO: Agregar $ antes del número
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      
      const query = `
        INSERT INTO users (${fields.join(', ')})
        VALUES (${placeholders})
        RETURNING *
      `;

      console.log('[createUser] Query:', {
        fieldsCount: fields.length,
        valuesCount: values.length,
        cardType: effectiveCardType,
        // Debug del query completo
        samplePlaceholders: placeholders.split(',').slice(0, 5).join(',')
      });

      if (fields.length !== values.length) {
        return reject(new Error(`Mismatch: ${fields.length} fields vs ${values.length} values`));
      }

      pool.query(query, values, (error, results) => {
        if (error) {
          console.error('[createUser] DB error:', {
            message: error.message,
            code: error.code,
            detail: error.detail
          });
          return reject(error);
        }

        if (!results.rows || results.rows.length === 0) {
          return reject(new Error('No user created'));
        }

        const createdUser = results.rows[0];
        
        console.log('[createUser] Usuario creado:', {
          id: createdUser.id,
          card_type: createdUser.card_type,
          reward_title: createdUser.reward_title
        });

        if (effectiveCardType === 'strips' && !createdUser.reward_title) {
          console.warn('[createUser] Usuario strips sin reward_title');
        }

        resolve(createdUser);
      });

    } catch (error) {
      console.error('[createUser] Unexpected error:', error);
      reject(error);
    }
  });
};


// ========== FUNCIÓN DE UTILIDAD PARA VALIDAR STRIPS ==========
const validateStripsData = (userData) => {
  const { strips_required } = userData;
  
  // Si especifica strips_required, validar que sea válido
  if (strips_required !== undefined) {
    if (!strips_required || strips_required < 1) {
      throw new Error('strips_required debe ser mayor a 0');
    }
  }
  
  return true;
};

// ========== FUNCIÓN HELPER PARA PREPARAR DATOS DE STRIPS ==========
const prepareStripsData = (requestData) => {
  // Mapear nombres del request a nombres de DB (solo los que existen)
  const mapping = {
    stripsRequired: 'strips_required',
    stripsCollected: 'strips_collected',
    rewardUnlocked: 'reward_unlocked'
    // Nota: variant -> card_type NO existe en tu DB
    // Nota: rewardTitle -> reward_title NO existe en tu DB
  };

  const prepared = { ...requestData };
  
  // Aplicar mapeo
  Object.keys(mapping).forEach(reqKey => {
    if (requestData[reqKey] !== undefined) {
      prepared[mapping[reqKey]] = requestData[reqKey];
      delete prepared[reqKey]; // Eliminar la key original
    }
  });

  // Valores por defecto para strips (basados en tu DB)
  if (prepared.strips_required !== undefined) {
    prepared.strips_collected = prepared.strips_collected || 0;
    prepared.reward_unlocked = prepared.reward_unlocked || false;
  }

  console.log('[prepareStripsData] Transformación:', {
    original: Object.keys(requestData),
    transformed: Object.keys(prepared),
    stripFields: {
      strips_required: prepared.strips_required,
      strips_collected: prepared.strips_collected,
      reward_unlocked: prepared.reward_unlocked
    }
  });

  return prepared;
};

// Actualizar un usuario
const updateUser = async (id, name, email, phone) => {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE users SET
        name = $1,
        email = $2,
        phone = $3,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *`;
    pool.query(sql, [name, email, phone, id], (error, results) => {
      if (error) return reject(error);
      resolve(results.rows[0]);
    });
  });
};

// Eliminar un usuario
const deleteUser = async (id) => {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM users WHERE id = $1';
    pool.query(sql, [id], (error) => {
      if (error) return reject(error);
      resolve('Usuario eliminado');
    });
  });
};


// db/usersDB.js
const saveUserWallet = async ({ userId, loyalty_account_id, wallet_url }) => {
  const sql = `
    UPDATE users SET
      loyalty_account_id = $1,
      wallet_url = $2,
      updated_at = NOW()
    WHERE id = $3
    RETURNING *`;
  const params = [loyalty_account_id, wallet_url, userId];
  const { rows } = await pool.query(sql, params);
  return rows[0];
};

const markWalletAdded = async ({ userId }) => {
  const sql = `
    UPDATE users SET
      wallet_added = TRUE,
      wallet_added_at = NOW(),
      updated_at = NOW()
    WHERE id = $1
    RETURNING *`;
  const { rows } = await pool.query(sql, [userId]);
  return rows[0];
};


// INSERT con columnas explícitas (recibe el objeto “full”)
// db/usersDB.js

const createUserFull = async (d) => {
  const serial = d.serial_number || uuidv4();
  const apple_pass_type_id = d.apple_pass_type_id || PASS_TYPE_IDENTIFIER;

  // Determinar el tipo de tarjeta
  const card_type = d.card_type || d.design_variant || 'points';
  
  console.log('[createUserFull] card_type:', card_type);
  console.log('[createUserFull] reward_title recibido:', d.reward_title); // Debug

  const sql = `
    INSERT INTO users
      (name, email, phone, business_id, points, serial_number,
       apple_auth_token, apple_pass_type_id, card_detail_id, loyalty_account_id, 
       strips_collected, strips_required, reward_title, reward_description, 
       reward_unlocked, updated_at, card_type)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),$16)
    RETURNING *`;

  // Preparar parámetros según tipo de tarjeta
  let strips_collected = 0;
  let strips_required = null;
  let reward_title = null;
  let reward_description = null;
  let reward_unlocked = false;

  if (card_type === 'strips') {
    strips_collected = d.strips_collected ?? 0;
    strips_required = d.strips_required ?? 10;
    reward_title = d.reward_title || 'Recompensa'; // CRÍTICO: Con fallback
    reward_description = d.reward_description || null;
    reward_unlocked = d.reward_unlocked ?? false;
    
    console.log('[createUserFull] Strips data:', {
      strips_required,
      reward_title, // Debe tener valor aquí
      reward_description
    });
  }

  const params = [
    d.name,
    d.email,
    d.phone || null,
    d.business_id,
    d.points ?? 0,
    serial,
    d.apple_auth_token || null,
    apple_pass_type_id,
    d.card_detail_id || null,
    d.loyalty_account_id || null,
    strips_collected,        // $11
    strips_required,         // $12
    reward_title,            // $13  CRÍTICO
    reward_description,      // $14
    reward_unlocked,         // $15
    card_type                // $16
  ];

  console.log('[createUserFull] Parámetros SQL:', {
    param11_strips_collected: params[10],
    param12_strips_required: params[11],
    param13_reward_title: params[12], // Debe tener valor
    param16_card_type: params[15]
  });

  try {
    const { rows } = await pool.query(sql, params);
    const createdUser = rows[0];
    
    console.log('[createUserFull] Usuario creado:', {
      id: createdUser.id,
      card_type: createdUser.card_type,
      reward_title: createdUser.reward_title, // Verificar que tenga valor
      strips_required: createdUser.strips_required
    });
    
    // Validación post-creación
    if (card_type === 'strips' && !createdUser.reward_title) {
      console.error('[createUserFull] CRITICAL: Usuario strips creado sin reward_title!');
    }
    
    return createdUser;
  } catch (error) {
    console.error('[createUserFull] Database error:', error);
    throw error;
  }
};


// UPDATE genérico con patch (solo columnas permitidas)
const updateUserFields = async (id, patch) => {
  const allowed = new Set([
    'name','email','phone','points','apple_auth_token','apple_pass_type_id',
    'card_detail_id','loyalty_account_id','wallet_url','wallet_added','wallet_added_at',
    'serial_number','updated_at',
    'strips_collected','strips_required','reward_unlocked'
  ]);

  // Nunca permitas cambiar el pass type id a algo distinto
  if (patch.apple_pass_type_id && patch.apple_pass_type_id !== PASS_TYPE_IDENTIFIER) {
    patch.apple_pass_type_id = PASS_TYPE_IDENTIFIER;
  }
  // Repara token corto o vacío
  if ('apple_auth_token' in patch) {
    patch.apple_auth_token = ensureAuthToken(patch.apple_auth_token);
  }

  const keys = Object.keys(patch).filter(k => allowed.has(k));
  if (!keys.length) {
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [id]);
    return rows[0];
  }

  // fuerza updated_at si no viene
  if (!keys.includes('updated_at')) {
    keys.push('updated_at');
    patch.updated_at = new Date();
  }

  const setClauses = keys.map((k, i) => `"${k}"=$${i+2}`);
  const params = [id, ...keys.map(k => patch[k])];

  const sql = `UPDATE users SET ${setClauses.join(', ')} WHERE id=$1 RETURNING *`;
  const { rows } = await pool.query(sql, params);
  const updatedUser = rows[0];

  try {
    await pool.query(`
      UPDATE apple_wallet_registrations
      SET updated_at = NOW()
      WHERE user_id = $1
    `, [id]);
    console.log(`[updateUserFields] Actualizado apple_wallet_registrations para user ${id}`);
  } catch (regError) {
    console.error('[updateUserFields] Error actualizando registrations:', regError.message);
    // No bloquear la operación principal
  }

  return updatedUser;
};

// db/appleWalletdb.js (o donde defines tus queries de Apple Wallet)
async function bumpPointsBySerial(serial, delta) {
  const sql = `
    UPDATE users
    SET points = GREATEST(0, points + $2),
        updated_at = NOW() AT TIME ZONE 'UTC'
    WHERE serial_number = $1
    RETURNING
      points,
      updated_at AS "updatedAt";
  `;
  const { rows } = await pool.query(sql, [serial, delta]);
  return rows[0] || null;
}

const getUserDataBySerial = async (serial) => {
  return new Promise((resolve, reject) => {
    const sql = `
      SELECT id, name, email, business_id, points, card_type, strips_collected, strips_required, reward_unlocked
      FROM users WHERE serial_number = $1
    `;
    pool.query(sql, [serial], (error, results) => {
      if (error) return reject({ message: error.message, code: error.code });
      resolve(results.rows[0]);
    });
  });
};

// db/usersDB.js

const searchUsersByData = async (searchTerm, searchType, business_id) => {
  return new Promise((resolve, reject) => {
    let sql = `
      SELECT 
        serial_number as serial,
        name, 
        email, 
        phone, 
        card_type, 
        points, 
        strips_collected, 
        strips_required,
        reward_title,
        reward_unlocked,
        business_id
      FROM users 
      WHERE business_id = $1
    `;
    
    const params = [business_id];
    let paramIndex = 2;
    
    // Determinar el tipo de búsqueda
    if (searchType === 'serial') {
      sql += ` AND serial_number = $${paramIndex}`;
      params.push(searchTerm.trim());
    } else if (searchType === 'email') {
      sql += ` AND LOWER(email) LIKE LOWER($${paramIndex})`;
      params.push(`%${searchTerm.trim()}%`);
    } else if (searchType === 'phone') {
      const cleanPhone = searchTerm.replace(/[\s\-\(\)]/g, '');
      sql += ` AND REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE $${paramIndex}`;
      params.push(`%${cleanPhone}%`);
    } else {
      // Búsqueda general en todos los campos
      const cleanPhone = searchTerm.replace(/[\s\-\(\)]/g, '');
      sql += ` AND (
        serial_number = $${paramIndex} OR
        LOWER(email) LIKE LOWER($${paramIndex + 1}) OR
        REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE $${paramIndex + 2}
      )`;
      params.push(searchTerm.trim(), `%${searchTerm.trim()}%`, `%${cleanPhone}%`);
    }
    
    sql += ` LIMIT 10`;

    console.log('[searchUsersByData] SQL:', sql);
    console.log('[searchUsersByData] Params:', params);

    pool.query(sql, params, (error, results) => {
      if (error) {
        return reject({ 
          message: error.message, 
          code: error.code 
        });
      }
      
      console.log('[searchUsersByData] Resultados:', results.rows.length);
      resolve(results.rows);
    });
  });
};


/**
 * Obtiene usuarios inactivos según días de inactividad
 * @param {number} inactiveDays - Días de inactividad
 * @param {number} businessId - (Opcional) Filtrar por negocio
 */
const getInactiveUsers = async (inactiveDays = 7, businessId = null) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - inactiveDays);

    let query = `
      SELECT 
        u.*,
        c.card_type,
        c.strips_required
      FROM users u
      LEFT JOIN cards c ON u.card_detail_id = c.id
      WHERE u.updated_at < $1
        AND u.serial_number IS NOT NULL
    `;

    const params = [cutoffDate];

    if (businessId) {
      query += ` AND u.business_id = $2`;
      params.push(businessId);
    }

    query += ` ORDER BY u.updated_at ASC`;

    const result = await pool.query(query, params);
    return result.rows;

  } catch (error) {
    console.error('[getInactiveUsers] Error:', error);
    throw error;
  }
};

const calculateCurrentTier = (user, multiTierConfig) => {
  const stripsCollected = user.strips_collected || 0;
  const rewards = multiTierConfig.rewards || [];

  if (!rewards.length) {
    return {
      currentLevel: 1,
      totalLevels: 1,
      stripsRequiredForCurrentTier: user.strips_required || 10,
      currentReward: { title: 'Premio', strips_required: user.strips_required || 10 },
      nextReward: null,
      isLastTier: true
    };
  }

  let currentLevel = 1;
  let currentReward = rewards[0];

  for (let i = 0; i < rewards.length; i++) {
    if (stripsCollected >= rewards[i].strips_required) {
      currentLevel = i + 2;
      if (i + 1 < rewards.length) {
        currentReward = rewards[i + 1];
      } else {
        currentReward = rewards[i];
        currentLevel = i + 1;
      }
    } else {
      currentReward = rewards[i];
      currentLevel = i + 1;
      break;
    }
  }

  if (currentLevel > rewards.length) {
    currentLevel = rewards.length;
    currentReward = rewards[rewards.length - 1];
  }

  const nextReward = currentLevel < rewards.length ? rewards[currentLevel] : null;
  const isLastTier = currentLevel === rewards.length;

  return {
    currentLevel,
    totalLevels: rewards.length,
    stripsRequiredForCurrentTier: currentReward.strips_required,
    currentReward,
    nextReward,
    isLastTier
  };
};

module.exports = {
  getAllUsers,
  getOneUser,
  getOneUserByBusiness, 
  createUser,
  updateUser,
  deleteUser,
  saveUserWallet, 
  markWalletAdded, 
  createUserFull,
  updateUserFields, 
  bumpPointsBySerial,
  getUserDataBySerial, 
  validateStripsData,
  prepareStripsData, 
  searchUsersByData, 
  getInactiveUsers,
  calculateCurrentTier,  
};