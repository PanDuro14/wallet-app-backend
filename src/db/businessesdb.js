const bcrypt = require('bcryptjs'); 
const dbConnection = require('./dbConection'); 
const dbLocal = require('./dbConectionLocal'); 

let pool; 

(async () => {
  try {
    await dbConnection.connect(); 
    console.log('Conexión con la db remota exitosa: Business'); 
    pool = dbConnection; 
  } catch (errRemota){
    console.warn('Error con la db remota. Intentando conexión local... ', errRemota.message); 

    try {
      await dbLocal.connect(); 
      console.log('Conexión con la db local exitosa: Business'); 
      pool = dbLocal; 
    } catch (errLocal){
      console.error('Error al conectar con la db local: ', errLocal.message); 
    }
  }
})(); 

// Login de businesses
const loginBusiness = async (email, password) => {
    return new Promise((resolve, reject) => {
        const sql = 'SELECT * FROM businesses WHERE email = $1'; 
        pool.query(sql, [email], async (error, results) => {
            if (error) return reject(error); 
            if (results.rows.length === 0) return reject('Error: Usuario no encontrado');

            const user = results.rows[0]; 
            const isMatch = await bcrypt.compare(password, user.password);
            isMatch ? resolve(user) : reject('Contraseña incorrecta');
        }); 
    }); 
}


// Obtener todos los business
const getAllBusinesses = async () => {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM businesses';
    pool.query(sql, (error, results) => {
      if (error) return reject(error);
      resolve(results.rows);
    });
  });
};

// Obtener usuario por ID
const getOneBusiness  = async (id) => {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT * FROM businesses WHERE id = $1';
    pool.query(sql, [id], (error, results) => {
      if (error) return reject(error);
      resolve(results.rows);
    });
  });
};

// Crear nuevo negocio con contraseña cifrada
const createBusiness = async (name, email, password, logoBuffer, created_at, updated_at) => {
  return new Promise(async (resolve, reject) => {
    try {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      const sql = `
        INSERT INTO businesses 
          (name, email, password, logo, created_at, updated_at) 
        VALUES ($1, $2, $3, $4, $5, $6) 
        RETURNING *`;
      
      pool.query(sql, [name, email, hashedPassword, logoBuffer, created_at, updated_at], (error, results) => {
        if (error) return reject(error);
        resolve(results.rows[0]); 
      });
    } catch (error) {
      reject(error);
    }
  });
};

// Actualizar negocio por ID
const updateBusiness = async (id, name, email, password, logoBuffer, created_at, updated_at) => {
  return new Promise((resolve, reject) => {
    try {
      const sql = `UPDATE businesses
        SET name = $1, email = $2, password = $3, logo = $4, created_at = $5, updated_at = $6
        WHERE id = $7`;
      
        pool.query(sql, [name, email, password, logoBuffer, created_at, updated_at, id], (error, results)); 
        if (error) return reject(error); 
        resolve('Business actualizado'); 
    } catch (error) {
      console.error(error); 
    }
  }); 
}

// Eliminar un negocio por ID
const deleteBusiness = async (id) => {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM businesses WHERE id = $1';
    pool.query(sql, [id], (error, results) => {
      if (error) return reject(error);
      resolve('Negocio eliminado');
    });
  });
};

// getEmailByEmail 
const getEmail = async (email) => {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT name, email FROM businesses WHERE email = $1'; 
    pool.query(sql, [email], (error, results) => {
      if(error) return reject(error); 
      resolve(results.rows[0]); 
    });
  }); 
}

module.exports = {
  loginBusiness,
  getAllBusinesses,
  getOneBusiness,
  createBusiness,
  updateBusiness,
  deleteBusiness,
  getEmail,
};