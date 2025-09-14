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
const createUser = async (name, email, phone, business_id, points = 0, serial_number = null) => {
  serial_number = serial_number || uuidv4();
  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO users (name, email, phone, business_id, points, serial_number)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`;
    pool.query(sql, [name, email, phone, business_id, points, serial_number], (error, results) => {
      if (error) return reject(error);
      resolve(results.rows[0]);
    });
  });
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

  // tomar del payload o caer a env
  const apple_pass_type_id = d.apple_pass_type_id || PASS_TYPE_IDENTIFIER;

  // guardas token y type id ya normalizados por el process
  const sql = `
    INSERT INTO users
      (name, email, phone, business_id, points, serial_number,
       apple_auth_token, apple_pass_type_id, card_detail_id, loyalty_account_id, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
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
    d.loyalty_account_id || null
  ];
  const { rows } = await pool.query(sql, params);
  return rows[0];
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
      SELECT name, email, business_id, points
      FROM users WHERE serial_number = $1
    `;
    pool.query(sql, [serial], (error, results) => {
      if (error) return reject({ message: error.message, code: error.code });
      resolve(results.rows[0]);
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
  getUserDataBySerial
};
