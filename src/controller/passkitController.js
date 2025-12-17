// controllers/passkitController.js
const {
  findUserPassBySerial,
  upsertRegistration,
  bumpPointsBySerial,
  listPushTokensBySerial, 
  listUpdatedSerialsSince,  
  deleteRegistration,  
  grantStripBySerial, 
  resetStripsBySerial, 
  saveStripCompletionHistory     
} = require('../db/appleWalletdb');
const { loadBrandAssets } = require('../processes/walletProcess');
const { notifyWallet } = require('../services/apnsService');
const { createPkPassBuffer } = require('../services/appleWalletService');
const cardSvc = require('../services/carddetailService');
const { resolveDesignForUser } = require('../utils/design');
const notificationService = require('../services/notificationService');
const stripsProcess = require('../processes/stripsProcess');
const crypto = require('crypto'); 

// ========== IMPORTACIÓN DEL SERVICIO DE STRIPS ==========
const { generateStripsImage } = require('../services/stripsImageService');

const cleanUuid = (v='') => decodeURIComponent(v).trim();
const isUuid = (v='') =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

function authOk(req, row) {
  const header = req.headers.authorization || '';
  const token = header.replace(/^ApplePass\s+/i, '');
  return token && row?.apple_auth_token === token;
}

// GET /v1/devices/:deviceId/registrations/:passTypeId
const listRegistrations = async (req, res) => {
  try {
    const { deviceId, passTypeId } = req.params;
    const since = req.query.passesUpdatedSince || null;

    if (passTypeId !== process.env.PASS_TYPE_IDENTIFIER) {
      return res.sendStatus(404);
    }

    console.log('[listRegistrations] Request:', { deviceId, since });
    
    const { serialNumbers, lastUpdated } =
      await listUpdatedSerialsSince({ deviceId, passTypeId, since });
    
    //  FIX: Siempre retornar timestamp válido en formato correcto
    const finalLastUpdated = lastUpdated || new Date().toISOString();
    
    console.log('[listRegistrations] Response:', { 
      count: serialNumbers.length,
      lastUpdated: finalLastUpdated 
    });

    return res.json({ 
      serialNumbers, 
      lastUpdated: finalLastUpdated
    });
    
  } catch (e) {
    console.error('[listRegistrations] Error:', e.message);
    //  FIX: En error, retornar estructura válida
    return res.status(200).json({
      serialNumbers: [],
      lastUpdated: new Date().toISOString()
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
    //console.error('deregisterDevice error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
};

// POST /v1/log
const acceptLogs = async (req, res) => {
  try {
    //console.log('[PassKit logs]', JSON.stringify(req.body));
    return res.sendStatus(200);
  } catch {
    return res.sendStatus(200);
  }
};

// POST /v1/devices/:deviceId/registrations/:passTypeId/:serial
const registerDevice = async (req, res) => {
  try {
    const env        = process.env.APNS_SANDBOX === 'true' ? 'sandbox' : 'prod';
    const deviceId   = req.params.deviceId;
    const passTypeId = req.params.passTypeId;
    const serial     = cleanUuid(req.params.serial);
    const { pushToken } = req.body || {};

    if (!pushToken)        return res.status(400).json({ error: 'pushToken required' });
    if (!isUuid(serial))   return res.status(400).send('invalid serial');

    //console.log('[registerDevice][in]', {
    //  url: req.originalUrl,
    //  deviceId, passTypeId, serial,
    //  ct: req.get('Content-Type'),
    //  hasBody: !!req.body,
    //  pushLen: (pushToken || '').length,
    //  ua: req.get('User-Agent')
    //});

    const row = await findUserPassBySerial(serial);
    if (!row) return res.sendStatus(404);

    const EXPECTED     = process.env.PASS_TYPE_IDENTIFIER;
    const userPassType = row.apple_pass_type_id || row.pass_type_id;
    const passTypeOk   = (passTypeId === EXPECTED) || (passTypeId === userPassType);
    if (!passTypeOk) return res.sendStatus(404);

    const ENFORCE = process.env.PASS_ENFORCE_AUTH === 'true';
    if (ENFORCE && !authOk(req, row)) return res.sendStatus(401);

    const existed = await upsertRegistration({
      userId: row.id,
      serial: row.serial_number,
      deviceLibraryId: deviceId,
      passTypeId,
      pushToken,
      env
    });

    return res.sendStatus(existed ? 200 : 201);

  } catch (err) {
    //console.error('[registerDevice][err]', {
    //  msg: err?.message ?? String(err),
    //  code: err?.code,
    //  detail: err?.detail,
    //  stack: err?.stack
    //});
    if (err?.code === '23505' || /unique/i.test(err?.message || '')) {
      return res.sendStatus(200);
    }
    return res.status(500).send('Server error');
  }
};

// POST /internal/passes/:serial/points  { "delta": 50 }
const bumpPoints = async (req, res) => {
  try {
    const serial = cleanUuid(req.params.serial);
    const raw = req.body?.delta;
    const delta = typeof raw === 'string' ? Number(raw.trim()) : Number(raw);

    if (!isUuid(serial))             return res.status(400).send('invalid serial');
    if (!Number.isFinite(delta))     return res.status(400).json({ error: 'invalid delta' });

    const row = await findUserPassBySerial(serial);
    if (!row) return res.sendStatus(404);

    const upd = await bumpPointsBySerial(serial, delta);
    if (!upd) return res.sendStatus(404);

    // Enivar la notificacion de puntos 
    try {
      await notificationService.sendAppleWalletNotification(
        serial, row.id, upd.points, row.lang || 'en'
      ); 
      //console.log(`[passkitController: bumpPoints] Notificacion enviada para el serial ${serial}: ${upd.points} puntos`); 
    } catch (notifError){
      //console.error(' [passkitController: bumpPoints] Error enviado notificacion: ', notifError.message); 
    }


    let notified = 0;
    if (process.env.APNS_ENABLED === 'true') {
      const tokens = await listPushTokensBySerial(serial);
      //console.log('[bumpPoints] pushTokens', tokens.length);

      const results = await Promise.allSettled(
        tokens.map(t => notifyWallet(t.push_token, t.env, { serial }))
      );

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const token = tokens[i].push_token;
        if (r.status === 'fulfilled') {
          const { status, reason, host } = r.value;
          //console.log('[APNs]', {
          //  token: token?.slice?.(0,8), env: tokens[i].env, host, status, reason
          //});
          if (status === 200) notified++;
          if (status === 410) {
            try {
              await deleteRegistration({
                passTypeId: process.env.PASS_TYPE_IDENTIFIER,
                serial,
                pushToken: token
              });
            } catch {}
          }
        } else {
          //console.log('[bumpPoints] apns error', r.reason);
        }
      }
    }

    return res.json({ ok: true, points: upd.points, notified });
  } catch (err) {
    //console.error('bumpPoints error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// POST /internal/passes/:serial/grant-strip
// controllers/passkitController.js

const grantStrip = async (req, res) => {
  try {
    const serial = cleanUuid(req.params.serial);
    const stripNumber = Number(req.body?.stripNumber);

    if (!isUuid(serial)) return res.status(400).send('Serial inválido');
    
    if (!Number.isFinite(stripNumber) || stripNumber < 1) {
      return res.status(400).json({ error: 'stripNumber debe ser un número positivo' });
    }

    const row = await findUserPassBySerial(serial);
    if (!row) return res.sendStatus(404);

    if (row.card_type !== 'strips') {
      return res.status(400).json({ error: 'Esta tarjeta no es de tipo strips' });
    }

    // PASO 1: Actualizar strips en DB
    console.log('[grantStrip] Delegando a stripsProcess.addStripsToUser');
    const result = await stripsProcess.addStripsToUser(row.id, 1);
    
    const isComplete = result.all_levels_completed || result.level_completed || result.is_complete;
    
    // PASO 2: PRE-GENERAR imagen ANTES de APNs (CRÍTICO)
    console.log('[grantStrip] Pre-generando imagen de strips...');
    try {
      const brandAssets = await loadBrandAssets(row.business_id);
      
      if (brandAssets.stripImageOn && brandAssets.stripImageOff) {
        const previewImage = await generateStripsImage({
          collected: result.user.strips_collected,
          total: result.user.strips_required,
          stripImageOn: brandAssets.stripImageOn,
          stripImageOff: brandAssets.stripImageOff,
          cardWidth: 450
        });
        
        console.log('[grantStrip] Imagen pre-generada:', previewImage.length, 'bytes');
      }
    } catch (imgError) {
      console.error('[grantStrip] ❌ Error pre-generando imagen:', imgError.message);
    }

    // PASO 3: Delay para asegurar que la imagen esté lista
    await new Promise(resolve => setTimeout(resolve, 200));

    // PASO 4: ENVIAR SOLO UNA VEZ las notificaciones
    console.log('[grantStrip] Enviando notificación única...');
    try {
      if (isComplete) {
        await notificationService.sendCompletionNotification(
          serial, row.id, 'strips', row.lang || 'es'
        ); 
      } else {
        await notificationService.sendStripsUpdateNotification(
          serial, row.id, result.user.strips_collected, result.user.strips_required, row.lang || 'es'
        ); 
      }
      console.log('[grantStrip] Notificación enviada');
    } catch (notifError) {
      console.error('[grantStrip] ❌ Error notificación:', notifError.message); 
    }

    // PASO 5: Delay antes de APNs silent push
    await new Promise(resolve => setTimeout(resolve, 100));

    // PASO 6: ENVIAR APNs UNA SOLA VEZ
    let notified = 0;
    if (process.env.APNS_ENABLED === 'true') {
      const tokens = await listPushTokensBySerial(serial);
      console.log('[grantStrip] 📤 Enviando APNs a', tokens.length, 'dispositivo(s)');
      
      const results = await Promise.allSettled(
        tokens.map(t => notifyWallet(t.push_token, t.env, { serial }))
      );

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const token = tokens[i].push_token;
        
        if (r.status === 'fulfilled') {
          const { status, reason } = r.value;
          console.log('[grantStrip] APNs result:', {
            token: token.substring(0, 8) + '...',
            status,
            reason: reason || 'OK'
          });
          
          if (status === 200) notified++;
          
          if (status === 410) {
            try {
              await deleteRegistration({
                passTypeId: process.env.PASS_TYPE_IDENTIFIER,
                serial,
                pushToken: token
              });
            } catch {}
          }
        }
      }
      
      console.log('[grantStrip] APNs enviados:', notified, '/', tokens.length);
    }

    // RESPUESTA
    const response = { 
      ok: true, 
      strips_collected: result.user.strips_collected,
      strips_required: result.user.strips_required,
      strip_number: stripNumber,
      isComplete,
      reward_title: result.user.reward_title,
      userName: row.name,
      notified
    };

    if (result.tier_info) {
      response.tier_info = {
        current_level: result.tier_info.currentLevel,
        total_levels: result.tier_info.totalLevels,
        level_changed: result.level_changed,
        level_completed: result.level_completed,
        next_reward: result.tier_info.nextReward?.title || null
      };
    }

    if (result.all_levels_completed) {
      response.message = '🌟 ¡Completaste todos los niveles!';
    } else if (result.level_completed) {
      response.message = `🎉 ¡Nivel ${result.current_level} completado!`;
    } else if (result.level_changed) {
      response.message = `🎊 ¡Avanzaste al nivel ${result.current_level}!`;
    } else {
      response.message = 'Strip otorgado correctamente';
    }

    return res.json(response);

  } catch (err) {
    console.error('[grantStrip] ❌ Error:', err.message, err.stack);
    return res.status(500).json({ error: 'Error del servidor' });
  }
};

// POST /internal/passes/:serial/reset-strips
const resetStrips = async (req, res) => {
  try {
    const serial = cleanUuid(req.params.serial);
    const { redeemed = false } = req.body;

    if (!isUuid(serial)) return res.status(400).send('Serial inválido');

    const row = await findUserPassBySerial(serial);
    if (!row) return res.sendStatus(404);

    if (row.card_type !== 'strips') {
      return res.status(400).json({ error: 'Esta tarjeta no es de tipo strips' });
    }

    // Guardar en historial si fue completado
    if (row.strips_collected >= row.strips_required) {
      await saveStripCompletionHistory({
        userId: row.id,
        serial: serial,
        strips_collected: row.strips_collected,
        strips_required: row.strips_required,
        reward_title: row.reward_title,
        completed_at: new Date(),
        redeemed: redeemed,
        redeemed_at: redeemed ? new Date() : null
      });
    }

    // Resetear strips en la base de datos
    const updated = await resetStripsBySerial(serial);
    if (!updated) {
      return res.status(500).json({ error: 'Error al resetear strips' });
    }

    // Notificar con APNs
    let notified = 0;
    if (process.env.APNS_ENABLED === 'true') {
      const tokens = await listPushTokensBySerial(serial);
      const results = await Promise.allSettled(
        tokens.map(t => notifyWallet(t.push_token, t.env, { serial }))
      );

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value.status === 200) {
          notified++;
        }
      }
    }

    return res.json({
      ok: true,
      strips_collected: 0,
      strips_required: updated.strips_required,
      reward_title: updated.reward_title,
      isComplete: false,
      notified,
      message: redeemed 
        ? 'Premio canjeado y colección reiniciada' 
        : 'Colección reiniciada exitosamente'
    });

  } catch (err) {
    //console.error('resetStrips error:', err);
    return res.status(500).json({ error: 'Error del servidor' });
  }
};


// ========== GET PASS - CON STRIPS DESDE BUSINESS ==========
// controllers/passkitController.js - Sección de getPass

// controllers/passkitController.js

const getPass = async (req, res) => {
  try {
    const passTypeId = req.params.passTypeId;
    const serial = cleanUuid(req.params.serial);

    const row = await findUserPassBySerial(serial);
    if (!row) return res.sendStatus(404);

    const inHeader = req.headers.authorization || '';
    const inToken  = inHeader.replace(/^ApplePass\s+/i, '');

    const EXPECTED = process.env.PASS_TYPE_IDENTIFIER;
    const userPassType = row.apple_pass_type_id || row.pass_type_id;
    if (passTypeId !== EXPECTED && passTypeId !== userPassType) return res.sendStatus(404);

    const ENFORCE = process.env.PASS_ENFORCE_AUTH === 'true';
    if (ENFORCE && !authOk(req, row)) return res.sendStatus(401);

    // GENERAR ETAG CON DATOS COMPLETOS
    const etagData = {
      updated_at: row.updated_at,
      strips_collected: row.strips_collected || 0,
      strips_required: row.strips_required || 8,
      points: row.points,
      card_type: row.card_type,
      reward_unlocked: row.reward_unlocked
    };
    const etag = `"${crypto.createHash('md5').update(JSON.stringify(etagData)).digest('hex')}"`;

    // Verificar ETag primero
    const clientETag = req.headers['if-none-match'];
    if (clientETag && clientETag === etag) {
      console.log('[getPass] 304 Not Modified (ETag match)');
      return res.status(304).end();
    }

    // Verificar If-Modified-Since con margen de seguridad
    const imsHeader = req.headers['if-modified-since'];
    if (imsHeader && row.updated_at) {
      const clientTime = new Date(imsHeader).getTime();
      const serverTime = new Date(row.updated_at).getTime();
      const diffMs = serverTime - clientTime;
      
      // Solo 304 si el cliente tiene versión MÁS NUEVA y diferencia > 1 seg
      if (diffMs < -1000) {
        console.log('[getPass] 304 Not Modified (timestamp viejo)');
        return res.status(304).end();
      }
    }

    console.log('[getPass] Generando pass actualizado...');

    // Resolver diseño unificado
    let resolved = null;
    try {
      const designRow = await cardSvc.getOneCardDetails(row.card_detail_id);
  
      if (designRow && designRow.design_json) {
        resolved = resolveDesignForUser(designRow.design_json, {
          cardCode: row.serial_number,
          userName: row.name || '',
          programName: row.business_name || 'Loyalty',
          points: row.points ?? 0,
          strips_collected: row.strips_collected || 0,
          strips_required: row.strips_required || 8,
          reward_title: row.reward_title || 'Premio',
          isComplete: (row.strips_collected || 0) >= (row.strips_required || 8)
        });
      }
    } catch (e) {
      console.log('[getPass] design_json load/resolve warn:', e?.message);
    }

    // CARGAR ASSETS DEL BUSINESS
    const brandAssets = await loadBrandAssets(row.business_id);
    const dj  = resolved?.design || {};
    
    // ASEGURAR VALORES DE STRIPS NUNCA NULOS
    const stripsRequired = row.strips_required || dj.strips?.total || 8;
    const stripsCollected = row.strips_collected || 0;

    console.log('[getPass] Strips data:', {
      collected: stripsCollected,
      required: stripsRequired,
      isComplete: stripsCollected >= stripsRequired
    });

    const ctx = resolved?.ctx || {
      cardCode: row.serial_number,
      userName: row.name || '',
      programName: row.business_name || 'Loyalty',
      points: row.points ?? 0,
      strips_collected: stripsCollected,
      strips_required: stripsRequired,
      reward_title: row.reward_title || (resolved?.design?.strips?.rewardTitle) || 'Premio',
      isComplete: stripsCollected >= stripsRequired
    };

    // Determinar tipo de tarjeta
    let cardType = 'points';
    
    if (dj.cardType) {
      cardType = dj.cardType;
    } else if (stripsRequired > 0) {
      cardType = 'strips';
    }
    
    console.log('[getPass] Card type:', cardType);

    const programNameForPass = dj.hideProgramName ? undefined : (dj.programName || ctx.programName);
    const orgNameForPass = dj.hideProgramName ? '\u00A0' : (process.env.ORG_NAME || 'Your Org');

    const dropIfBusinessName = (arr = []) =>
      arr.filter(f => String(f?.value || '').trim() !== String(ctx.programName || '').trim());

    // Colores finales
    const colors = {
      background: dj.colors?.background || brandAssets.bg || '#2d3436',
      foreground: dj.colors?.foreground || brandAssets.fg || '#E6E6E6',
      label: dj.colors?.label || '#FFFFFF'
    };

    // GENERAR IMAGEN DINÁMICA DE STRIPS CON VALORES GARANTIZADOS
    let userStripsImage = null;
    if (cardType === 'strips') {
      try {
        console.log('[getPass] 🎨 Generando imagen de strips...');
        
        const stripImageOn = brandAssets.stripImageOn || brandAssets.stripOnBuffer;
        const stripImageOff = brandAssets.stripImageOff || brandAssets.stripOffBuffer;
        
        if (!stripImageOn || !stripImageOff) {
          throw new Error('Strip images no disponibles en business');
        }

        // Usar valores ya validados del contexto
        userStripsImage = await generateStripsImage({
          collected: ctx.strips_collected,
          total: ctx.strips_required,
          stripImageOn: stripImageOn,
          stripImageOff: stripImageOff,
          cardWidth: 450
        });

        if (userStripsImage && userStripsImage.length > 0) {
          console.log('[getPass] Imagen generada:', userStripsImage.length, 'bytes');
        } else {
          throw new Error('Imagen generada está vacía');
        }

      } catch (stripsError) {
        console.error('[getPass] ❌ Error generando strips:', stripsError.message);
        // Fallback: usar imagen estática
        userStripsImage = brandAssets.stripOnBuffer || brandAssets.stripBuffer || null;
        
        if (userStripsImage) {
          console.log('[getPass] ⚠️ Usando fallback strip image');
        }
      }
    }

    // Configuración de assets
    const wantLogo = dj.assets?.disableLogo === true ? false : true;
    const assets = {
      logo: wantLogo ? (brandAssets.logoBuffer || null) : null,
      strip: userStripsImage || (brandAssets.stripBuffer || null)
    };

    // FIELDS PARA STRIPS O PUNTOS
    let fields = dj.fields || {};

    if (cardType === 'strips') {
      console.log('[getPass] Configurando fields para strip card');
      
      fields = {
        primary: fields.primary || [
          { 
            key: 'progress', 
            label: 'PROGRESO', 
            value: `${ctx.strips_collected}/${ctx.strips_required}` 
          }
        ],
        secondary: fields.secondary || [
          { key: 'member', label: 'MEMBER', value: ctx.userName || '' }
        ],
        back: fields.back || [
          { key: 'memberId', label: 'Member ID', value: row.loyalty_account_id || String(row.id) },
          { key: 'reward', label: 'Premio', value: ctx.reward_title || 'Reward' },
          { key: 'status', label: 'Estado', value: ctx.isComplete ? 'COMPLETO' : 'EN PROGRESO' }
        ]
      };
    } else {
      fields = {
        primary: fields.primary || [
          { key: 'points', label: 'POINTS', value: String(ctx.points ?? 0) }
        ],
        secondary: fields.secondary || [
          { key: 'member', label: 'MEMBER', value: ctx.userName || '' }
        ],
        back: fields.back || [
          { key: 'memberId', label: 'Member ID', value: row.loyalty_account_id || String(row.id) }
        ]
      };
    }

    // Ocultar "cuenta" / memberId si se pide
    if (dj.hideAccount) {
      console.log('[getPass] Ocultando campos de cuenta');
      
      const safe = (arr) => Array.isArray(arr) ? arr : [];
      const BAN_KEYS = ['account', 'memberid', 'cuenta', 'code']; 
      const BAN_LABELS = ['cuenta', 'account', 'member id', 'account id', 'id'];

      const drop = (arr = []) => safe(arr).filter(f => {
        const k = String(f?.key || '').toLowerCase();
        const l = String(f?.label || '').toLowerCase();
        return !BAN_KEYS.includes(k) && !BAN_LABELS.includes(l);
      });

      fields = {
        primary: drop(fields?.primary),
        secondary: drop(fields?.secondary),
        back: drop(fields?.back),
      };

      // Garantizar que al menos quede algo
      if (!fields.primary.length && !fields.secondary.length) {
        if (cardType === 'strips') {
          fields.primary = [
            { key: 'progress', label: 'PROGRESO', value: `${ctx.strips_collected}/${ctx.strips_required}` }
          ];
        } else {
          fields.primary = [
            { key: 'points', label: 'PUNTOS', value: String(ctx.points ?? 0) }
          ];
        }
      }
    }

    if (dj.hideProgramName) {
      fields = {
        primary: dropIfBusinessName(fields.primary),
        secondary: dropIfBusinessName(fields.secondary),
        back: dropIfBusinessName(fields.back),
      };
    }

    // Barcode(s)
    const bc = dj.barcode || {};
    const formats = [bc.primary, ...(bc.additional || [])].filter(Boolean);

    const buffer = await createPkPassBuffer({
      cardCode: ctx.cardCode,
      userName: ctx.userName,
      programName: programNameForPass,
      organizationName: orgNameForPass,
      points: cardType === 'points' ? ctx.points : undefined,
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
      variant: cardType,
      strips_collected: ctx.strips_collected,
      strips_required: ctx.strips_required,
      reward_title: ctx.reward_title,
      isComplete: ctx.isComplete
    });

    // HEADERS CON CACHE CONTROL AGRESIVO
    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${serial}.pkpass"`,
      'Last-Modified': new Date(row.updated_at || Date.now()).toUTCString(),
      'ETag': etag,
      'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
        
    console.log('[getPass] PKPass enviado exitosamente');
    return res.status(200).send(buffer);

  } catch (err) {
    console.error('[getPass] ❌ Error:', err.message, err.stack);
    return res.status(500).json({
      error: 'PKPass build/sign error',
      message: err.message
    });
  }
};

module.exports = {
  getPass,
  registerDevice,
  bumpPoints, 
  listRegistrations, 
  deregisterDevice, 
  acceptLogs, 
  grantStrip, 
  resetStrips  
};