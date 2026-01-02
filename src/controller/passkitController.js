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
// ========== HELPER: Single-Tier Grant ==========
async function handleSingleTierGrant(row, serial) {
  const currentStrips = row.strips_collected || 0;
  const requiredStrips = row.strips_required || 10;

  console.log('[handleSingleTierGrant] Strips actuales:', currentStrips, '/', requiredStrips);

  // Si ya está completo, rechazar
  if (row.reward_unlocked) {
    console.log('[handleSingleTierGrant] Recompensa ya desbloqueada');
    throw {
      status: 400,
      error: 'collection_complete',
      message: 'Recompensa ya desbloqueada. Debe canjearse antes de continuar.',
      data: {
        strips_collected: currentStrips,
        strips_required: requiredStrips,
        reward_unlocked: true
      }
    };
  }

  const newStripsCollected = Math.min(currentStrips + 1, requiredStrips);
  const isComplete = newStripsCollected >= requiredStrips;

  console.log('[handleSingleTierGrant] Strips:', currentStrips, '→', newStripsCollected);

  // ACTUALIZAR EN DB
  const result = await grantStripBySerial(serial, newStripsCollected, 
    isComplete ? { reward_unlocked: true } : {}
  );

  if (!result.success) {
    throw new Error(result.error);
  }

  return {
    strips_collected: newStripsCollected,
    strips_required: requiredStrips,
    reward_unlocked: isComplete,
    isComplete,
    reward_title: row.reward_title,
    user: result.data
  };
}

// ========== HELPER: Multi-Tier Grant (ACUMULATIVO + RESET LOG) ==========
async function handleMultiTierGrant(row, serial, rewardConfig) {
  const usersService = require('../services/usersService');
  const { clearUserStripsLog } = require('../db/appleWalletdb');
  
  const currentStrips = row.strips_collected || 0;
  const currentRequired = row.strips_required;

  console.log('[handleMultiTierGrant] Estado actual:', {
    strips_collected: currentStrips,
    strips_required: currentRequired,
    reward_unlocked: row.reward_unlocked
  });

  // Calcular tier actual ANTES de agregar strip
  const tierInfoBefore = usersService.calculateCurrentTier(
    { 
      strips_collected: currentStrips,
      strips_required: currentRequired, 
      reward_title: row.reward_title
    },
    rewardConfig.multiTier
  );

  console.log('[handleMultiTierGrant] Tier ANTES:', {
    currentLevel: tierInfoBefore.currentLevel,
    totalLevels: tierInfoBefore.totalLevels,
    stripsRequiredForCurrentTier: tierInfoBefore.stripsRequiredForCurrentTier,
    isLastTier: tierInfoBefore.isLastTier,
    currentReward: tierInfoBefore.currentReward.title
  });

  // Verificar si está en el último tier y ya completado
  if (tierInfoBefore.isLastTier && row.reward_unlocked) {
    console.log('[handleMultiTierGrant] Colección completa (último tier)');
    throw {
      status: 400,
      error: 'collection_complete',
      message: 'Colección completa. Debe canjearse antes de continuar.',
      data: {
        strips_collected: currentStrips,
        strips_required: tierInfoBefore.stripsRequiredForCurrentTier,
        reward_unlocked: true,
        currentLevel: tierInfoBefore.currentLevel,
        totalLevels: tierInfoBefore.totalLevels
      }
    };
  }

  // ACUMULATIVO: Agregar 1 strip sin resetear
  const newStripsCollected = currentStrips + 1;

  console.log('[handleMultiTierGrant] Agregando strip (acumulativo):', currentStrips, '→', newStripsCollected);

  // Verificar si completó el tier actual
  const completedCurrentTier = newStripsCollected >= tierInfoBefore.stripsRequiredForCurrentTier;

  // CASO 1: Completó tier pero NO es el último → Avanzar al siguiente
  if (completedCurrentTier && !tierInfoBefore.isLastTier) {
    console.log('[handleMultiTierGrant] Tier completado! Avanzando al siguiente...');

    // Obtener siguiente tier
    const nextTierIndex = tierInfoBefore.currentLevel; // Ya es 1-indexed
    const nextTier = rewardConfig.multiTier.rewards[nextTierIndex];

    if (!nextTier) {
      console.error('[handleMultiTierGrant] No se encontró el siguiente tier');
      throw new Error('Siguiente tier no encontrado');
    }

    console.log('[handleMultiTierGrant] Siguiente tier:', {
      level: nextTierIndex + 1,
      title: nextTier.title,
      strips_required: nextTier.strips_required
    });

    // CRÍTICO: LIMPIAR user_strips_log antes de actualizar
    await clearUserStripsLog(row.id);
    console.log('[handleMultiTierGrant] Strips log limpiado para nuevo tier');

    // ACTUALIZAR: Otorgar strip #1 del nuevo tier
    const result = await grantStripBySerial(serial, 1, {
      strips_required: nextTier.strips_required,
      reward_title: nextTier.title,
      reward_description: nextTier.description,
      reward_unlocked: false
    });

    if (!result.success) {
      throw new Error(result.error);
    }

    return {
      strips_collected: newStripsCollected,  // ACUMULATIVO (5, 10, 15...)
      strips_required: nextTier.strips_required,
      reward_unlocked: false,
      reward_title: nextTier.title,
      currentLevel: nextTierIndex + 1,
      totalLevels: tierInfoBefore.totalLevels,
      level_completed: true,
      level_changed: true,
      previousTier: tierInfoBefore.currentReward.title,
      nextTier: nextTier.title,
      message: `¡Tier ${tierInfoBefore.currentLevel} completado! Avanzaste a ${nextTier.title}`,
      user: result.data,
      tier_info: {
        currentLevel: nextTierIndex + 1,
        totalLevels: tierInfoBefore.totalLevels,
        currentReward: nextTier,
        nextReward: rewardConfig.multiTier.rewards[nextTierIndex + 1] || null
      }
    };
  }

  // CASO 2: Actualización normal dentro del tier o completar último tier
  const isLastTierComplete = tierInfoBefore.isLastTier && 
                              newStripsCollected >= tierInfoBefore.stripsRequiredForCurrentTier;

  console.log('[handleMultiTierGrant] Actualizando strips dentro del tier:', newStripsCollected);
  console.log('[handleMultiTierGrant] ¿Último tier completo?', isLastTierComplete);

  //  FIX: Calcular cuántos strips ya tiene en el tier ACTUAL
  const previousTierLimit = tierInfoBefore.currentLevel === 1 
    ? 0 
    : rewardConfig.multiTier.rewards[tierInfoBefore.currentLevel - 2].strips_required;

  //  FIX: El nuevo strip es el siguiente después de los que ya tiene
  const stripsInCurrentTier = currentStrips - previousTierLimit;
  const nextStripNumber = stripsInCurrentTier + 1;

  console.log('[handleMultiTierGrant] Strip calculation:', {
    currentStrips,
    previousTierLimit,
    stripsInCurrentTier,
    nextStripNumber
  });

  // ACTUALIZAR EN DB
  const result = await grantStripBySerial(serial, nextStripNumber, 
    isLastTierComplete ? { reward_unlocked: true } : {}
  );

  if (!result.success) {
    throw new Error(result.error);
  }

  return {
    strips_collected: newStripsCollected,
    strips_required: tierInfoBefore.stripsRequiredForCurrentTier,
    reward_unlocked: isLastTierComplete,
    reward_title: tierInfoBefore.currentReward.title,
    currentLevel: tierInfoBefore.currentLevel,
    totalLevels: tierInfoBefore.totalLevels,
    isComplete: isLastTierComplete,
    all_levels_completed: isLastTierComplete,
    user: result.data,
    tier_info: {
      currentLevel: tierInfoBefore.currentLevel,
      totalLevels: tierInfoBefore.totalLevels,
      currentReward: tierInfoBefore.currentReward,
      nextReward: null
    }
  };
}

// ========== GRANT STRIP PRINCIPAL ==========
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

    console.log('[grantStrip] Iniciando otorgamiento de strip:', {
      serial,
      stripNumber,
      current_strips: row.strips_collected,
      required_strips: row.strips_required
    });

    // Obtener configuración del sistema de recompensas
    const rewardConfig = await cardSvc.getRewardSystemConfig(row.card_detail_id);
    
    if (!rewardConfig) {
      return res.status(404).json({ error: 'Configuración de recompensas no encontrada' });
    }

    const isMultiTier = rewardConfig.type === 'multi-tier';
    console.log('[grantStrip] Sistema:', isMultiTier ? 'Multi-tier' : 'Single-tier');

    // ===== EJECUTAR HELPER (actualiza DB directamente) =====
    let result;
    try {
      if (isMultiTier) {
        result = await handleMultiTierGrant(row, serial, rewardConfig);
      } else {
        result = await handleSingleTierGrant(row, serial);
      }
    } catch (error) {
      if (error.status === 400) {
        return res.status(400).json(error.data || { error: error.error, message: error.message });
      }
      throw error;
    }

    console.log('[grantStrip] Resultado:', {
      strips_collected: result.strips_collected,
      strips_required: result.strips_required,
      level_completed: result.level_completed,
      all_levels_completed: result.all_levels_completed
    });

    const isComplete = result.all_levels_completed || result.isComplete;
    
    // ===== PRE-GENERAR IMAGEN ANTES DE APNs =====
    console.log('[grantStrip] Pre-generando imagen de strips...');
    try {
      const brandAssets = await loadBrandAssets(row.business_id);
      
      if (brandAssets.stripImageOn && brandAssets.stripImageOff) {
        const previewImage = await generateStripsImage({
          collected: result.strips_collected,
          total: result.strips_required,
          stripImageOn: brandAssets.stripImageOn,
          stripImageOff: brandAssets.stripImageOff,
          cardWidth: 450
        });
        
        console.log('[grantStrip] Imagen pre-generada:', previewImage.length, 'bytes');
      }
    } catch (imgError) {
      console.error('[grantStrip] Error pre-generando imagen:', imgError.message);
    }

    await new Promise(resolve => setTimeout(resolve, 200));

    // ===== ENVIAR NOTIFICACIÓN =====
    console.log('[grantStrip] Enviando notificación...');
    try {
      if (isComplete) {
        await notificationService.sendCompletionNotification(
          serial, row.id, 'strips', row.lang || 'es'
        ); 
      } else if (result.level_completed) {
        await notificationService.sendTierCompletedNotification(
          serial, row.id, result.previousTier, result.nextTier, row.lang || 'es'
        );
      } else {
        await notificationService.sendStripsUpdateNotification(
          serial, row.id, result.strips_collected, result.strips_required, row.lang || 'es'
        ); 
      }
      console.log('[grantStrip] Notificación enviada');
    } catch (notifError) {
      console.error('[grantStrip] Error notificación:', notifError.message); 
    }

    await new Promise(resolve => setTimeout(resolve, 100));

    // ===== ENVIAR APNs =====
    let notified = 0;
    if (process.env.APNS_ENABLED === 'true') {
      const tokens = await listPushTokensBySerial(serial);
      console.log('[grantStrip] Enviando APNs a', tokens.length, 'dispositivo(s)');
      
      const results = await Promise.allSettled(
        tokens.map(t => notifyWallet(t.push_token, t.env, { serial }))
      );

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const token = tokens[i].push_token;
        
        if (r.status === 'fulfilled') {
          const { status } = r.value;
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

    // ===== CONSTRUIR RESPUESTA =====
    const response = { 
      ok: true, 
      strips_collected: result.strips_collected,
      strips_required: result.strips_required,
      strip_number: stripNumber,
      isComplete,
      reward_title: result.reward_title,
      userName: row.name,
      notified
    };

    if (result.tier_info) {
      response.tier_info = {
        current_level: result.tier_info.currentLevel || result.currentLevel,
        total_levels: result.tier_info.totalLevels,
        level_changed: result.level_changed || false,
        level_completed: result.level_completed || false,
        next_reward: result.tier_info.nextReward?.title || null
      };
    }

    if (result.all_levels_completed) {
      response.message = ' ¡Completaste todos los niveles!';
    } else if (result.level_completed) {
      response.message = ` ¡Nivel completado! Avanzaste a ${result.nextTier}`;
    } else {
      response.message = 'Strip otorgado correctamente';
    }

    console.log('[grantStrip] Respuesta:', response);
    return res.json(response);

  } catch (err) {
    console.error('[grantStrip] Error:', err.message);
    console.error('[grantStrip] Stack:', err.stack);
    return res.status(500).json({ 
      error: 'Error del servidor',
      message: err.message 
    });
  }
};

// FIN de grantStrip

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

    console.log('[resetStrips] Iniciando reset:', {
      serial,
      redeemed,
      strips_collected: row.strips_collected,
      strips_required: row.strips_required, 
      reward_title: row.reward_title
    });

    // ===== OBTENER CONFIGURACIÓN DE RECOMPENSAS =====
    const rewardConfig = await cardSvc.getRewardSystemConfig(row.card_detail_id);
    
    if (!rewardConfig) {
      console.warn('[resetStrips] No se encontró reward config, usando reset simple');
      return await handleSimpleReset(row, serial, redeemed, res);
    }

    const isMultiTier = rewardConfig.type === 'multi-tier';
    console.log('[resetStrips] Sistema:', isMultiTier ? 'Multi-tier' : 'Single-tier');

    // ===== GUARDAR EN HISTORIAL SI FUE COMPLETADO =====
    if (row.strips_collected >= row.strips_required) {
      try {
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
        console.log('[resetStrips] Historial guardado');
      } catch (histError) {
        console.error('[resetStrips] Error guardando historial:', histError.message);
      }
    }

    // ===== MULTI-TIER: AVANZAR O REINICIAR =====
    if (isMultiTier) {
      const usersService = require('../services/usersService');
      const { clearUserStripsLog } = require('../db/appleWalletdb');

      // Calcular tier actual ANTES del reset
      const tierInfoBefore = usersService.calculateCurrentTier(
        {
          strips_collected: row.strips_collected,
          strips_required: row.strips_required, 
          reward_title: row.reward_title
        },
        rewardConfig.multiTier
      );

      console.log('[resetStrips] Tier ANTES del reset:', {
        currentLevel: tierInfoBefore.currentLevel,
        totalLevels: tierInfoBefore.totalLevels,
        hasNextReward: !!tierInfoBefore.nextReward
      });

      // ===== CASO 1: HAY SIGUIENTE TIER → AVANZAR =====
      if (tierInfoBefore.nextReward) {
        console.log('[resetStrips] Avanzando al siguiente tier:', tierInfoBefore.nextReward.title);

        const nextReward = tierInfoBefore.nextReward;
        
        // LIMPIAR LOG DE STRIPS
        await clearUserStripsLog(row.id);
        console.log('[resetStrips] Strips log limpiado');

        // ACTUALIZAR A SIGUIENTE TIER
        const updated = await resetStripsBySerial(serial, {
          strips_required: nextReward.strips_required,
          reward_title: nextReward.title,
          reward_description: nextReward.description
        });

        if (!updated) {
          return res.status(500).json({ error: 'Error al actualizar tier' });
        }

        // CALCULAR TIER DESPUÉS DEL RESET (para tier_info correcto)
        const newTierLevel = tierInfoBefore.currentLevel + 1;
        
        const tierInfoAfter = usersService.calculateCurrentTier(
          {
            strips_collected: 0,  // Reseteo a 0
            strips_required: nextReward.strips_required, 
            reward_title: nextReward.title
          },
          rewardConfig.multiTier
        );

        console.log('[resetStrips] Tier DESPUÉS del reset:', {
          currentLevel: tierInfoAfter.currentLevel,
          totalLevels: tierInfoAfter.totalLevels,
          nextReward: tierInfoAfter.nextReward?.title
        });

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
          console.log('[resetStrips] APNs enviados:', notified, '/', tokens.length);
        }

        return res.json({
          ok: true,
          strips_collected: 0,
          strips_required: nextReward.strips_required,
          reward_title: nextReward.title,
          isComplete: false,
          tier_advanced: true,
          new_tier: newTierLevel,
          total_tiers: tierInfoAfter.totalLevels,
          notified,
          message: redeemed 
            ? `Premio canjeado. Avanzaste al Nivel ${newTierLevel}: ${nextReward.title}`
            : `Avanzado al Nivel ${newTierLevel}: ${nextReward.title}`,
          // TIER INFO CORRECTO (después del reset)
          tier_info: {
            current_level: tierInfoAfter.currentLevel,
            total_levels: tierInfoAfter.totalLevels,
            current_reward: nextReward.title,
            next_reward: tierInfoAfter.nextReward?.title || null
          }
        });
      }

      // ===== CASO 2: ÚLTIMO TIER → REINICIAR AL TIER 1 =====
      console.log('[resetStrips] Último tier completado, reiniciando al tier 1');

      const firstReward = rewardConfig.multiTier.rewards[0];

      // LIMPIAR LOG DE STRIPS
      await clearUserStripsLog(row.id);
      console.log('[resetStrips] Strips log limpiado');

      // RESETEAR AL TIER 1
      const updated = await resetStripsBySerial(serial, {
        strips_required: firstReward.strips_required,
        reward_title: firstReward.title,
        reward_description: firstReward.description
      });

      if (!updated) {
        return res.status(500).json({ error: 'Error al resetear' });
      }

      // CALCULAR TIER DESPUÉS DEL RESET
      const tierInfoAfter = usersService.calculateCurrentTier(
        {
          strips_collected: 0,
          strips_required: firstReward.strips_required
        },
        rewardConfig.multiTier
      );

      console.log('[resetStrips] Tier DESPUÉS del reset al tier 1:', {
        currentLevel: tierInfoAfter.currentLevel,
        totalLevels: tierInfoAfter.totalLevels
      });

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
        console.log('[resetStrips] APNs enviados:', notified, '/', tokens.length);
      }

      return res.json({
        ok: true,
        strips_collected: 0,
        strips_required: firstReward.strips_required,
        reward_title: firstReward.title,
        isComplete: false,
        cycle_completed: true,
        restarted_to_tier_1: true,
        notified,
        message: redeemed 
          ? '¡Ciclo completado! Premio canjeado y reiniciado al Nivel 1'
          : 'Ciclo completado. Reiniciado al Nivel 1',
        // TIER INFO CORRECTO (después del reset)
        tier_info: {
          current_level: tierInfoAfter.currentLevel,
          total_levels: tierInfoAfter.totalLevels,
          current_reward: firstReward.title,
          next_reward: tierInfoAfter.nextReward?.title || null
        }
      });
    }

    // ===== SINGLE-TIER: RESET NORMAL =====
    console.log('[resetStrips] Reset simple (single-tier)');
    return await handleSimpleReset(row, serial, redeemed, res);

  } catch (err) {
    console.error('[resetStrips] Error:', err.message);
    console.error('[resetStrips] Stack:', err.stack);
    return res.status(500).json({ 
      error: 'Error del servidor',
      message: err.message 
    });
  }
};

// ===== HELPER: RESET SIMPLE (SINGLE-TIER O FALLBACK) =====
async function handleSimpleReset(row, serial, redeemed, res) {
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
}


// ========== GET PASS - CON STRIPS DESDE BUSINESS ==========
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
    let designRow = null;
    
    try {
      designRow = await cardSvc.getOneCardDetails(row.card_detail_id);
  
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
        console.log('[getPass] Generando imagen de strips...');
        
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
        console.error('[getPass] Error generando strips:', stripsError.message);
        // Fallback: usar imagen estática
        userStripsImage = brandAssets.stripOnBuffer || brandAssets.stripBuffer || null;
        
        if (userStripsImage) {
          console.log('[getPass] Usando fallback strip image');
        }
      }
    }

    // Configuración de assets
    const wantLogo = dj.assets?.disableLogo === true ? false : true;
    const assets = {
      logo: wantLogo ? (brandAssets.logoBuffer || null) : null,
      strip: userStripsImage || (brandAssets.stripBuffer || null)
    };

    // ========== CALCULAR TIER INFO PARA MULTI-TIER ==========
    let tierInfo = null;
    
    if (cardType === 'strips' && designRow?.design_json?.rewardSystem) {
      const rewardSystem = designRow.design_json.rewardSystem;
      
      if (rewardSystem.type === 'multi-tier' && rewardSystem.multiTier?.rewards) {
        try {
          const usersService = require('../services/usersService');
          
          tierInfo = usersService.calculateCurrentTier(
            {
              strips_collected: ctx.strips_collected,
              strips_required: ctx.strips_required, 
              reward_title: ctx.reward_title
            },
            rewardSystem.multiTier
          );
          
          console.log('[getPass] Multi-tier detectado:', {
            currentLevel: tierInfo.currentLevel,
            totalLevels: tierInfo.totalLevels,
            currentReward: tierInfo.currentReward.title,
            nextReward: tierInfo.nextReward?.title
          });
        } catch (tierError) {
          console.error('[getPass] Error calculando tier:', tierError.message);
        }
      }
    }

    // FIELDS PARA STRIPS O PUNTOS
    let fields = dj.fields || {};

    if (cardType === 'strips') {
      console.log('[getPass] Configurando fields para strip card');
      
      // ===== PRIMARY FIELDS CON TIER =====
      const primaryFields = [
        { 
          key: 'progress', 
          label: 'PROGRESO', 
          value: `${ctx.strips_collected}/${ctx.strips_required}` 
        }
      ];
      
      // Agregar tier si es multi-tier
      if (tierInfo) {
        primaryFields.push({
          key: 'tier',
          label: 'NIVEL',
          value: `${tierInfo.currentLevel}/${tierInfo.totalLevels}`
        });
      }
      
      // ===== BACK FIELDS CON SIGUIENTE PREMIO =====
      const backFields = [
        { key: 'memberId', label: 'Member ID', value: row.loyalty_account_id || String(row.id) },
        { key: 'reward', label: 'Premio Actual', value: ctx.reward_title || 'Reward' },
        { key: 'status', label: 'Estado', value: ctx.isComplete ? 'COMPLETO' : 'EN PROGRESO' }
      ];
      
      // Agregar siguiente premio si existe
      if (tierInfo && tierInfo.nextReward) {
        backFields.push({
          key: 'nextReward',
          label: 'Siguiente Premio',
          value: tierInfo.nextReward.title
        });
      }
      
      fields = {
        primary: fields.primary || primaryFields,
        secondary: fields.secondary || [
          { key: 'member', label: 'MEMBER', value: ctx.userName || '' }
        ],
        back: fields.back || backFields
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
          const primaryFallback = [
            { key: 'progress', label: 'PROGRESO', value: `${ctx.strips_collected}/${ctx.strips_required}` }
          ];
          
          if (tierInfo) {
            primaryFallback.push({
              key: 'tier',
              label: 'NIVEL',
              value: `${tierInfo.currentLevel}/${tierInfo.totalLevels}`
            });
          }
          
          fields.primary = primaryFallback;
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
    console.error('[getPass] Error:', err.message, err.stack);
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