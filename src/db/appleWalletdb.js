// db/appleWalletdb.js
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

/** Passes actualizados desde 'since' para un device+passType (para GET /registrations) */
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
  const last = rows[0]?.updated_at || new Date();
  return {
    serialNumbers: rows.map(r => r.serial),
    lastUpdated: new Date(last).toUTCString()
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

module.exports = {
  findUserPassBySerial,
  upsertRegistration,
  listPushTokensBySerial,
  bumpPointsBySerial,
  listUpdatedSerialsSince, 
  updateRegistrationEnv
};
