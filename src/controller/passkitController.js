// controllers/passkitController.js
const {
  findUserPassBySerial,
  upsertRegistration,
  bumpPointsBySerial,
  listPushTokensBySerial, 
  listUpdatedSerialsSince,  
  deleteRegistration 
} = require('../db/appleWalletdb');
const { loadBrandAssets } = require('../processes/walletProcess');
const { notifyWallet } = require('../services/apnsService');
const { createPkPassBuffer } = require('../services/appleWalletService');
const cardSvc = require('../services/carddetailService');
const cleanUuid = (v='') => decodeURIComponent(v).trim();

function authOk(req, row) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^ApplePass\s+/i, '');
  return token && row?.apple_auth_token === token;
}

// GET /v1/devices/:deviceId/registrations/:passTypeId
// ?passesUpdatedSince=timestamp (RFC 1123 o epoch ms; acepta vacío)
const listRegistrations = async (req, res) => {
  try {
    const { deviceId, passTypeId } = req.params;
    const since = req.query.passesUpdatedSince || null;

    // Valida que sea tu typeId real
    if (passTypeId !== process.env.PASS_TYPE_IDENTIFIER) return res.sendStatus(404);

    // Devuelve { serialNumbers:[...], lastUpdated: "<timestamp>" }
    const { serialNumbers, lastUpdated } = await listUpdatedSerialsSince({ deviceId, passTypeId, since });
    return res.json({ serialNumbers, lastUpdated });
  } catch (e) {
    console.error('listRegistrations error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};

// DELETE /v1/devices/:deviceId/registrations/:passTypeId/:serial
const deregisterDevice = async (req, res) => {
  try {
    const { deviceId, passTypeId } = req.params;
    const serial = cleanUuid(req.params.serial);
    if (passTypeId !== process.env.PASS_TYPE_IDENTIFIER) return res.sendStatus(404);

    const row = await findUserPassBySerial(serial);
    if (!row) return res.sendStatus(404);
    if (!authOk(req, row)) return res.sendStatus(401);

    await deleteRegistration({ deviceId, passTypeId, serial });
    return res.sendStatus(200);
  } catch (e) {
    console.error('deregisterDevice error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};

// POST /v1/log
const acceptLogs = async (req, res) => {
  try {
    // opcional: guarda req.body en logs
    console.log('[PassKit logs]', JSON.stringify(req.body));
    return res.sendStatus(200);
  } catch {
    return res.sendStatus(200);
  }
};

// GET /v1/passes/:passTypeId/:serial
const getPass = async (req, res) => {
  try {
    const passTypeId = req.params.passTypeId;
    const serial = cleanUuid(req.params.serial);

    const row = await findUserPassBySerial(serial);
    if (!row) return res.sendStatus(404);

    const inHeader = req.headers.authorization || '';
    const inToken  = inHeader.replace(/^ApplePass\s+/i, '');
    console.log('[getPass]', {
      passTypeId,
      userPassType: row.apple_pass_type_id || row.pass_type_id,
      hasAuth: !!inHeader,
      token_match: inToken === row.apple_auth_token,
    });

    const EXPECTED = process.env.PASS_TYPE_IDENTIFIER;
    const userPassType = row.apple_pass_type_id || row.pass_type_id;
    // Acepta si coincide con el typeId oficial o con el guardado en el usuario
    if (passTypeId !== EXPECTED && passTypeId !== userPassType) {
      return res.sendStatus(404);
    }

    const ENFORCE = process.env.PASS_ENFORCE_AUTH === 'true'; // en dev pon false
    if (ENFORCE && !authOk(req, row)) {
      return res.sendStatus(401);
    } else {
      if (passTypeId !== userPassType) return res.sendStatus(401);
    }

    // 304 si el cliente ya tiene la última versión
    const ims = req.headers['if-modified-since'];
    if (ims && row.updated_at) {
      const clientTs = new Date(ims).getTime();
      const serverTs = new Date(row.updated_at).getTime();
      if (!Number.isNaN(clientTs) && !Number.isNaN(serverTs) && clientTs >= serverTs) {
        return res.status(304).send();
      }
    }

    // Cargar assets (buffers) y colores desde tu helper
    const { logoBuffer, stripBuffer, bg, fg } = await loadBrandAssets(row.business_id);

    // Construir el pase
    const buffer = await createPkPassBuffer({
      cardCode: row.serial_number,
      userName: row.name || '',
      programName: row.business_name || 'Loyalty',
      colors: { background: bg || '#2d3436', foreground: fg || '#E6E6E6' },
      assets: { logo: logoBuffer || null, strip: stripBuffer || null },
      points: row.points ?? 0,
      fields: {
        primary:   [{ key: 'points', label: 'POINTS', value: String(row.points ?? 0) }],
        secondary: [{ key: 'member', label: 'MEMBER', value: row.name || '' }],
        back:      [{ key: 'memberId', label: 'Member ID', value: row.loyalty_account_id || String(row.id) }]
      },
      appleAuthToken: row.apple_auth_token,
      // authToken: row.apple_auth_token, // opcional si tu createPkPassBuffer lo soporta
    });

    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${serial}.pkpass"`,
      'Last-Modified': new Date(row.updated_at || Date.now()).toUTCString()
    });
    return res.send(buffer);
  } catch (err) {
    console.error('getPass error:', err);
    return res.status(500).send('PKPass build/sign error');
  }
};


// POST /v1/devices/:deviceId/registrations/:passTypeId/:serial
// Body: { "pushToken": "xxxxx" }
const registerDevice = async (req, res) => {
  try {
    const deviceId = req.params.deviceId;
    const passTypeId = req.params.passTypeId;
    const serial = cleanUuid(req.params.serial);
    const { pushToken } = req.body || {};
    if (!pushToken) return res.status(400).json({ error: 'pushToken required' });
    if (!isUuid(serial)) return res.status(400).send('invalid serial');

    const row = await findUserPassBySerial(serial);
    if (!row) return res.sendStatus(404);

    const EXPECTED = process.env.PASS_TYPE_IDENTIFIER;
    const userPassType = row.apple_pass_type_id || row.pass_type_id;
    const passTypeOk = (passTypeId === EXPECTED) || (passTypeId === userPassType);
    if (!passTypeOk) return res.sendStatus(401);

    const ENFORCE = process.env.PASS_ENFORCE_AUTH === 'true';
    if (ENFORCE && !authOk(req, row)) return res.sendStatus(401);

    await upsertRegistration({
      userId: row.id,
      serial: row.serial_number,
      deviceLibraryId: deviceId,
      pushToken
    });
    return res.sendStatus(201);
  } catch (err) {
    console.error('registerDevice error:', err);
    return res.status(500).send('Server error');
  }
};

// POST /internal/passes/:serial/points  { "delta": 50 }
const bumpPoints = async (req, res) => {
  try {
    const serial = cleanUuid(req.params.serial);
    const { delta } = req.body || {};
    if (!isUuid(serial)) return res.status(400).send('invalid serial');

    const row = await findUserPassBySerial(serial);
    if (!row) return res.sendStatus(404);

    const points = await bumpPointsBySerial(serial, delta);

    let notified = 0;
    if (process.env.APNS_ENABLED === 'true') {
      const tokens = await listPushTokensBySerial(serial);
      const results = await Promise.allSettled(tokens.map(t => notifyWallet(t)));
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value === 200) notified++;
      }
    }
    return res.json({ ok: true, points, notified });
  } catch (err) {
    console.error('bumpPoints error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

module.exports = {
  getPass,
  registerDevice,
  bumpPoints, 
  listRegistrations, 
  deregisterDevice, 
  acceptLogs
};
