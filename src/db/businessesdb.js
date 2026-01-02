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
const updateBusiness = async (id, updates = {}) => {
  return new Promise(async (resolve, reject) => {
    try {
      // 1. Obtener el negocio actual primero
      const getCurrentSql = 'SELECT * FROM businesses WHERE id = $1';
      pool.query(getCurrentSql, [id], async (error, currentResults) => {
        if (error) {
          console.error('Error al obtener el negocio actual:', error);
          return reject(error);
        }

        if (currentResults.rows.length === 0) {
          return reject(new Error('Negocio no encontrado'));
        }

        const currentBusiness = currentResults.rows[0];
        console.log('[updateBusiness] Negocio actual:', {
          id: currentBusiness.id,
          name: currentBusiness.name,
          email: currentBusiness.email,
          hasLogo: !!currentBusiness.logo,
          hasStripOn: !!currentBusiness.strip_image_on,
          hasStripOff: !!currentBusiness.strip_image_off
        });

        // 2. Construir campos a actualizar dinámicamente
        const fieldsToUpdate = [];
        const values = [];
        let paramIndex = 1;

        // Helper para agregar campo si existe
        const addField = (fieldName, value, shouldHash = false) => {
          if (value !== undefined && value !== null) {
            fieldsToUpdate.push(`${fieldName} = $${paramIndex}`);
            values.push(shouldHash ? value : value); // El hash se hace después si es password
            paramIndex++;
            return true;
          }
          return false;
        };

        // Agregar campos si están presentes
        if (updates.name) {
          addField('name', updates.name);
          console.log('[updateBusiness] Actualizando nombre:', updates.name);
        }

        if (updates.email) {
          addField('email', updates.email.toLowerCase());
          console.log('[updateBusiness] Actualizando email:', updates.email);
        }

        // Password requiere hashing
        if (updates.password) {
          const salt = await bcrypt.genSalt(10);
          const hashedPassword = await bcrypt.hash(updates.password, salt);
          addField('password', hashedPassword);
          console.log('[updateBusiness] Actualizando password (hasheada)');
        }

        if (updates.logo) {
          addField('logo', updates.logo);
          console.log('[updateBusiness] Actualizando logo:', updates.logo.length, 'bytes');
        }

        if (updates.strip_image_on) {
          addField('strip_image_on', updates.strip_image_on);
          console.log('[updateBusiness] Actualizando strip_image_on:', updates.strip_image_on.length, 'bytes');
        }

        if (updates.strip_image_off) {
          addField('strip_image_off', updates.strip_image_off);
          console.log('[updateBusiness] Actualizando strip_image_off:', updates.strip_image_off.length, 'bytes');
        }

        // Siempre actualizar updated_at
        fieldsToUpdate.push(`updated_at = NOW()`);

        // 3. Verificar que hay algo que actualizar
        if (fieldsToUpdate.length === 1) { // Solo tiene updated_at
          console.log('[updateBusiness] No hay campos para actualizar (solo updated_at)');
          return resolve(currentBusiness);
        }

        // 4. Construir y ejecutar query
        values.push(id); // ID siempre al final para WHERE
        const sql = `
          UPDATE businesses
          SET ${fieldsToUpdate.join(', ')}
          WHERE id = $${paramIndex}
          RETURNING *
        `;

        console.log('[updateBusiness] SQL generado:', sql);
        console.log('[updateBusiness] Valores:', values.map((v, i) => 
          i === values.length - 1 ? `[ID: ${v}]` : 
          Buffer.isBuffer(v) ? `[Buffer ${v.length} bytes]` : 
          v
        ));

        pool.query(sql, values, (error, results) => {
          if (error) {
            console.error('Error al actualizar el negocio:', error);
            return reject(error); 
          }

          if (results.rows.length === 0) {
            return reject(new Error('No se pudo actualizar el negocio'));
          }

          console.log('[updateBusiness] Negocio actualizado exitosamente');
          resolve(results.rows[0]);
        });
      });

    } catch (err) {
      console.error('Error en la ejecución de updateBusiness:', err);
      reject(err);
    }
  });
};


// Eliminar un negocio por ID
const deleteBusiness = async (id) => {
  return new Promise(async (resolve, reject) => {
    try {
  
      // 1. user_strips_log (depende de users)
      await deleteAllUserStripsLogByBusiness(id);    
      // 2. apple_wallet_registrations (depende de users)
      await deleteAllAppleWalletRegistrationsByBusiness(id);
      // 3. push_subscriptions (depende de users) 
      await deleteAllPushSubscriptionsByBusiness(id);
      // 4. users (depende de card_details y business)
      await deleteAllClientsByBusiness(id);
      // 5. card_details (depende de business)
      await deleteAllCardDetailsByBusiness(id);
      // 6. Finalmente eliminar el negocio
      const sql = 'DELETE FROM businesses WHERE id = $1 RETURNING id, name';
      pool.query(sql, [id], (error, results) => {
        if (error) {
          return reject(error);
        }
        if (results.rowCount === 0) {
          return reject(new Error('Negocio no encontrado'));
        }
        resolve({
          success: true,
          message: 'Negocio y todos sus datos relacionados eliminados',
          deletedBusiness: results.rows[0]
        });
      });
    } catch (error) {
      reject(error);
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

async function deleteAllClientsByBusiness(business_id) {
  return new Promise((resolve, reject) => {
    const sql = `
      DELETE FROM users where business_id = $1; 
    `; 
    pool.query(sql, [business_id], (error, results) => {
      if(error) return reject(error); 
      resolve(' Clientes eliminados'); 
    }); 
  }); 
}

// Eliminar un usuario individual con todas sus dependencias
async function deleteOneClientByBusiness(id, business_id) {
  return new Promise(async (resolve, reject) => {
    try {
      // 1. Eliminar user_strips_log del usuario
      await deleteUserStripsLogByUser(id);
      
      // 2. Eliminar apple_wallet_registrations del usuario
      await deleteAppleWalletRegistrationsByUser(id);
      
      // 3. Eliminar push_subscriptions del usuario
      await deletePushSubscriptionsByUser(id);
      
      // 4. Eliminar el usuario
      const sql = `
        DELETE FROM users 
        WHERE id = $1 AND business_id = $2
        RETURNING id, email, name
      `;
      
      pool.query(sql, [id, business_id], (error, results) => {
        if (error) return reject(error);
        
        if (results.rowCount === 0) {
          return reject(new Error('Usuario no encontrado'));
        }
        
        console.log(`Usuario ${id} eliminado del negocio ${business_id}`);
        resolve({
          success: true,
          message: 'Usuario y sus datos relacionados eliminados',
          deletedUser: results.rows[0]
        });
      });
      
    } catch (error) {
      console.error('Error al eliminar usuario:', error);
      reject(error);
    }
  });
}

async function deleteAllCardDetailsByBusiness(business_id) {
  return new Promise((resolve, reject) => {
    const sql = `
      DELETE FROM card_details WHERE business_id = $1
    `; 
    // FIX: Cambié el segundo parámetro de 'reject' a 'results'
    pool.query(sql, [business_id], (error, results) => {
      if(error) return reject(error);
      console.log(`Card details eliminados del negocio ${business_id}: ${results.rowCount}`);
      resolve(results.rowCount); 
    }); 
  });
}

async function deleteAllAppleWalletRegistrationsByBusiness(business_id) {
  return new Promise((resolve, reject) => {
    const sql = `
      DELETE FROM apple_wallet_registrations 
      WHERE user_id IN (
        SELECT id FROM users WHERE business_id = $1
      )
    `; 
    pool.query(sql, [business_id], (error, results) => {
      if(error) return reject(error);
      console.log(`Apple Wallet registrations eliminados del negocio ${business_id}: ${results.rowCount}`);
      resolve(results.rowCount); 
    }); 
  }); 
}

async function deleteAllUserStripsLogByBusiness(business_id) {
  return new Promise((resolve, reject) => {
    const sql = `
      DELETE FROM user_strips_log 
      WHERE user_id IN (
        SELECT id FROM users WHERE business_id = $1
      )
    `; 
    pool.query(sql, [business_id], (error, results) => {
      if(error) return reject(error);
      console.log(`User strips log eliminados del negocio ${business_id}: ${results.rowCount}`);
      resolve(results.rowCount); 
    }); 
  }); 
}

// Elimina todas las push_subscriptions de usuarios de un negocio
async function deleteAllPushSubscriptionsByBusiness(business_id) {
  return new Promise((resolve, reject) => {
    const sql = `
      DELETE FROM push_subscriptions 
      WHERE user_id IN (
        SELECT id FROM users WHERE business_id = $1
      )
    `; 
    pool.query(sql, [business_id], (error, results) => {
      if(error) return reject(error);
      console.log(`Push subscriptions eliminadas del negocio ${business_id}: ${results.rowCount}`);
      resolve(results.rowCount); 
    }); 
  }); 
}


// Eliminar strips log de un usuario específico
async function deleteUserStripsLogByUser(user_id) {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM user_strips_log WHERE user_id = $1';
    pool.query(sql, [user_id], (error, results) => {
      if (error) return reject(error);
      console.log(`  Strips log eliminados del usuario ${user_id}: ${results.rowCount}`);
      resolve(results.rowCount);
    });
  });
}

// Eliminar registros de Apple Wallet de un usuario específico
async function deleteAppleWalletRegistrationsByUser(user_id) {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM apple_wallet_registrations WHERE user_id = $1';
    pool.query(sql, [user_id], (error, results) => {
      if (error) return reject(error);
      console.log(`  Apple Wallet registrations eliminados del usuario ${user_id}: ${results.rowCount}`);
      resolve(results.rowCount);
    });
  });
}

// Eliminar push subscriptions de un usuario específico
async function deletePushSubscriptionsByUser(user_id) {
  return new Promise((resolve, reject) => {
    const sql = 'DELETE FROM push_subscriptions WHERE user_id = $1';
    pool.query(sql, [user_id], (error, results) => {
      if (error) return reject(error);
      console.log(`  Push subscriptions eliminadas del usuario ${user_id}: ${results.rowCount}`);
      resolve(results.rowCount);
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
  updateCurrentDesignById, 
  deleteAllClientsByBusiness, 
  deleteOneClientByBusiness, 
  deleteAllCardDetailsByBusiness,
  deleteAllAppleWalletRegistrationsByBusiness, 
  deleteAllUserStripsLogByBusiness
};