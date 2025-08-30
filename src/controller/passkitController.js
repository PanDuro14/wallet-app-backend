// controllers/passkitController.js
const {
  findUserPassBySerial,
  upsertRegistration,
  bumpPointsBySerial,
  listPushTokensBySerial, 
  listUpdatedSerialsSince,  
  deleteRegistration,  

} = require('../db/appleWalletdb');
const { loadBrandAssets } = require('../processes/walletProcess');
const { notifyWallet } = require('../services/apnsService');
const { createPkPassBuffer } = require('../services/appleWalletService');
const cardSvc = require('../services/carddetailService');
const { resolveDesignForUser } = require('../utils/design');

const cleanUuid = (v='') => decodeURIComponent(v).trim();
const isUuid = (v='') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

function authOk(req, row) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^ApplePass\s+/i, '');
  return token && row?.apple_auth_token === token;
}

// GET /v1/devices/:deviceId/registrations/:passTypeId
// ?passesUpdatedSince=timestamp (RFC 1123 o epoch ms; acepta vacío)
// controllers/passkitController.js
const listRegistrations = async (req, res) => {
  try {
    const { deviceId, passTypeId } = req.params;
    const since = req.query.passesUpdatedSince || null;

    if (passTypeId !== process.env.PASS_TYPE_IDENTIFIER) {
      return res.sendStatus(404);
    }

    console.log('[listRegistrations] req', { deviceId, since });
    const { serialNumbers, lastUpdated } =
      await listUpdatedSerialsSince({ deviceId, passTypeId, since });
    console.log('[listRegistrations] res', { serialNumbers, lastUpdated });

    return res.json({ serialNumbers, lastUpdated });
  } catch (e) {
    console.error('listRegistrations error:', e);
    // ⚠️ No le respondas 500 a Apple/Wallet
    return res.status(200).json({
      serialNumbers: [],
      lastUpdated: new Date().toUTCString()
    });
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
// controllers/passkitController.js
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
    if (passTypeId !== EXPECTED && passTypeId !== userPassType) return res.sendStatus(404);

    const ENFORCE = process.env.PASS_ENFORCE_AUTH === 'true';
    if (ENFORCE && !authOk(req, row)) return res.sendStatus(401);

    // ===== If-Modified-Since =====
    const imsHeader = req.headers['if-modified-since'] || null;
    const clientSec = imsHeader ? Math.floor(new Date(imsHeader).getTime() / 1000) : null;
    const serverSec = row.updated_at ? Math.floor(new Date(row.updated_at).getTime() / 1000) : null;
    if (clientSec !== null && serverSec !== null && clientSec >= serverSec) {
      return res.status(304).end();
    }
    // =============================

    // ====== Resolver diseño unificado ======
    let resolved = null;
    try {
      const designRow = await cardSvc.getOneCardDetails(row.card_detail_id); // debe traer design_json
      if (designRow && designRow.design_json) {
        resolved = resolveDesignForUser(designRow.design_json, {
          cardCode: row.serial_number,
          userName: row.name || '',
          programName: row.business_name || 'Loyalty',
          points: row.points ?? 0
        });
      }
    } catch (e) {
      console.log('[getPass] design_json load/resolve warn:', e?.message);
    }

    // Assets por negocio (buffers)
    const { logoBuffer, stripBuffer, bg, fg } = await loadBrandAssets(row.business_id);

    const dj  = resolved?.design || {};
    const ctx = resolved?.ctx || {
      cardCode: row.serial_number,
      userName: row.name || '',
      programName: row.business_name || 'Loyalty',
      points: row.points ?? 0
    };

    // Colores finales
    const colors = {
      background: dj.colors?.background || bg || '#2d3436',
      foreground: dj.colors?.foreground || fg || '#E6E6E6',
      label:      dj.colors?.label      || '#FFFFFF'
    };

    // ===== Mostrar LOGO pero NO STRIP =====
    // Flags (por defecto: mostrar ambos; si disableStrip=true, ocultamos strip)
    const wantLogo  = dj.assets?.disableLogo  === true ? false : true;  // default: true
    const wantStrip = dj.assets?.disableStrip === true ? false : false;  // default: true

    const assets = {
      logo:  wantLogo  ? (logoBuffer  || null) : null,
      strip: wantStrip ? (stripBuffer || null) : null
      // si algún día usas URLs en dj.assets, aquí conviértelas a buffer antes
    };

    // Fields: del diseño o fallback
    let fields = dj.fields || {
      primary:   [{ key: 'points', label: 'POINTS', value: String(ctx.points ?? 0) }],
      secondary: [{ key: 'member', label: 'MEMBER', value: ctx.userName || '' }],
      back:      [{ key: 'memberId', label: 'Member ID', value: row.loyalty_account_id || String(row.id) }]
    };

    // Ocultar “cuenta” / memberId si lo pides
    if (dj.hideAccount) {
      const safe = (arr) => Array.isArray(arr) ? arr : [];
      // Quitamos 'member' de la lista de claves prohibidas para no esconder el nombre
      const BAN_KEYS   = ['account', 'memberid', 'cuenta', 'code']; 
      const BAN_LABELS = ['cuenta', 'account', 'member id', 'account id', 'id'];

      const drop = (arr = []) => safe(arr).filter(f => {
        const k = String(f?.key   || '').toLowerCase();
        const l = String(f?.label || '').toLowerCase();
        return !BAN_KEYS.includes(k) && !BAN_LABELS.includes(l);
      });

      fields = {
        primary:   drop(fields?.primary),
        secondary: drop(fields?.secondary),
        back:      drop(fields?.back),
      };

      // Garantiza que al menos quede el nombre o los puntos
      if (!fields.primary.length && !fields.secondary.length) {
        fields.primary = [{ key: 'points', label: 'PUNTOS', value: String(ctx.points ?? 0) }];
      }
    }

    // Barcode(s): primary + additional (default QR si no viene nada)
    const bc = dj.barcode || {};
    const formats = [bc.primary, ...(bc.additional || [])].filter(Boolean);

    const buffer = await createPkPassBuffer({
      cardCode: ctx.cardCode,
      userName: ctx.userName,
      programName: ctx.programName,
      points: ctx.points,
      colors,
      fields,
      barcode: {
        message: bc.message || ctx.cardCode,
        altText: bc.altText || ctx.cardCode,
        encoding: bc.encoding || 'iso-8859-1',
        formats: formats.length ? formats : ['qr']
      },
      assets,
      appleAuthToken: row.apple_auth_token,
    });

    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${serial}.pkpass"`,
      'Last-Modified': new Date(row.updated_at || Date.now()).toUTCString(),
      'Cache-Control': 'no-store'
    });
    return res.status(200).send(buffer);

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

    console.log('[registerDevice] originalUrl:', req.originalUrl);
    console.log('[registerDevice] params:', req.params);

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
      passTypeId,
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
    const raw = req.body?.delta;
    const delta = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);

    if (!isUuid(serial)) return res.status(400).send('invalid serial');
    if (!Number.isFinite(delta)) return res.status(400).json({ error: 'invalid delta' });

    const row = await findUserPassBySerial(serial);
    if (!row) return res.sendStatus(404);

    console.log('[bumpPoints] start', { serial, delta, before: row.points });

    // 1) ACTUALIZA DB Y TOMA NUEVOS VALORES
    const upd = await bumpPointsBySerial(serial, delta);
    if (!upd) return res.sendStatus(404);
    console.log('[bumpPoints] DB returned', upd);  // debe imprimir { points: N, updatedAt: '...' }

    const { points: newPoints, updatedAt } = upd;
    console.log('[bumpPoints] updated', { newPoints, updatedAt });


    // 2) ENVÍA PUSH
    let notified = 0;
    if (process.env.APNS_ENABLED === 'true') {
      const tokens = await listPushTokensBySerial(serial);
      console.log('[bumpPoints] pushTokens', tokens.length);

      const results = await Promise.allSettled(
        tokens.map(t => notifyWallet(t.push_token || t))
      );

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const token = tokens[i].push_token || tokens[i];
        if (r.status === 'fulfilled') {
          const code = r.value; // 200 OK, 410 Gone, etc.
          console.log('[bumpPoints] apns result', { token: token?.slice?.(0,8), code });
          if (code === 200) notified++;
          if (code === 410) {
            try {
              await deleteRegistration({
                passTypeId: process.env.PASS_TYPE_IDENTIFIER,
                serial,
                pushToken: token
              });
            } catch {}
          }
        } else {
          console.log('[bumpPoints] apns error', r.reason);
        }
      }
    }

    return res.json({ ok: true, points: newPoints, notified });
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
