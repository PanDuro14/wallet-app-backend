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
        const sql = 'SELECT  id, name, email, password  FROM businesses WHERE email = $1'; 
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
const createBusiness = async (name, email, password, logoBuffer, stripImageOn, stripImageOff, created_at, updated_at) => {
  return new Promise(async (resolve, reject) => {
    try {
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      const sql = `
        INSERT INTO businesses 
          (name, email, password, logo, strip_image_on, strip_image_off, created_at, updated_at) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
        RETURNING *`;
      
      pool.query(sql, [name, email, hashedPassword, logoBuffer, stripImageOn, stripImageOff, created_at, updated_at], (error, results) => {
        if (error) return reject(error);
        resolve(results.rows[0]); 
      });
    } catch (error) {
      reject(error);
    }
  });
};

// Actualizar negocio por ID
const updateBusiness = async (id, name, email, password, logoBuffer, stripImageOn, stripImageOff, created_at, updated_at) => {
  return new Promise((resolve, reject) => {
    try {
      const sql = `UPDATE businesses
        SET name = $1, email = $2, password = $3, logo = $4, strip_image_on = $5, strip_image_off = $6, created_at = $7, updated_at = $8
        WHERE id = $9`;

      pool.query(sql, [name, email, password, logoBuffer, stripImageOn, stripImageOff, created_at, updated_at, id], (error, results) => {
        if (error) {
          console.error('Error al actualizar el negocio:', error);
          return reject(error); 
        }
        resolve('Business actualizado');
      });

    } catch (err) {
      console.error('Error en la ejecución de updateBusiness:', err);
      reject(err);
    }
  });
}


// Eliminar un negocio por ID
const deleteBusiness = async (id) => {
  return new Promise((resolve, reject) => {
    try {
      const sql = 'DELETE FROM card_details WHERE business_id = $1';
      pool.query(sql, [id], (error, results) => {
        if (error) return reject(error);
        resolve('Negocio eliminado');
      });
    } finally {
      const sql = 'DELETE FROM businesses WHERE id = $1';
      pool.query(sql, [id], (error, results) => {
        if (error) return reject(error);
        resolve('Negocio eliminado');
      });
    }
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

const getCurrentDesignById = async(id) => {
  return new Promise((resolve, reject) => {
    const sql = 'SELECT default_card_detail_id FROM  businesses WHERE id = $1'; 
    pool.query(sql, [id], (error, results) => {
      if(error) return reject(error); 
      resolve(results.rows[0]); 
    });
  }); 
}


async function updateCurrentDesignById(designId, businessId) {
  return new Promise((resolve, reject) => {
    const did = Number.parseInt(String(designId).trim(), 10);
    const bid = Number.parseInt(String(businessId).trim(), 10);
    if (!Number.isFinite(did) || !Number.isFinite(bid)) {
      const err = new Error('IDs inválidos'); err.statusCode = 400; return reject(err);
    }
    if (did > 2147483647 || bid > 2147483647 || did < -2147483648 || bid < -2147483648) {
      const err = new Error('IDs fuera de rango INTEGER'); err.statusCode = 400; return reject(err);
    }

    const sql = `
      UPDATE businesses
         SET default_card_detail_id = $1::integer,
             updated_at = NOW()
       WHERE id = $2::integer
       RETURNING id, default_card_detail_id
    `;
    pool.query(sql, [did, bid], (error, results) => {       
      if (error) return reject(error);
      if (!results.rowCount) {
        const e = new Error('Negocio no encontrado'); e.statusCode = 404; return reject(e);
      }
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
  getCurrentDesignById, 
  updateCurrentDesignById
};