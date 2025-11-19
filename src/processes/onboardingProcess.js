// processes/onboardingProcess.js
const crypto = require('crypto');

const usersService      = require('../services/usersService');
const businessService   = require('../services/businessService');
const carddetailService = require('../services/carddetailService');

// IMPORTS CORREGIDOS - Importar funciones específicas
const { 
  issueGoogleWalletLink,      // JWT legacy (más confiable para crear)
  createGoogleWalletObject,   // REST API
  issueGoogleWallet           // Wrapper unificado
} = require('../processes/walletProcess');

// ✅ NUEVO: Import para PWA URLs
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

/* ====================== HELPERS PARA DESENROLLAR DISEÑOS ====================== */
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

    console.log('[pickDesign] check', {
      input_business_id: bizId,
      input_card_detail_id: id,
      got_row: !!raw,
      unwrapped: !!design,
      keys: Object.keys(design || {}),
      row_business_id: design?.business_id
    });

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

  console.log('[pickDesign] fallback-first', {
    bizId,
    count: Array.isArray(list) ? list.length : 0,
    first: first?.id
  });

  if (!first) {
    const err = new Error('El negocio no tiene diseños de tarjeta');
    err.statusCode = 400;
    throw err;
  }
  return first;
};

/* ====================== PROCESO PRINCIPAL ====================== */
const createUserAndIssueProcess = async ({ 
  business_id, 
  name, 
  email, 
  phone, 
  card_detail_id, 
  points,
  variant,
  cardType,
  stripsRequired = 10,
  rewardTitle,
  rewardDescription,
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

  console.log('[createUserAndIssue] Tipo de tarjeta determinado:', {
    input_variant: variant,
    input_cardType: cardType,
    final_cardType: finalCardType
  });

  if (finalCardType === 'strips' && !rewardTitle) {
    const err = new Error('rewardTitle es obligatorio para tarjetas de strips');
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

  /* ====== 3. IDENTIFICADORES DEL PASE ====== */
  const serial_number = crypto.randomUUID();
  const apple_auth_token = crypto.randomBytes(16).toString('hex');
  
  const typeIdFromEnv = process.env.PASS_TYPE_IDENTIFIER;
  if (!typeIdFromEnv || !/^pass\./.test(typeIdFromEnv)) {
    throw new Error('PASS_TYPE_IDENTIFIER no configurado o inválido (debe iniciar con "pass.")');
  }
  const apple_pass_type_id = typeIdFromEnv;

  const loyalty_account_id = `CARD-${business_id}-${serial_number.slice(0, 8).toUpperCase()}`;

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

  /* ====== 4. PREPARAR DATOS PARA CREAR USUARIO ====== */
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
    userData.strips_required = stripsRequired || 10;
    userData.reward_title = rewardTitle;
    userData.reward_description = rewardDescription || null;
    userData.reward_unlocked = false;
  }

  console.log('[createUserAndIssue] userData preparado:', {
    card_type: userData.card_type,
    strips_required: userData.strips_required,
    reward_title: userData.reward_title,
    points: userData.points
  });

  /* ====== 5. CREAR USUARIO EN BD ====== */
  const user = await usersService.createUser(userData);
  
  console.log('[createUserAndIssue] Usuario creado:', { 
    id: user.id, 
    email: user.email, 
    card_type: user.card_type,
    strips_required: user.strips_required,
    points: user.points
  });

  if (finalCardType === 'strips' && !user.card_type) {
    console.error('[CRITICAL] Usuario creado sin card_type, revisar usersService.createUser');
  }

  /* ====== 6. EMITIR WALLETS ====== */
  
  // 6.1) Google Wallet - CORREGIDO CON JWT (más confiable)
  console.log('[createUserAndIssue] Creando Google Wallet:', {
    cardCode: serial_number,
    variant: finalCardType,
    strips_collected: finalCardType === 'strips' ? 0 : undefined,
    strips_required: finalCardType === 'strips' ? (userData.strips_required || 10) : undefined
  });

  let google_save_url = null;
  let googleObjectId = null;
  
  try {
    // MÉTODO 1: Intentar con REST API primero (permite actualizaciones)
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
      strips_required: finalCardType === 'strips' ? (userData.strips_required || 10) : undefined,
      reward_title: finalCardType === 'strips' ? userData.reward_title : undefined,
      isComplete: false,
      colors: colors || {
        background: design.background_color || biz.background_color || '#2d3436',
        foreground: design.foreground_color || biz.foreground_color || '#E6E6E6'
      },
      barcode: barcode || { type: 'qr' }, 
    });

    googleObjectId = googleResult.objectId;
    google_save_url = `https://pay.google.com/gp/v/save/${encodeURIComponent(googleObjectId)}`;
    
    console.log('[createUserAndIssue] ✓ Google Wallet REST API exitoso:', {
      objectId: googleObjectId,
      url: google_save_url,
      existed: googleResult.existed
    });
    
  } catch (restApiError) {
    console.error('[createUserAndIssue] ❌ REST API falló:', {
      message: restApiError.message,
      stack: restApiError.stack?.split('\n').slice(0, 3).join('\n')
    });
    
    // MÉTODO 2: Fallback a JWT (más confiable pero no permite actualizaciones)
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
        strips_required: finalCardType === 'strips' ? (userData.strips_required || 10) : undefined,
        reward_title: finalCardType === 'strips' ? userData.reward_title : undefined,
        isComplete: false,
        colors: colors || {
          background: design.background_color || biz.background_color || '#2d3436',
          foreground: design.foreground_color || biz.foreground_color || '#E6E6E6'
        },
        barcode: barcode || { type: 'qr' }
      });
      
      console.log('[createUserAndIssue] ✓ JWT fallback exitoso:', {
        url: google_save_url,
        method: 'jwt'
      });
      
    } catch (jwtError) {
      console.error('[createUserAndIssue] ❌ JWT fallback también falló:', {
        message: jwtError.message
      });
      google_save_url = null;
    }
  }

  // 6.2) Apple Wallet - URL para obtener el .pkpass
  const base = process.env.PUBLIC_BASE_URL || process.env.WALLET_BASE_URL || '';
  const typeId = process.env.PASS_TYPE_IDENTIFIER;
  const apple_pkpass_url = `${base}/api/v1/wallets/v1/passes/${encodeURIComponent(typeId)}/${serial_number}`;

  console.log('[createUserAndIssue] URLs generadas:', {
    google: google_save_url ? '✓' : '✗',
    apple: apple_pkpass_url ? '✓' : '✗'
  });

  /* ====== 7. GUARDAR URL DE GOOGLE WALLET ====== */
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

  /* ====== 8. CONSTRUIR RESPUESTA CON PWA ====== */
  
  // ✅ NUEVO: Construir URLs de PWA
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
      card_detail_id: design.id,
      loyalty_account_id,
      card_type: finalCardType,
      variant: finalCardType
    },
    wallet: {
      // Wallets nativos
      google_save_url: google_save_url || null,
      google_object_id: googleObjectId || null,
      apple_pkpass_url,
      apple_auth_header: `ApplePass ${apple_auth_token}`,
      google_method: google_save_url ? (googleObjectId ? 'rest_api' : 'jwt') : null,
      
      // ✅ NUEVO: PWA (funciona en todos los dispositivos)
      pwa_wallet_url: pwaUrls.pwa,
      pwa_install_url: pwaUrls.install,
      pwa_share_url: pwaUrls.share
    }
  };

  if (finalCardType === 'strips') {
    response.user.strips_collected = user.strips_collected || 0;
    response.user.strips_required = user.strips_required || stripsRequired || 10;
    response.user.reward_title = user.reward_title || rewardTitle;
    response.user.reward_description = user.reward_description || rewardDescription;
    
    response.strips_info = {
      required: user.strips_required || stripsRequired || 10,
      collected: user.strips_collected || 0,
      reward: user.reward_title || rewardTitle,
      isComplete: false
    };
  } else {
    if (tier) response.user.tier = tier;
    if (since) response.user.since = since;
  }

  console.log('[createUserAndIssue] ✅ Proceso completado:', {
    userId: user.id,
    cardType: finalCardType,
    hasGoogleUrl: !!google_save_url,
    hasAppleUrl: !!apple_pkpass_url,
    hasPwaUrl: !!pwaUrls.pwa, // ✅ Nuevo
    googleObjectId: googleObjectId || 'N/A'
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

  console.log('[changeUserDesign] Diseño actualizado:', {
    userId: user.id,
    oldDesignId: user.card_detail_id,
    newDesignId: design.id
  });

  return true;
};

module.exports = {
  createUserAndIssueProcess,
  changeUserDesignProcess
};

/* ====================== CHANGELOG PWA ====================== 

CAMBIOS REALIZADOS (4 líneas):
1. Línea ~15: Agregado import de pwaWalletService
2. Línea ~335: Construcción de URLs PWA con buildPwaUrls()
3. Líneas ~350-352: Agregadas 3 propiedades en response.wallet
4. Línea ~373: Actualizado log final con hasPwaUrl

*/