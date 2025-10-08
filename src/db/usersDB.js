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

const createUser = (userData) => {
  return new Promise(async (resolve, reject) => {
    try {
      const {
        name, email, phone, business_id, points,
        serial_number, apple_auth_token, apple_pass_type_id, 
        card_detail_id, loyalty_account_id,
        // Campos que SÍ existen en tu DB
        strips_collected,
        strips_required,
        reward_unlocked
        // Nota: card_type y reward_title NO están en tu DB
      } = userData;

      console.log('[usersService.createUser] Campos recibidos:', {
        name,
        email,
        business_id,
        card_detail_id,
        strips_collected,
        strips_required,
        reward_unlocked
      });

      // Campos base obligatorios
      let fields = [
        'name', 'email', 'phone', 'business_id', 'points',
        'serial_number', 'apple_auth_token', 'apple_pass_type_id', 
        'card_detail_id', 'loyalty_account_id'
      ];
      
      let values = [
        name, 
        email, 
        phone, 
        business_id, 
        points || 0,
        serial_number, 
        apple_auth_token, 
        apple_pass_type_id, 
        card_detail_id, 
        loyalty_account_id
      ];

      // Agregar campos opcionales dinámicamente (solo los que existen en tu DB)
      const optionalFields = [
        { key: 'strips_collected', value: strips_collected || 0 }, // Siempre 0 al inicio
        { key: 'strips_required', value: strips_required }, // Del request (8 en tu caso)
        { key: 'reward_unlocked', value: reward_unlocked || false }
      ];

      optionalFields.forEach(field => {
        if (field.value !== undefined && field.value !== null) {
          fields.push(field.key);
          values.push(field.value);
        }
      });

      // Construir placeholders ($1, $2, etc.)
      const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
      
      const query = `
        INSERT INTO users (${fields.join(', ')})
        VALUES (${placeholders})
        RETURNING *
      `;

      console.log('[usersService.createUser] Query construido:', {
        fieldsCount: fields.length,
        valuesCount: values.length,
        fields: fields,
        sampleValues: values.slice(0, 5), // Primeros 5 valores para debug
        hasStripsData: !!(strips_required || strips_collected)
      });

      // Validaciones antes de ejecutar
      if (!name || !email || !business_id) {
        return reject(new Error('Campos obligatorios faltantes: name, email, business_id'));
      }

      if (fields.length !== values.length) {
        return reject(new Error(`Mismatch fields/values: ${fields.length} fields vs ${values.length} values`));
      }

      // Ejecutar query con pool de conexiones
      pool.query(query, values, (error, results) => {
        if (error) {
          console.error('[usersService.createUser] Database error:', {
            message: error.message,
            code: error.code,
            detail: error.detail,
            constraint: error.constraint
          });
          return reject(error);
        }

        if (!results.rows || results.rows.length === 0) {
          console.error('[usersService.createUser] No rows returned');
          return reject(new Error('No user created - no rows returned'));
        }

        const createdUser = results.rows[0];
        
        console.log('[usersService.createUser] ✅ Usuario creado exitosamente:', {
          id: createdUser.id,
          serial_number: createdUser.serial_number,
          strips_required: createdUser.strips_required,
          strips_collected: createdUser.strips_collected,
          reward_unlocked: createdUser.reward_unlocked
        });

        resolve(createdUser);
      });

    } catch (error) {
      console.error('[usersService.createUser] Unexpected error:', error);
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
const createUserFull = async (d) => {
  const serial = d.serial_number || uuidv4();
  const apple_pass_type_id = d.apple_pass_type_id || PASS_TYPE_IDENTIFIER;

  // Determinar el tipo de tarjeta
  const card_type = d.card_type || 'points';  // Se debe agregar un valor predeterminado si no se pasa
  console.log('[createUserFull] card_type:', card_type);

  const sql = `
    INSERT INTO users
      (name, email, phone, business_id, points, serial_number,
       apple_auth_token, apple_pass_type_id, card_detail_id, loyalty_account_id, 
       strips_collected, strips_required, reward_unlocked, updated_at, card_type)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW(),$14)
    RETURNING *`;

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
    d.strips_collected || 0,
    d.strips_required || null, 
    d.reward_unlocked || false,
    d.card_type || 'points' 
  ];

  // Guardar el tipo de tarjeta como 'strips' o 'points'
  if (card_type === 'strips') {
    params[10] = 0;  // strips_collected
    params[11] = d.strips_required || 10; // strips_required
    params[12] = d.reward_unlocked || false; // reward_unlocked
  }

  // Ejecución de la consulta para insertar el usuario
  try {
    const { rows } = await pool.query(sql, params);
    const createdUser = rows[0];
    console.log('[createUserFull] Usuario creado:', createdUser);
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
    'serial_number','updated_at'
  ]);

  // Nunca permitas cambiar el pass type id a algo distinto
  if (patch.apple_pass_type_id && patch.apple_pass_type_id !== PASS_TYPE_IDENTIFIER) {
    patch.apple_pass_type_id = PASS_TYPE_IDENTIFIER;
  }
  // Repara token corto o vacío
  if ('apple_auth_token' in patch) {
    patch.apple_auth_token = ensureAuthToken(patch.apple_auth_token);
  }
  // (Opcional) impedir cambiar serial salvo que tú lo decidas
  // if ('serial_number' in patch) delete patch.serial_number;

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
  return rows[0];
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
      SELECT name, email, business_id, points, card_type, strips_collected, strips_required, reward_unlocked
      FROM users WHERE serial_number = $1
    `;
    pool.query(sql, [serial], (error, results) => {
      if (error) return reject({ message: error.message, code: error.code });
      resolve(results.rows[0]);
    });
  });
};

const searchUsersByData = async (searchTerm, searchType) => {
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
        reward_unlocked
      FROM users 
      WHERE 1=1
    `;
    
    const params = [];
    
    // Determinar el tipo de búsqueda
    if (searchType === 'serial') {
      sql += ` AND serial_number = $1`;
      params.push(searchTerm.trim());
    } else if (searchType === 'email') {
      sql += ` AND LOWER(email) LIKE LOWER($1)`;
      params.push(`%${searchTerm.trim()}%`);
    } else if (searchType === 'phone') {
      // Limpiar el teléfono de espacios y caracteres especiales
      const cleanPhone = searchTerm.replace(/[\s\-\(\)]/g, '');
      sql += ` AND REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE $1`;
      params.push(`%${cleanPhone}%`);
    } else {
      // Búsqueda general en todos los campos
      const cleanPhone = searchTerm.replace(/[\s\-\(\)]/g, '');
      sql += ` AND (
        serial_number = $1 OR
        LOWER(email) LIKE LOWER($2) OR
        REPLACE(REPLACE(REPLACE(REPLACE(phone, ' ', ''), '-', ''), '(', ''), ')', '') LIKE $3
      )`;
      params.push(searchTerm.trim(), `%${searchTerm.trim()}%`, `%${cleanPhone}%`);
    }
    
    sql += ` LIMIT 10`;

    pool.query(sql, params, (error, results) => {
      if (error) {
        return reject({ 
          message: error.message, 
          code: error.code 
        });
      }
      resolve(results.rows);
    });
  });
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
  searchUsersByData
};
