// controllers/passkitController.js
const {
  findUserPassBySerial,
  upsertRegistration,
  bumpPointsBySerial,
  listPushTokensBySerial, 
  listUpdatedSerialsSince,  
  deleteRegistration,  
  grantStripBySerial

} = require('../db/appleWalletdb');
const { loadBrandAssets } = require('../processes/walletProcess');
const { notifyWallet } = require('../services/apnsService');
const { createPkPassBuffer } = require('../services/appleWalletService');
const cardSvc = require('../services/carddetailService');
const { resolveDesignForUser } = require('../utils/design');

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

    console.log('[listRegistrations] req', { deviceId, since });
    const { serialNumbers, lastUpdated } =
      await listUpdatedSerialsSince({ deviceId, passTypeId, since });
    console.log('[listRegistrations] res', { serialNumbers, lastUpdated });

    return res.json({ serialNumbers, lastUpdated });
  } catch (e) {
    console.error('listRegistrations error:', e);
    
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
    console.log('[PassKit logs]', JSON.stringify(req.body));
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

    console.log('[registerDevice][in]', {
      url: req.originalUrl,
      deviceId, passTypeId, serial,
      ct: req.get('Content-Type'),
      hasBody: !!req.body,
      pushLen: (pushToken || '').length,
      ua: req.get('User-Agent')
    });

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
    console.error('[registerDevice][err]', {
      msg: err?.message ?? String(err),
      code: err?.code,
      detail: err?.detail,
      stack: err?.stack
    });
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

    let notified = 0;
    if (process.env.APNS_ENABLED === 'true') {
      const tokens = await listPushTokensBySerial(serial);
      console.log('[bumpPoints] pushTokens', tokens.length);

      const results = await Promise.allSettled(
        tokens.map(t => notifyWallet(t.push_token, t.env, { serial }))
      );

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const token = tokens[i].push_token;
        if (r.status === 'fulfilled') {
          const { status, reason, host } = r.value;
          console.log('[APNs]', {
            token: token?.slice?.(0,8), env: tokens[i].env, host, status, reason
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
        } else {
          console.log('[bumpPoints] apns error', r.reason);
        }
      }
    }

    return res.json({ ok: true, points: upd.points, notified });
  } catch (err) {
    console.error('bumpPoints error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};

// POST /internal/passes/:serial/grant-strip
const grantStrip = async (req, res) => {
  try {
    const serial = cleanUuid(req.params.serial);
    const stripNumber = Number(req.body?.stripNumber);

    // Validar que el serial sea válido
    if (!isUuid(serial)) return res.status(400).send('Serial inválido');
    
    // Validar que el número de strip sea válido
    if (!Number.isFinite(stripNumber) || stripNumber < 1) {
      return res.status(400).json({ error: 'stripNumber debe ser un número positivo' });
    }

    // Obtener la tarjeta y verificar si es del tipo 'strips'
    const row = await findUserPassBySerial(serial);
    if (!row) return res.sendStatus(404);

    if (row.card_type !== 'strips') {
      return res.status(400).json({ error: 'Esta tarjeta no es de tipo strips' });
    }

    // Actualizar los strips en la base de datos
    const updated = await grantStripBySerial(serial, stripNumber);
    if (!updated.success) {
      return res.json({ 
        ok: false, 
        message: updated.error,
        ...updated.current
      });
    }

    // Datos actualizados de la base de datos
    const data = updated.data;

    // Recalcular la colección completa
    const isComplete = data.strips_collected >= data.strips_required;

    // Notificar a los usuarios con APNs si es necesario
    let notified = 0;
    if (process.env.APNS_ENABLED === 'true') {
      const tokens = await listPushTokensBySerial(serial);
      console.log('[grantStrip] pushTokens', tokens.length);

      const results = await Promise.allSettled(
        tokens.map(t => notifyWallet(t.push_token, t.env, { serial }))
      );

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const token = tokens[i].push_token;
        if (r.status === 'fulfilled') {
          const { status, reason, host } = r.value;
          console.log('[APNs Strip]', { token: token?.slice?.(0, 8), status, reason });
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
    }

    // Responder con la información actualizada
    return res.json({ 
      ok: true, 
      strips_collected: data.strips_collected,
      strips_required: data.strips_required,
      strip_number: data.strip_number,
      isComplete,
      reward_title: data.reward_title,
      userName: data.userName,
      notified,
      message: isComplete 
        ? '¡Colección completada! Premio desbloqueado' 
        : 'Strip otorgado correctamente'
    });

  } catch (err) {
    console.error('grantStrip error:', err);
    return res.status(500).json({ error: 'Error del servidor' });
  }
};



// ========== GET PASS - CON STRIPS DESDE BUSINESS ==========
// ========== GET PASS - CON DEBUGGING INTENSIVO ==========
// ========== GET PASS - CON DEBUGGING INTENSIVO ==========
const getPass = async (req, res) => {
  try {
    console.log('[getPass] === INICIO ===');
    const passTypeId = req.params.passTypeId;
    const serial = cleanUuid(req.params.serial);

    const row = await findUserPassBySerial(serial);
    if (!row) return res.sendStatus(404);

    // DEBUG: VER QUÉ DATOS TIENES EN LA DB
    console.log('[getPass] DATOS DE LA DB:', {
      id: row.id,
      serial_number: row.serial_number,
      business_id: row.business_id,
      card_detail_id: row.card_detail_id,
      card_type: row.card_type,
      points: row.points,
      strips_collected: row.strips_collected,
      strips_required: row.strips_required,
      reward_title: row.reward_title,
      name: row.name,
      business_name: row.business_name
    });

    const inHeader = req.headers.authorization || '';
    const inToken  = inHeader.replace(/^ApplePass\s+/i, '');

    const EXPECTED = process.env.PASS_TYPE_IDENTIFIER;
    const userPassType = row.apple_pass_type_id || row.pass_type_id;
    if (passTypeId !== EXPECTED && passTypeId !== userPassType) return res.sendStatus(404);

    const ENFORCE = process.env.PASS_ENFORCE_AUTH === 'true';
    if (ENFORCE && !authOk(req, row)) return res.sendStatus(401);

    // If-Modified-Since
    const imsHeader = req.headers['if-modified-since'] || null;
    const clientSec = imsHeader ? Math.floor(new Date(imsHeader).getTime() / 1000) : null;
    const serverSec = row.updated_at ? Math.floor(new Date(row.updated_at).getTime() / 1000) : null;
    if (clientSec !== null && serverSec !== null && clientSec >= serverSec) {
      return res.status(304).end();
    }

    console.log('[getPass] Resolviendo diseño...');

    // Resolver diseño unificado
    let resolved = null;
    try {
      const designRow = await cardSvc.getOneCardDetails(row.card_detail_id);
      console.log('[getPass] DESIGN ROW:', {
        hasDesignRow: !!designRow,
        hasDesignJson: !!(designRow && designRow.design_json),
        designJson: designRow?.design_json ? JSON.stringify(designRow.design_json).substring(0, 200) + '...' : null
      });

      if (designRow && designRow.design_json) {
        resolved = resolveDesignForUser(designRow.design_json, {
          cardCode: row.serial_number,
          userName: row.name || '',
          programName: row.business_name || 'Loyalty',
          points: row.points ?? 0,
          // DATOS STRIPS DESDE LA DB
          strips_collected: row.strips_collected || 0,
          strips_required: row.strips_required || 0,  
          reward_title: row.reward_title || 'Premio',
          isComplete: (row.strips_collected || 0) >= (row.strips_required || 0)
        });
      }
    } catch (e) {
      console.log('[getPass] design_json load/resolve warn:', e?.message);
    }

    console.log('[getPass] RESOLVED DESIGN:', {
      hasResolved: !!resolved,
      design: resolved?.design ? Object.keys(resolved.design) : null,
      ctx: resolved?.ctx
    });

    // CARGAR ASSETS DEL BUSINESS (INCLUYENDO STRIPS)
    const brandAssets = await loadBrandAssets(row.business_id);
    console.log('[getPass] BRAND ASSETS:', {
      hasLogo: !!brandAssets.logoBuffer,
      logoSize: brandAssets.logoBuffer?.length || 0,
      hasStripBuffer: !!brandAssets.stripBuffer,
      stripBufferSize: brandAssets.stripBuffer?.length || 0,
      hasStripOn: !!brandAssets.stripOnBuffer,
      stripOnSize: brandAssets.stripOnBuffer?.length || 0,
      hasStripOff: !!brandAssets.stripOffBuffer,
      stripOffSize: brandAssets.stripOffBuffer?.length || 0,
      hasStripImageOn: !!brandAssets.stripImageOn,
      hasStripImageOff: !!brandAssets.stripImageOff,
      bg: brandAssets.bg,
      fg: brandAssets.fg
    });

    const dj  = resolved?.design || {};
    const ctx = resolved?.ctx || {
      cardCode: row.serial_number,
      userName: row.name || '',
      programName: row.business_name || 'Loyalty',
      points: row.points ?? 0,
      strips_collected: row.strips_collected || 0,
      strips_required: row.strips_required || 0, 
      reward_title: row.reward_title || (resolved?.design?.strips?.rewardTitle) || 'Premio',
      isComplete: (row.strips_required && row.strips_collected >= row.strips_required) || false
    };

    console.log('[getPass] CONTEXTO FINAL:', ctx);

    // DEBUG ESPECÍFICO PARA STRIPS
    console.log('[getPass] CÁLCULO STRIPS DEBUG:', {
      'row.strips_collected': row.strips_collected,
      'row.strips_required': row.strips_required,
      'ctx.strips_collected': ctx.strips_collected,
      'ctx.strips_required': ctx.strips_required,
      'ctx.isComplete': ctx.isComplete,
      'cálculo manual': `${row.strips_collected || 0} >= ${row.strips_required} = ${(row.strips_collected || 0) >= row.strips_required}`
    });

    // Determinar tipo de tarjeta usando el design_json del card_detail
    let cardType = 'points'; // Default
    
    if (dj.cardType) {
      cardType = dj.cardType;
      console.log('[getPass] Card type desde design_json:', cardType);
    } else if (row.strips_required && row.strips_required > 0) {
      cardType = 'strips';
      console.log('[getPass] Card type inferido por strips_required:', cardType);
    } else {
      console.log('[getPass] Card type default:', cardType);
    }
    
    console.log('[getPass] CARD TYPE FINAL:', cardType);

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

    // GENERAR IMAGEN DINÁMICA DE STRIPS
    let userStripsImage = null;
    if (cardType === 'strips') {
      try {
        console.log('[getPass] INICIANDO GENERACIÓN DE STRIPS...');
        
        // Usar las imágenes del business
        const stripImageOn = brandAssets.stripImageOn || brandAssets.stripOnBuffer;
        const stripImageOff = brandAssets.stripImageOff || brandAssets.stripOffBuffer;
        
        console.log('[getPass] IMÁGENES DISPONIBLES:', {
          stripImageOn: !!stripImageOn,
          stripImageOnSize: stripImageOn?.length || 0,
          stripImageOff: !!stripImageOff, 
          stripImageOffSize: stripImageOff?.length || 0,
          stripImageOnType: stripImageOn ? typeof stripImageOn : 'undefined',
          stripImageOffType: stripImageOff ? typeof stripImageOff : 'undefined'
        });
        
        if (!stripImageOn || !stripImageOff) {
          console.warn('[getPass] FALTAN IMÁGENES DE STRIPS EN EL BUSINESS');
          console.warn('[getPass] stripImageOn presente:', !!stripImageOn);
          console.warn('[getPass] stripImageOff presente:', !!stripImageOff);
          throw new Error('Strip images not found in business');
        }

        const totalStrips = (dj.strips?.total) || ctx.strips_required;
        const collectedStrips = ctx.strips_collected || 0;

        console.log('[getPass] PARÁMETROS PARA GENERAR STRIPS:', {
          total: totalStrips,
          collected: collectedStrips,
          stripImageOnSize: stripImageOn.length,
          stripImageOffSize: stripImageOff.length,
          layout: dj.strips?.layout || 'horizontal',
          cardWidth: 624,
          stripHeight: 80,
          // DEBUGGING ADICIONAL
          'ctx.strips_required': ctx.strips_required,
          'dj.strips?.total': dj.strips?.total,
          'totalStrips calculado': totalStrips,
          'collectedStrips': collectedStrips
        });

        // Verificar que tenemos valores válidos antes de generar
        if (!totalStrips || totalStrips <= 0) {
          console.error('[getPass] TOTAL STRIPS INVÁLIDO:', totalStrips);
          throw new Error(`Invalid totalStrips: ${totalStrips}`);
        }

        // VERIFICAR QUE EL SERVICIO EXISTE
        console.log('[getPass] Verificando generateStripsImage...');
        console.log('[getPass] generateStripsImage type:', typeof generateStripsImage);

        // Generar la imagen compuesta de strips
        userStripsImage = await generateStripsImage({
          collected: collectedStrips,
          total: totalStrips,
          stripImageOn: stripImageOn,
          stripImageOff: stripImageOff,
          layout: dj.strips?.layout || 'horizontal',
          cardWidth: 624,
          stripHeight: 80
        });

        console.log('[getPass] RESULTADO GENERACIÓN:', {
          generated: !!userStripsImage,
          type: typeof userStripsImage,
          isBuffer: Buffer.isBuffer(userStripsImage),
          size: userStripsImage?.length || 0
        });

        if (userStripsImage && userStripsImage.length > 0) {
          console.log('[getPass] Imagen de strips generada exitosamente:', userStripsImage.length, 'bytes');
        } else {
          console.warn('[getPass] La imagen de strips está vacía o no se generó');
          throw new Error('Generated strips image is empty');
        }

      } catch (stripsError) {
        console.error('[getPass] ERROR GENERANDO STRIPS:');
        console.error('Error message:', stripsError.message);
        console.error('Error stack:', stripsError.stack);
        
        // Fallback: usar una de las imágenes base como strip
        console.log('[getPass] USANDO FALLBACK PARA STRIPS...');
        userStripsImage = brandAssets.stripOnBuffer || brandAssets.stripBuffer || null;
        
        if (userStripsImage) {
          console.log('[getPass] Usando fallback strip image:', userStripsImage.length, 'bytes');
        } else {
          console.log('[getPass] NO HAY FALLBACK DISPONIBLE');
        }
      }
    } else {
      console.log('[getPass] Saltando generación de strips (no es strip card)');
    }

    // Configuración de assets
    const wantLogo = dj.assets?.disableLogo === true ? false : true;
    const assets = {
      logo: wantLogo ? (brandAssets.logoBuffer || null) : null,
      strip: userStripsImage || (brandAssets.stripBuffer || null)
    };

    console.log('[getPass] ASSETS FINALES:', {
      hasLogo: !!assets.logo,
      logoSize: assets.logo?.length || 0,
      hasStrip: !!assets.strip,
      stripSize: assets.strip?.length || 0,
      stripIsGenerated: assets.strip === userStripsImage,
      stripIsFallback: assets.strip !== userStripsImage && !!assets.strip
    });

    // FIELDS PARA STRIPS
    let fields = dj.fields || {};

    // Si es strip card, usar campos específicos para strips
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

      // DEBUG ESPECÍFICO PARA FIELDS
      console.log('[getPass] Campos strips calculados:', {
        'primaryValue': fields.primary[0]?.value,
        'backStatus': fields.back?.find(f => f.key === 'status')?.value,
        'isComplete usado': ctx.isComplete,
        'strips_collected usado': ctx.strips_collected,
        'strips_required usado': ctx.strips_required
      });
    } else {
      console.log('[getPass] Configurando fields para points card');
      
      // Campos por defecto para points card
      fields = {
        primary: fields.primary || [{ key: 'points', label: 'POINTS', value: String(ctx.points ?? 0) }],
        secondary: fields.secondary || [{ key: 'member', label: 'MEMBER', value: ctx.userName || '' }],
        back: fields.back || [{ key: 'memberId', label: 'Member ID', value: row.loyalty_account_id || String(row.id) }]
      };
    }

    console.log('[getPass] FIELDS CONFIGURADOS:', {
      primaryCount: fields.primary?.length || 0,
      secondaryCount: fields.secondary?.length || 0,
      backCount: fields.back?.length || 0,
      primaryValues: fields.primary?.map(f => `${f.key}=${f.value}`) || [],
      secondaryValues: fields.secondary?.map(f => `${f.key}=${f.value}`) || [],
    });

    // Ocultar "cuenta" / memberId si lo pides
    if (dj.hideAccount) {
      console.log('[getPass] OCULTANDO CAMPOS DE CUENTA');
      
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
          fields.primary = [{ key: 'progress', label: 'PROGRESO', value: `${ctx.strips_collected}/${ctx.strips_required}` }];
        } else {
          fields.primary = [{ key: 'points', label: 'PUNTOS', value: String(ctx.points ?? 0) }];
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

    console.log('[getPass] PREPARANDO PKPASS CON:');
    console.log('- cardType:', cardType);
    console.log('- strips_collected:', ctx.strips_collected);
    console.log('- strips_required:', ctx.strips_required); 
    console.log('- isComplete:', ctx.isComplete);
    console.log('- hasStripsImage:', !!userStripsImage);
    console.log('- stripsImageSize:', userStripsImage ? userStripsImage.length : 0);
    console.log('- fields primary:', fields.primary);

    const buffer = await createPkPassBuffer({
      cardCode: ctx.cardCode,
      userName: ctx.userName,
      programName: programNameForPass,
      organizationName: orgNameForPass,
      points: cardType === 'points' ? ctx.points : undefined,
      colors,
      fields,
      barcode: {
        message: bc.message || ctx.serialNumber,
        altText: bc.altText || ctx.serialNumber,
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

    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Content-Disposition': `attachment; filename="${serial}.pkpass"`,
      'Last-Modified': new Date(row.updated_at || Date.now()).toUTCString(),
      'Cache-Control': 'no-store'
    });
    
    console.log('[getPass] PKPass enviado exitosamente');
    return res.status(200).send(buffer);

  } catch (err) {
    console.error('[getPass] === ERROR CRÍTICO ===');
    console.error('Error message:', err.message);
    console.error('Error stack:', err.stack);
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
  grantStrip
};