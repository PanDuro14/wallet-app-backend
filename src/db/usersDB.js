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
const createUser = async (name, email, phone, business_id, points = 0, serial_number = null, authentication_token = null, strip_image_url = null) => {
  // Generar UUID para 'serial_number' si no se pasa
  serial_number = serial_number || uuidv4();

  return new Promise((resolve, reject) => {
    const sql = `
      INSERT INTO users (name, email, phone, business_id, points, serial_number, authentication_token, strip_image_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`;

    pool.query(sql, [name, email, phone, business_id, points, serial_number, authentication_token, strip_image_url], (error, results) => {
      if (error) return reject(error);
      resolve(results.rows[0]);
    });
  });
};

// Actualizar un usuario
const updateUser = async (id, name, email, phone, points, authentication_token, strip_image_url) => {
  return new Promise((resolve, reject) => {
    const sql = `
      UPDATE users SET 
        name = $1, 
        email = $2, 
        phone = $3, 
        points = $4, 
        authentication_token = $5, 
        strip_image_url = $6 
      WHERE id = $7 RETURNING *`;
    pool.query(sql, [name, email, phone, points, authentication_token, strip_image_url, id], (error, results) => {
      if (error) return reject(error);
      resolve(results.rows[0]);
    });
  });
};

// Eliminar un usuario
const deleteUser = async (id) => {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM users WHERE id = $1';
    pool.query(sql, [id], (error, results) => {
      if (error) return reject(error);
      resolve('Usuario eliminado');
    });
  });
};

module.exports = {
  getAllUsers,
  getOneUser,
  createUser,
  updateUser,
  deleteUser,
};
