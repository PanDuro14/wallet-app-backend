// processes/onboardingProcess.js
const crypto = require('crypto');

const usersService      = require('../services/usersService');
const businessService   = require('../services/businessService');
const carddetailService = require('../services/carddetailService');

const { 
  issueGoogleWalletLink,
  createGoogleWalletObject,
  issueGoogleWallet
} = require('../processes/walletProcess');

const pwaWalletService = require('../services/pwaWalletService');

const pickFirst = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : null);

const ensureBusiness = async (business_id) => {
  const biz = await businessService.getOneBusiness(business_id);
  if (!biz) {
    const err = new Error('Negocio no existente');
    err.statusCode = 404;
    throw err;
  }
  return biz;
};

/* ====================== HELPERS ====================== */
function unwrapDesignRow(row) {
  if (!row) return null;
  if ('business_id' in row || 'design_json' in row) return row;
  if (row.design && (row.design.business_id != null || row.design.design_json != null)) return row.design;
  if (Array.isArray(row.rows) && row.rows.length) return unwrapDesignRow(row.rows[0]);
  if (row.data && (row.data.business_id != null || row.data.design_json != null)) return row.data;
  if (typeof row.design_json === 'string') {
    try { row.design_json = JSON.parse(row.design_json); } catch {}
  }
  return row;
}

function extractBizId(row) {
  if (!row) return undefined;
  if (row.business_id != null) return Number(row.business_id);
  if (row.design_json?.businessId != null) return Number(row.design_json.businessId);
  if (row.businessId != null) return Number(row.businessId);
  return undefined;
}

const pickDesign = async (business_id, card_detail_id) => {
  const bizId = Number(business_id);
  if (!Number.isFinite(bizId)) {
    const err = new Error('business_id inválido');
    err.statusCode = 400;
    throw err;
  }

  if (card_detail_id != null) {
    const id = Number(card_detail_id);
    const raw = await carddetailService.getOneCardDetails(id);
    const design = unwrapDesignRow(raw);

    if (!design) {
      const err = new Error('card_detail_id no encontrado');
      err.statusCode = 404;
      throw err;
    }

    const bizOfDesign = extractBizId(design);
    if (!Number.isFinite(bizOfDesign) || bizOfDesign !== bizId) {
      const err = new Error('card_detail_id inválido para este negocio');
      err.statusCode = 400;
      throw err;
    }
    return design;
  }

  const list = await carddetailService.getAllCardsByBusiness(bizId);
  const first = Array.isArray(list) && list.length ? list[0] : null;

  if (!first) {
    const err = new Error('El negocio no tiene diseños de tarjeta');
    err.statusCode = 400;
    throw err;
  }
  return first;
};

/* ====================== PROCESO PRINCIPAL CON MULTI-TIER ====================== */
const createUserAndIssueProcess = async ({ 
  business_id, 
  name, 
  email, 
  phone, 
  card_detail_id, 
  points,
  variant,
  cardType,
  colors,
  barcode,
  tier,
  since
}) => {
  
  /* ====== 1. DETERMINAR TIPO DE TARJETA ====== */
  let finalCardType = 'points';
  
  if (cardType) {
    finalCardType = cardType.toLowerCase().trim();
  } else if (variant) {
    finalCardType = variant.toLowerCase().trim();
  }

  if (finalCardType !== 'strips' && finalCardType !== 'points') {
    const err = new Error('variant/cardType debe ser "strips" o "points"');
    err.statusCode = 400;
    throw err;
  }

  /* ====== 2. VALIDACIONES DE NEGOCIO Y DISEÑO ====== */
  const biz = await ensureBusiness(business_id);
  const design = await pickDesign(business_id, card_detail_id);

  name  = (name ?? '').toString().trim();
  email = (email ?? '').toString().trim();
  phone = (phone ?? '').toString().trim() || null;

  if (!name || !email) {
    const err = new Error('name y email son obligatorios');
    err.statusCode = 400;
    throw err;
  }

  /* ====== 3. OBTENER CONFIGURACIÓN DE REWARDS DESDE design_json ====== */
  const { getRewardSystemConfig } = require('../services/carddetailService');
  const rewardConfig = await getRewardSystemConfig(design.id);
  
  console.log('[createUserAndIssue] Configuración de rewards:', {
    type: rewardConfig?.type,
    cardType: finalCardType
  });
  
  // Valores efectivos según el tipo de sistema
  let effectiveStripsRequired = 10;
  let effectiveRewardTitle = 'Recompensa';
  let effectiveRewardDescription = null;
  let isMultiTier = false;
  
  if (finalCardType === 'strips' && rewardConfig) {
    if (rewardConfig.type === 'single') {
      // Sistema single: un solo premio
      effectiveStripsRequired = rewardConfig.single.strips_required;
      effectiveRewardTitle = rewardConfig.single.reward_title;
      effectiveRewardDescription = rewardConfig.single.reward_description;
      isMultiTier = false;
      
    } else if (rewardConfig.type === 'multi-tier') {
      // Sistema multi-tier: usar el primer premio como inicial
      const firstReward = rewardConfig.multiTier.rewards[0];
      effectiveStripsRequired = firstReward.strips_required;
      effectiveRewardTitle = firstReward.title;
      effectiveRewardDescription = firstReward.description;
      isMultiTier = true;
      
      console.log('[createUserAndIssue] Multi-tier habilitado:', {
        totalLevels: rewardConfig.multiTier.rewards.length,
        firstReward: firstReward.title,
        stripsRequired: effectiveStripsRequired
      });
    }
  }

  /* ====== 4. IDENTIFICADORES DEL PASE ====== */
  const serial_number = crypto.randomUUID();
  const apple_auth_token = crypto.randomBytes(16).toString('hex');
  
  const typeIdFromEnv = process.env.PASS_TYPE_IDENTIFIER;
  if (!typeIdFromEnv || !/^pass\./.test(typeIdFromEnv)) {
    throw new Error('PASS_TYPE_IDENTIFIER no configurado o inválido (debe iniciar con "pass.")');
  }
  const apple_pass_type_id = typeIdFromEnv;

  const loyalty_account_id = `CARD-${business_id}-${serial_number.slice(0, 8).toUpperCase()}`;

  // Validar longitudes
  const assertLen = (v, n, field) => {
    if (v != null && String(v).length > n) {
      const err = new Error(`${field} demasiado largo (${String(v).length} > ${n})`);
      err.statusCode = 400;
      throw err;
    }
  };
  assertLen(name, 255, 'name');
  assertLen(email, 255, 'email');
  assertLen(phone, 32, 'phone');
  assertLen(apple_pass_type_id, 255, 'apple_pass_type_id');
  assertLen(loyalty_account_id, 64, 'loyalty_account_id');

  /* ====== 5. PREPARAR DATOS PARA CREAR USUARIO ====== */
  const initial_points = finalCardType === 'points' ? (points || 0) : 0;

  const userData = {
    name,
    email,
    phone,
    business_id,
    points: initial_points,
    serial_number,
    apple_auth_token,
    apple_pass_type_id,
    card_detail_id: design.id,
    loyalty_account_id,
    card_type: finalCardType,
    design_variant: finalCardType
  };

  if (finalCardType === 'strips') {
    userData.strips_collected = 0;
    userData.strips_required = effectiveStripsRequired;
    userData.reward_title = effectiveRewardTitle;
    userData.reward_description = effectiveRewardDescription;
    userData.reward_unlocked = false;
  }

  console.log('[createUserAndIssue] userData preparado:', {
    card_type: userData.card_type,
    strips_required: userData.strips_required,
    reward_title: userData.reward_title,
    is_multi_tier: isMultiTier
  });

  /* ====== 6. CREAR USUARIO EN BD ====== */
  const user = await usersService.createUser(userData);
  
  console.log('[createUserAndIssue] Usuario creado:', { 
    id: user.id, 
    email: user.email, 
    card_type: user.card_type,
    strips_required: user.strips_required,
    is_multi_tier: isMultiTier
  });

  if (finalCardType === 'strips' && !user.card_type) {
    console.error('[CRITICAL] Usuario creado sin card_type, revisar usersService.createUser');
  }

  /* ====== 7. CALCULAR NIVEL ACTUAL (SI ES MULTI-TIER) ====== */
  let tierInfo = null;
  if (isMultiTier && rewardConfig.type === 'multi-tier') {
    const { calculateCurrentTier } = require('../services/usersService');
    tierInfo = calculateCurrentTier(user, rewardConfig.multiTier);
    
    console.log('[createUserAndIssue] Tier calculado:', {
      currentLevel: tierInfo.currentLevel,
      totalLevels: tierInfo.totalLevels,
      progress: `${tierInfo.stripsInCurrentTier}/${tierInfo.stripsRequiredForCurrentTier}`
    });
  }

  /* ====== 8. EMITIR GOOGLE WALLET ====== */
  let google_save_url = null;
  let googleObjectId = null;
  
  try {
    console.log('[createUserAndIssue] Intentando REST API...');
    
    const googleResult = await createGoogleWalletObject({
      cardCode: serial_number,
      userName: user.name,
      programName: biz.name || 'Loyalty Program',
      businessId: business_id,
      card_detail_id,
      variant: finalCardType,
      points: initial_points,
      tier: tier || (finalCardType === 'points' ? 'Bronce' : undefined),
      since: since || new Date().toISOString().slice(0, 10),
      strips_collected: finalCardType === 'strips' ? 0 : undefined,
      strips_required: finalCardType === 'strips' ? effectiveStripsRequired : undefined,
      reward_title: finalCardType === 'strips' ? effectiveRewardTitle : undefined,
      isComplete: false,
      colors: colors || {
        background: design.background_color || biz.background_color || '#2d3436',
        foreground: design.foreground_color || biz.foreground_color || '#E6E6E6'
      },
      barcode: barcode || { type: 'qr' }, 
    });

    googleObjectId = googleResult.objectId;
    google_save_url = `https://pay.google.com/gp/v/save/${encodeURIComponent(googleObjectId)}`;
    
    console.log('[createUserAndIssue] ✓ Google Wallet REST API exitoso');
    
  } catch (restApiError) {
    console.error('[createUserAndIssue] ❌ REST API falló:', {
      message: restApiError.message
    });
    
    // Fallback a JWT
    console.log('[createUserAndIssue] 🔄 Intentando fallback con JWT...');
    
    try {
      google_save_url = await issueGoogleWalletLink({
        cardCode: serial_number,
        userName: user.name,
        programName: biz.name || 'Loyalty Program',
        businessId: business_id,
        card_detail_id,
        variant: finalCardType,
        tier: tier || (finalCardType === 'points' ? 'Bronce' : undefined),
        since: since || new Date().toISOString().slice(0, 10),
        strips_collected: finalCardType === 'strips' ? 0 : undefined,
        strips_required: finalCardType === 'strips' ? effectiveStripsRequired : undefined,
        reward_title: finalCardType === 'strips' ? effectiveRewardTitle : undefined,
        isComplete: false,
        colors: colors || {
          background: design.background_color || biz.background_color || '#2d3436',
          foreground: design.foreground_color || biz.foreground_color || '#E6E6E6'
        },
        barcode: barcode || { type: 'qr' }
      });
      
      console.log('[createUserAndIssue] ✓ JWT fallback exitoso');
      
    } catch (jwtError) {
      console.error('[createUserAndIssue] ❌ JWT fallback también falló:', {
        message: jwtError.message
      });
      google_save_url = null;
    }
  }

  /* ====== 9. APPLE WALLET URL ====== */
  const base = process.env.PUBLIC_BASE_URL || process.env.WALLET_BASE_URL || '';
  const typeId = process.env.PASS_TYPE_IDENTIFIER;
  const apple_pkpass_url = `${base}/api/v1/wallets/v1/passes/${encodeURIComponent(typeId)}/${serial_number}`;

  /* ====== 10. GUARDAR URL DE GOOGLE WALLET ====== */
  if (google_save_url) {
    try {
      await usersService.saveUserWallet({
        userId: user.id,
        loyalty_account_id,
        wallet_url: google_save_url,
        google_object_id: googleObjectId
      });
      console.log('[createUserAndIssue] ✓ Google Wallet URL guardada');
    } catch (saveError) {
      console.error('[createUserAndIssue] ⚠️ Error guardando wallet URL:', saveError.message);
    }
  } else {
    console.warn('[createUserAndIssue] ⚠️ No se pudo crear Google Wallet, solo disponible Apple Wallet');
  }

  /* ====== 11. CONSTRUIR RESPUESTA CON PWA ====== */
  const pwaUrls = pwaWalletService.buildPwaUrls(serial_number);
  
  const response = {
    user: {
      id: user.id,
      business_id: user.business_id,
      card_detail_id: user.card_detail_id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      points: user.points || 0,
      serial_number,
      apple_auth_token,
      apple_pass_type_id,
      loyalty_account_id,
      card_type: finalCardType,
      variant: finalCardType
    },
    wallet: {
      google_save_url: google_save_url || null,
      google_object_id: googleObjectId || null,
      apple_pkpass_url,
      apple_auth_header: `ApplePass ${apple_auth_token}`,
      google_method: google_save_url ? (googleObjectId ? 'rest_api' : 'jwt') : null,
      pwa_wallet_url: pwaUrls.pwa,
      pwa_install_url: pwaUrls.install,
      pwa_share_url: pwaUrls.share
    }
  };

  /* ====== 12. AGREGAR INFO DE STRIPS Y MULTI-TIER ====== */
  if (finalCardType === 'strips') {
    response.user.strips_collected = user.strips_collected || 0;
    response.user.strips_required = user.strips_required;
    response.user.reward_title = user.reward_title;
    response.user.reward_description = user.reward_description;
    
    // Info básica de strips
    response.strips_info = {
      required: user.strips_required,
      collected: user.strips_collected || 0,
      reward: user.reward_title,
      isComplete: false
    };
    
    //  INFO DE MULTI-TIER (si aplica)
    if (isMultiTier && rewardConfig) {
      response.reward_system = {
        type: 'multi-tier',
        enabled: true,
        total_levels: rewardConfig.multiTier.rewards.length,
        all_rewards: rewardConfig.multiTier.rewards,
        current_tier: tierInfo
      };
    } else if (rewardConfig?.type === 'single') {
      // Sistema single
      response.reward_system = {
        type: 'single',
        enabled: true,
        strips_required: effectiveStripsRequired,
        reward_title: effectiveRewardTitle,
        reward_description: effectiveRewardDescription
      };
    }
    
  } else {
    // Tarjeta de puntos
    if (tier) response.user.tier = tier;
    if (since) response.user.since = since;
  }

  console.log('[createUserAndIssue] ✓ Proceso completado:', {
    userId: user.id,
    cardType: finalCardType,
    rewardSystemType: rewardConfig?.type || 'none',
    isMultiTier,
    currentLevel: tierInfo?.currentLevel,
    hasGoogleUrl: !!google_save_url,
    hasAppleUrl: !!apple_pkpass_url,
    hasPwaUrl: !!pwaUrls.pwa
  });

  return response;
};

/* ====================== CAMBIAR DISEÑO DE USUARIO ====================== */
const changeUserDesignProcess = async ({ user_id, card_detail_id }) => {
  const user = await usersService.getOneUser(user_id);
  if (!user) {
    const err = new Error('Usuario no existe');
    err.statusCode = 404;
    throw err;
  }

  const design = await carddetailService.getOneCardDetails(card_detail_id);
  if (!design || Number(design.business_id) !== Number(user.business_id)) {
    const err = new Error('card_detail_id inválido para el negocio del usuario');
    err.statusCode = 400;
    throw err;
  }

  await usersService.updateUser(user.id, {
    card_detail_id: design.id,
    updated_at: new Date()
  });

  return true;
};

module.exports = {
  createUserAndIssueProcess,
  changeUserDesignProcess
};