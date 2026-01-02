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

async function grantStripBySerial(serial, stripNumber, extraUpdates = {}) {
  await pool.query('BEGIN');
  
  try {
    // 1. Obtener usuario
    const userQuery = `
      SELECT id, strips_collected, strips_required, reward_title, reward_unlocked, 
             name, card_type, card_detail_id
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

    // 3. Verificar si ya completó (último tier)
    if (user.reward_unlocked) {
      await pool.query('ROLLBACK');
      return {
        success: false,
        error: 'Colección ya completada',
        current: {
          strips_collected: user.strips_collected,
          strips_required: user.strips_required || 10,
          reward_unlocked: true
        }
      };
    }

    // 4. Registrar el nuevo strip
    await pool.query(
      'INSERT INTO user_strips_log (user_id, strip_number) VALUES ($1, $2)',
      [user.id, stripNumber]
    );

    // 5. Preparar actualización (con soporte para extraUpdates)
    const newStripsCollected = user.strips_collected + 1;
    
    // Valores por defecto
    let updates = {
      strips_collected: newStripsCollected,
      updated_at: new Date()
    };

    // Merge con extraUpdates (permite cambiar strips_required, reward_title, etc.)
    if (Object.keys(extraUpdates).length > 0) {
      console.log('[grantStripBySerial] Aplicando actualizaciones extras:', extraUpdates);
      updates = { ...updates, ...extraUpdates };
    }

    // Construir query dinámica
    const keys = Object.keys(updates);
    const setClause = keys.map((k, i) => {
      if (k === 'updated_at') return `${k} = NOW() AT TIME ZONE 'UTC'`;
      return `${k} = $${i + 2}`;
    }).join(', ');
    
    const values = keys
      .filter(k => k !== 'updated_at')
      .map(k => updates[k]);

    const updateQuery = `
      UPDATE users 
      SET ${setClause}
      WHERE id = $1 
      RETURNING strips_collected, strips_required, reward_unlocked, 
                reward_title, reward_description, name, updated_at
    `;
    
    const updatedResult = await pool.query(updateQuery, [user.id, ...values]);
    const updated = updatedResult.rows[0];

    await pool.query('COMMIT');
    
    const isComplete = updated.reward_unlocked || false;
    const justCompleted = isComplete && 
                          (updated.strips_collected === (updated.strips_required || 10));

    return {
      success: true,
      data: {
        strips_collected: updated.strips_collected,
        strips_required: updated.strips_required || 10,
        strip_number: stripNumber,
        isComplete,
        justCompleted,
        reward_title: updated.reward_title,
        reward_description: updated.reward_description,
        reward_unlocked: updated.reward_unlocked,
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
const resetStripsBySerial = async (serial, options = {}) => {
  try {
    // Valores por defecto o desde options
    const strips_required = options.strips_required || null;
    const reward_title = options.reward_title || null;
    const reward_description = options.reward_description || null;

    let query = `
      UPDATE users
      SET strips_collected = 0,
          reward_unlocked = FALSE,
          updated_at = NOW()`;

    const params = [serial];
    let paramIndex = 2;

    // Agregar campos opcionales si se proveen
    if (strips_required !== null) {
      query += `, strips_required = $${paramIndex}`;
      params.push(strips_required);
      paramIndex++;
    }

    if (reward_title !== null) {
      query += `, reward_title = $${paramIndex}`;
      params.push(reward_title);
      paramIndex++;
    }

    if (reward_description !== null) {
      query += `, reward_description = $${paramIndex}`;
      params.push(reward_description);
      paramIndex++;
    }

    query += `
      WHERE serial_number = $1
      RETURNING strips_collected, strips_required, reward_title, reward_unlocked
    `;

    console.log('[resetStripsBySerial] Query:', query);
    console.log('[resetStripsBySerial] Params:', params);

    const { rows } = await pool.query(query, params);

    if (rows.length === 0) {
      console.error('[resetStripsBySerial] Usuario no encontrado');
      return null;
    }

    console.log('[resetStripsBySerial] Reset exitoso:', rows[0]);
    return rows[0];

  } catch (error) {
    console.error('[resetStripsBySerial] Error:', error);
    throw error;
  }
};

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

async function clearUserStripsLog(userId) {
  const sql = 'DELETE FROM user_strips_log WHERE user_id = $1';
  const result = await pool.query(sql, [userId]);
  console.log(`[clearUserStripsLog] Eliminados ${result.rowCount} strips del usuario ${userId}`);
  return result.rowCount;
}

async function forceUpdateAllStripsPasses() {
  console.log('\n INICIANDO ACTUALIZACIÓN MASIVA DE PASSES\n');
  console.log('═══════════════════════════════════════════\n');
  
  try {
    // 1. Obtener todos los passes de strips con tokens
    const query = `
      SELECT DISTINCT 
        u.serial_number,
        u.name,
        u.strips_collected,
        u.strips_required,
        r.push_token,
        r.env
      FROM users u
      JOIN apple_wallet_registrations r ON r.serial_number = u.serial_number
      WHERE u.card_type = 'strips'
      ORDER BY u.name
    `;
    
    const { rows } = await pool.query(query);
    
    if (rows.length === 0) {
      console.log(' No se encontraron passes de strips registrados');
      return { success: false, message: 'No hay passes para actualizar' };
    }
    
    console.log(` Total de dispositivos a notificar: ${rows.length}\n`);
    
    // 2. Importar servicio APNs
    const { notifyWallet } = require('../services/apnsService');
    
    // 3. Agrupar por serial
    const passesBySerial = {};
    
    rows.forEach(row => {
      if (!passesBySerial[row.serial_number]) {
        passesBySerial[row.serial_number] = {
          name: row.name,
          strips: `${row.strips_collected}/${row.strips_required}`,
          tokens: []
        };
      }
      passesBySerial[row.serial_number].tokens.push({
        push_token: row.push_token,
        env: row.env
      });
    });
    
    const totalPasses = Object.keys(passesBySerial).length;
    let successCount = 0;
    let failCount = 0;
    let current = 0;
    
    console.log(`Total de passes únicos: ${totalPasses}\n`);
    console.log('Enviando notificaciones APNs...\n');
    
    // 4. Enviar APNs a cada pass
    for (const [serial, data] of Object.entries(passesBySerial)) {
      current++;
      const progress = Math.round((current / totalPasses) * 100);
      
      process.stdout.write(`[${progress}%] ${current}/${totalPasses} - ${data.name} (${data.strips})...`);
      
      let passSuccess = false;
      
      for (const token of data.tokens) {
        try {
          const result = await notifyWallet(token.push_token, token.env, { serial });
          
          if (result.status === 200) {
            passSuccess = true;
          } else if (result.status === 410) {
            // Token expirado, eliminar
            try {
              await pool.query(
                'DELETE FROM apple_wallet_registrations WHERE push_token = $1',
                [token.push_token]
              );
            } catch (e) {
              // Ignorar
            }
          }
        } catch (error) {
          // Continuar con siguiente token
        }
        
        // Delay entre notificaciones
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      if (passSuccess) {
        successCount++;
        console.log(':D');
      } else {
        failCount++;
        console.log('D:');
      }
    }
    
    // 5. Actualizar timestamps en DB
    console.log('\nActualizando timestamps en base de datos...');
    
    const updateResult = await pool.query(`
      UPDATE users 
      SET updated_at = NOW()
      WHERE card_type = 'strips'
      RETURNING id
    `);
    
    console.log(`${updateResult.rowCount} registros actualizados\n`);
    
    if (successCount > 0) {
      console.log('Los passes deberían actualizarse en los próximos minutos');
      console.log('Los usuarios pueden abrir Apple Wallet para ver los cambios\n');
    }
    
    if (failCount > 0) {
      console.log('Algunos passes no pudieron ser notificados por APNs');
      console.log('Se actualizarán automáticamente en las próximas 24 horas\n');
    }
    
    return {
      success: true,
      total: totalPasses,
      successful: successCount,
      failed: failCount,
      devices: rows.length
    };
    
  } catch (error) {
    console.error('\nERROR:', error.message);
    console.error(error.stack);
    return { success: false, error: error.message };
  }
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
  countCompletedCycles, 
  clearUserStripsLog, 
  forceUpdateAllStripsPasses

};