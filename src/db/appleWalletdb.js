const dbConnection = require('./dbConection'); 
const dbLocal = require('./dbConectionLocal'); 

let pool; 

(async () => {
  try {
    await dbConnection.connect(); 
    console.log('Conexión con la db remota exitosa: apple Wallet DB'); 
    pool = dbConnection; 
  } catch (errRemota){
    console.warn('Error con la db remota. Intentando conexión local... ', errRemota.message); 

    try {
      await dbLocal.connect(); 
      console.log('Conexión con la db local exitosa: apple Wallet DB'); 
      pool = dbLocal; 
    } catch (errLocal){
      console.error('Error al conectar con la db local: ', errLocal.message); 
    }
  }
})(); 

// Buscar un usuario/pase por serial (incluyendo pass_type_id del negocio )
const findUserPassBySerial = async (serial) => {
  const sql = `
    SELECT
      u.*,
      COALESCE(u.apple_pass_type_id, cd.pass_type_id) AS pass_type_id,
      b.name AS business_name
    FROM public.users u
    LEFT JOIN public.card_details cd ON cd.id = u.card_detail_id
    LEFT JOIN public.businesses b ON b.id = u.business_id
    WHERE u.serial_number = $1
    LIMIT 1
  `;
  const { rows } = await pool.query(sql, [serial]);
  return rows[0] || null;  // ← nada de reject; que el controller haga 404
};


// guardar/actualizar push token por device 
const upsertRegistration = async ({ userId, serial, deviceLibraryId, pushToken}) => {
    return new Promise((resolve, reject) => {
        const sql = `
            INSERT INTO public.apple_wallet_registrations (user_id, serial_number, device_library_id, push_token)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, device_library_id)
            DO UPDATE SET push_token = EXCLUDED.push_token, updated_at = CURRENT_TIMESTAMP
        `; 
        pool.query(sql, [userId, serial, deviceLibraryId, pushToken], (error, results) => {
            if(error) return reject(error); 
            resolve(`Pass del user: ${userId} y serial: ${serial} ha sido actualizada exitosamente`); 
        }); 
    }); 
}


// lista de tokens por serial 
const listPushTokensBySerial = async (serial) => {
    return new Promise((resolve, reject) => {
        const sql = `
            SELECT push_token FROM public.apple_wallet_registrations
            WHERE serial_number = $1
        `; 
        pool.query(sql, [serial], (error, results) => {
            if(error) return reject(error); 
            resolve(results.rows.map(r => r.push_token)); 
        }); 
    }); 
}

// suma/resta puntos y devuelve el nuevo saldo 
const bumpPointsBySerial = async(serial, delta) => {
    return new Promise((resolve, reject) => {
        const sql = `
            UPDATE public.users
            SET points = COALESCE(points,0) + $2, updated_at = CURRENT_TIMESTAMP
            WHERE serial_number = $1
            RETURNING points
        `; 
        pool.query(sql, [serial, Number(delta || 0)], (error, results) => {
            if(error) return reject(error); 
            resolve(results.rows[0]?.points ?? null); 
        }); 
    });
}

module.exports = {
    findUserPassBySerial, 
    upsertRegistration, 
    listPushTokensBySerial, 
    bumpPointsBySerial
}