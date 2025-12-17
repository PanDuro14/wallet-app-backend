// db/appleWalletdb.js - VERSIÓN CORREGIDA
const dbConnection = require('./dbConection');
const dbLocal = require('./dbConectionLocal');

let pool;
(async () => {
  try {
    await dbConnection.connect();
    console.log('Conexión con la db remota exitosa: apple Wallet DB');
    pool = dbConnection;
  } catch (errRemota) {
    console.warn('Error con la db remota. Intentando conexión local... ', errRemota.message);
    try {
      await dbLocal.connect();
      console.log('Conexión con la db local exitosa: apple Wallet DB');
      pool = dbLocal;
    } catch (errLocal) {
      console.error('Error al conectar con la db local: ', errLocal.message);
    }
  }
})();

/** Busca un usuario/pase por serial (incluye pass_type_id resuelto) */
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
  return rows[0] || null;
};

/**
 * Inserta/actualiza el registro de PassKit de forma idempotente.
 * UNIQUE esperado en DB: (device_library_id, pass_type_id, serial_number)
 * Devuelve true si YA existía (→ responde 200), false si fue nuevo (→ 201).
 */
const upsertRegistration = async ({ userId, serial, deviceLibraryId, passTypeId, pushToken, env = 'prod' }) => {
  const sql = `
    INSERT INTO public.apple_wallet_registrations
      (user_id, serial_number, device_library_id, pass_type_id, push_token, env, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    ON CONFLICT (device_library_id, pass_type_id, serial_number)
    DO UPDATE SET
      push_token = EXCLUDED.push_token,
      env        = EXCLUDED.env,
      updated_at = NOW()
    RETURNING (xmax = 0) AS inserted;  -- true si INSERT, false si UPDATE
  `;
  const params = [userId, serial, deviceLibraryId, passTypeId, pushToken, env];
  const { rows } = await pool.query(sql, params);
  const inserted = rows?.[0]?.inserted === true;
  // si inserted=true → era nuevo (201). Si false → ya existía (200).
  return !inserted; // true => existed (200), false => nuevo (201)
};

/** Lista de tokens (y env) por serial; puedes filtrar por pass_type si lo necesitas */
const listPushTokensBySerial = async (serial, passTypeId = null) => {
  const base = `
    SELECT push_token, env
    FROM public.apple_wallet_registrations
    WHERE serial_number = $1
  `;
  const sql = passTypeId ? base + ' AND pass_type_id = $2' : base;
  const params = passTypeId ? [serial, passTypeId] : [serial];
  const { rows } = await pool.query(sql, params);
  return rows; // [{ push_token, env }, ...]
};

/** Suma/resta puntos y devuelve nuevo saldo */
async function bumpPointsBySerial(serial, delta) {
  const sql = `
    UPDATE public.users
    SET points = GREATEST(0, points + $2),
        updated_at = NOW() AT TIME ZONE 'UTC'
    WHERE serial_number = $1
    RETURNING points, updated_at AS "updatedAt";
  `;
  const { rows } = await pool.query(sql, [serial, delta]);
  return rows[0] || null;
}

/** 
 *  FIX: Mejorada para manejar timestamps más confiablemente
 * Passes actualizados desde 'since' para un device+passType (para GET /registrations) 
 */
async function listUpdatedSerialsSince({ deviceId, passTypeId, since }) {
  let sinceSec = 0;
  if (since) {
    if (/^\d+$/.test(since)) {
      sinceSec = since.length > 10 ? Math.floor(Number(since) / 1000) : Number(since);
    } else {
      const t = Date.parse(since);
      if (!Number.isNaN(t)) sinceSec = Math.floor(t / 1000);
    }
  }

  const sql = `
    SELECT r.serial_number AS serial, u.updated_at
      FROM public.apple_wallet_registrations r
      JOIN public.users u ON u.serial_number = r.serial_number
     WHERE r.device_library_id = $1
       AND r.pass_type_id      = $2
       AND ($3 = 0 OR EXTRACT(EPOCH FROM u.updated_at)::bigint > $3)
     ORDER BY u.updated_at DESC
  `;
  const { rows } = await pool.query(sql, [deviceId, passTypeId, sinceSec]);
  
  //  FIX: Siempre retornar un lastUpdated válido, incluso si no hay rows
  let lastUpdatedDate;
  if (rows.length > 0 && rows[0].updated_at) {
    lastUpdatedDate = new Date(rows[0].updated_at);
  } else {
    // Si no hay actualizaciones, usar timestamp actual
    lastUpdatedDate = new Date();
  }
  
  return {
    serialNumbers: rows.map(r => r.serial),
    lastUpdated: lastUpdatedDate.toISOString() //  FIX: ISO format es más consistente
  };
}

async function updateRegistrationEnv({ serial, pushToken, env }) {
  const sql = `
    UPDATE public.apple_wallet_registrations
       SET env = $3, updated_at = NOW()
     WHERE serial_number = $1 AND push_token = $2
  `;
  await pool.query(sql, [serial, pushToken, env]);
}

async function grantStripBySerial(serial, stripNumber) {
  await pool.query('BEGIN');
  
  try {
    // 1. Obtener usuario
    const userQuery = `
      SELECT id, strips_collected, strips_required, reward_title, name, card_type
      FROM public.users 
      WHERE serial_number = $1
    `;
    const userResult = await pool.query(userQuery, [serial]);
    const user = userResult.rows[0];
    
    if (!user) {
      await pool.query('ROLLBACK');
      return { success: false, error: 'Usuario no encontrado' };
    }

    if (user.card_type !== 'strips') {
      await pool.query('ROLLBACK');
      return { success: false, error: 'Esta tarjeta no es de tipo strips' };
    }

    // 2. Verificar si ya tiene este strip
    const existingQuery = 'SELECT id FROM user_strips_log WHERE user_id = $1 AND strip_number = $2';
    const existing = await pool.query(existingQuery, [user.id, stripNumber]);
    
    if (existing.rows.length > 0) {
      await pool.query('ROLLBACK');
      return { 
        success: false, 
        error: 'Strip ya obtenido',
        current: {
          strips_collected: user.strips_collected,
          strips_required: user.strips_required || 10
        }
      };
    }

    // 3. Verificar si ya completó
    if (user.strips_collected >= (user.strips_required || 10)) {
      await pool.query('ROLLBACK');
      return {
        success: false,
        error: 'Colección ya completada',
        current: {
          strips_collected: user.strips_collected,
          strips_required: user.strips_required || 10
        }
      };
    }

    // 4. Registrar el nuevo strip
    await pool.query(
      'INSERT INTO user_strips_log (user_id, strip_number) VALUES ($1, $2)',
      [user.id, stripNumber]
    );

    // 5. Actualizar contador
    const updateQuery = `
      UPDATE users 
      SET strips_collected = strips_collected + 1,
          reward_unlocked = CASE 
            WHEN strips_collected + 1 >= COALESCE(strips_required, 10) THEN true 
            ELSE reward_unlocked 
          END,
          updated_at = NOW() AT TIME ZONE 'UTC'
      WHERE id = $1 
      RETURNING strips_collected, strips_required, reward_unlocked, reward_title, name, updated_at
    `;
    
    const updatedResult = await pool.query(updateQuery, [user.id]);
    const updated = updatedResult.rows[0];

    await pool.query('COMMIT');
    
    const isComplete = updated.reward_unlocked;
    const justCompleted = isComplete && (updated.strips_collected === (updated.strips_required || 10));

    return {
      success: true,
      data: {
        strips_collected: updated.strips_collected,
        strips_required: updated.strips_required || 10,
        strip_number: stripNumber,
        isComplete,
        justCompleted,
        reward_title: updated.reward_title,
        userName: updated.name,
        updatedAt: updated.updated_at
      }
    };

  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

/** Obtener strips de un usuario */
async function getUserStrips(userId) {
  const sql = `
    SELECT strip_number, collected_at
    FROM user_strips_log
    WHERE user_id = $1
    ORDER BY strip_number
  `;
  const { rows } = await pool.query(sql, [userId]);
  return rows;
}

/** Función auxiliar para eliminar registraciones (reutilizada de tu lógica) */
async function deleteRegistration({ deviceId, passTypeId, serial, pushToken }) {
  let sql, params;
  
  if (pushToken) {
    // Eliminar por token específico
    sql = `
      DELETE FROM public.apple_wallet_registrations
      WHERE pass_type_id = $1 AND serial_number = $2 AND push_token = $3
    `;
    params = [passTypeId, serial, pushToken];
  } else if (deviceId) {
    // Eliminar por device + serial
    sql = `
      DELETE FROM public.apple_wallet_registrations
      WHERE device_library_id = $1 AND pass_type_id = $2 AND serial_number = $3
    `;
    params = [deviceId, passTypeId, serial];
  } else {
    throw new Error('deleteRegistration: deviceId o pushToken requerido');
  }
  
  const { rowCount } = await pool.query(sql, params);
  return rowCount > 0;
}

// Resetear strips a 0
async function resetStripsBySerial(serial) {
  await pool.query('BEGIN');
  
  try {
    // 1. Obtener el user_id
    const userQuery = 'SELECT id FROM users WHERE serial_number = $1';
    const userResult = await pool.query(userQuery, [serial]);
    const userId = userResult.rows[0]?.id;
    
    if (!userId) {
      await pool.query('ROLLBACK');
      return null;
    }

    // 2. Borrar los strips individuales del log
    await pool.query('DELETE FROM user_strips_log WHERE user_id = $1', [userId]);

    // 3. Resetear contador en users
    const updateQuery = `
      UPDATE users
      SET 
        strips_collected = 0,
        reward_unlocked = false,
        updated_at = NOW()
      WHERE serial_number = $1
      RETURNING 
        id, 
        serial_number, 
        strips_collected, 
        strips_required, 
        reward_title,
        updated_at
    `;
    
    const result = await pool.query(updateQuery, [serial]);
    
    await pool.query('COMMIT');
    return result.rows[0] || null;
    
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
}

// Guardar historial de colecciones completadas
async function saveStripCompletionHistory(data) {
  const query = `
    INSERT INTO strip_completion_history 
    (user_id, serial, strips_collected, strips_required, reward_title, completed_at, redeemed, redeemed_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
  `;
  
  const values = [
    data.userId,
    data.serial,
    data.strips_collected,
    data.strips_required,
    data.reward_title,
    data.completed_at,
    data.redeemed,
    data.redeemed_at
  ];
  
  const result = await pool.query(query, values);
  return result.rows[0];
}

// Obtener historial de un usuario
async function getStripCompletionHistory(serial) {
  const query = `
    SELECT 
      h.*,
      u.name as user_name
    FROM strip_completion_history h
    LEFT JOIN users u ON u.serial_number = h.serial
    WHERE h.serial = $1
    ORDER BY h.completed_at DESC
  `;
  
  const result = await pool.query(query, [serial]);
  return result.rows;
}

// Contar ciclos completados
async function countCompletedCycles(serial) {
  const query = `
    SELECT COUNT(*) as total_cycles
    FROM strip_completion_history
    WHERE serial = $1
  `;
  
  const result = await pool.query(query, [serial]);
  return parseInt(result.rows[0]?.total_cycles || 0);
}

module.exports = {
  findUserPassBySerial,
  upsertRegistration,
  listPushTokensBySerial,
  bumpPointsBySerial,
  listUpdatedSerialsSince, 
  updateRegistrationEnv, 
  grantStripBySerial,
  getUserStrips,
  deleteRegistration, 
  resetStripsBySerial,
  saveStripCompletionHistory,
  getStripCompletionHistory,
  countCompletedCycles
};