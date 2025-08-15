const dbConnection = require('./dbConection'); 
const dbLocal = require('./dbConectionLocal'); 
const { v4: uuidv4 } = require('uuid');

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


module.exports = {
  getAllUsers,
  getOneUser,
  createUser,
  updateUser,
  deleteUser,
  saveUserWallet, 
  markWalletAdded
};
