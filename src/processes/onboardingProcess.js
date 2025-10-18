// processes/onboardingProcess.js
const crypto = require('crypto');

const usersService      = require('../services/usersService');
const businessService   = require('../services/businessService');
const carddetailService = require('../services/carddetailService');
const walletProcess     = require('../processes/walletProcess');

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
  // Caso ideal: objeto plano ya con columnas
  if ('business_id' in row || 'design_json' in row) return row;

  // Casos envueltos comunes
  if (row.design && (row.design.business_id != null || row.design.design_json != null)) return row.design;
  if (Array.isArray(row.rows) && row.rows.length) return unwrapDesignRow(row.rows[0]);
  if (row.data && (row.data.business_id != null || row.data.design_json != null)) return row.data;

  // design_json como string -> parsea
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
      row_business_id: design?.business_id,
      row_json_businessId: design?.design_json?.businessId
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

  // Sin card_detail_id: toma el primero del negocio
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
  // Parámetros de strips
  stripsRequired = 10,
  rewardTitle,
  rewardDescription,
  // Parámetros opcionales para wallets
  colors,
  barcode,
  tier,
  since
}) => {
  
  /* ====== 1. DETERMINAR TIPO DE TARJETA ====== */
  let finalCardType = 'points'; // Default
  
  if (cardType) {
    finalCardType = cardType.toLowerCase().trim();
  } else if (variant) {
    finalCardType = variant.toLowerCase().trim();
  }

  // Validar variante
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

  // Validación específica para strips
  if (finalCardType === 'strips' && !rewardTitle) {
    const err = new Error('rewardTitle es obligatorio para tarjetas de strips');
    err.statusCode = 400;
    throw err;
  }

  /* ====== 2. VALIDACIONES DE NEGOCIO Y DISEÑO ====== */
  const biz = await ensureBusiness(business_id);
  const design = await pickDesign(business_id, card_detail_id);

  // Saneamiento básico
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

  // Validaciones de longitud
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
  // Inicializar puntos solo si es tarjeta de puntos
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
    design_variant: finalCardType // Para compatibilidad
  };

  // Agregar campos específicos de strips
  if (finalCardType === 'strips') {
    userData.strips_collected = 0;
    userData.strips_required = stripsRequired || 10;
    userData.reward_title = rewardTitle;
    userData.reward_description = rewardDescription || null;
    userData.reward_unlocked = false;
  }

  console.log('[createUserAndIssue] userData preparado:', {
    card_type: userData.card_type,
    design_variant: userData.design_variant,
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

  // Verificación crítica
  if (finalCardType === 'strips' && !user.card_type) {
    console.error('[CRITICAL] Usuario creado sin card_type, revisar usersService.createUser');
  }

  /* ====== 6. EMITIR WALLETS ====== */
  
  // 6.1) Google Wallet - Usar método REST API actualizado
  console.log('[createUserAndIssue] Creando Google Wallet:', {
    cardCode: serial_number,
    variant: finalCardType,
    strips_collected: finalCardType === 'strips' ? 0 : undefined,
    strips_required: finalCardType === 'strips' ? (userData.strips_required || 10) : undefined
  });

  let google_save_url;
  try {
    // Usar el nuevo método unificado con REST API
    const googleResult = await walletProcess.issueGoogleWallet({
      cardCode: serial_number,
      userName: user.name,
      programName: biz.name || 'Loyalty Program',
      businessId: business_id,
      variant: finalCardType,
      points: initial_points,
      tier: tier || (finalCardType === 'points' ? 'Bronce' : undefined),
      since: since || new Date().toISOString().slice(0, 10),
      // Parámetros de strips
      strips_collected: finalCardType === 'strips' ? 0 : undefined,
      strips_required: finalCardType === 'strips' ? (userData.strips_required || 10) : undefined,
      reward_title: finalCardType === 'strips' ? userData.reward_title : undefined,
      isComplete: false,
      // Opciones adicionales
      colors: colors || {
        background: design.background_color || biz.background_color || '#2d3436',
        foreground: design.foreground_color || biz.foreground_color || '#E6E6E6'
      },
      barcode: barcode || { type: 'qr' },
      useRestApi: true // Usar REST API por defecto
    });

    google_save_url = googleResult.url;
    
    console.log('[createUserAndIssue] Google Wallet creado:', {
      url: google_save_url,
      objectId: googleResult.objectId,
      method: googleResult.method
    });
  } catch (googleError) {
    console.error('[createUserAndIssue] Error creando Google Wallet:', googleError);
    // No fallar todo el proceso, solo logear el error
    google_save_url = null;
  }

  // 6.2) Apple Wallet - URL para obtener el .pkpass
  const base = process.env.PUBLIC_BASE_URL || process.env.WALLET_BASE_URL || '';
  const typeId = process.env.PASS_TYPE_IDENTIFIER;
  const apple_pkpass_url = `${base}/api/v1/wallets/v1/passes/${encodeURIComponent(typeId)}/${serial_number}`;

  /* ====== 7. GUARDAR URL DE GOOGLE WALLET ====== */
  if (google_save_url) {
    try {
      await usersService.saveUserWallet({
        userId: user.id,
        loyalty_account_id,
        wallet_url: google_save_url
      });
    } catch (saveError) {
      console.error('[createUserAndIssue] Error guardando wallet URL:', saveError);
      // No fallar todo el proceso
    }
  }

  /* ====== 8. CONSTRUIR RESPUESTA ====== */
  const response = {
    user: {
      id: user.id,
      business_id: user.business_id,
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
      variant: finalCardType // Para compatibilidad
    },
    wallet: {
      google_save_url: google_save_url || null,
      apple_pkpass_url,
      apple_auth_header: `ApplePass ${apple_auth_token}`
    }
  };

  // Agregar información específica según el tipo de tarjeta
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
    // Tarjeta de puntos - incluir tier si existe
    if (tier) {
      response.user.tier = tier;
    }
    if (since) {
      response.user.since = since;
    }
  }

  console.log('[createUserAndIssue] Proceso completado:', {
    userId: user.id,
    cardType: finalCardType,
    hasGoogleUrl: !!google_save_url,
    hasAppleUrl: !!apple_pkpass_url
  });

  return response;
};

/* ====================== CAMBIAR DISEÑO DE USUARIO ====================== */
const changeUserDesignProcess = async ({ user_id, card_detail_id }) => {
  // Carga user
  const user = await usersService.getOneUser(user_id);
  if (!user) {
    const err = new Error('Usuario no existe');
    err.statusCode = 404;
    throw err;
  }

  // Valida nuevo diseño contra su negocio
  const design = await carddetailService.getOneCardDetails(card_detail_id);
  if (!design || Number(design.business_id) !== Number(user.business_id)) {
    const err = new Error('card_detail_id inválido para el negocio del usuario');
    err.statusCode = 400;
    throw err;
  }

  // Actualiza y marca updated_at para que iOS refresque
  await usersService.updateUser(user.id, {
    card_detail_id: design.id,
    updated_at: new Date()
  });

  console.log('[changeUserDesign] Diseño actualizado:', {
    userId: user.id,
    oldDesignId: user.card_detail_id,
    newDesignId: design.id
  });

  // TODO: Notificar APNs para refrescar
  // await walletProcess.pushRefresh(user.serial_number);

  return true;
};

module.exports = {
  createUserAndIssueProcess,
  changeUserDesignProcess
};

/* ====================== EJEMPLOS DE USO ====================== 

═══════════════════════════════════════════════════════════════════════
CREAR USUARIO CON TARJETA DE PUNTOS
═══════════════════════════════════════════════════════════════════════

const result = await createUserAndIssueProcess({
  business_id: 1,
  name: "Juan Pérez",
  email: "juan@example.com",
  phone: "123456789",
  card_detail_id: 5,
  variant: "points",
  points: 100,
  tier: "Oro",
  since: "2024-01-15",
  colors: {
    background: "#2d3436",
    foreground: "#E6E6E6"
  }
});

Respuesta:
{
  "user": {
    "id": 123,
    "business_id": 1,
    "name": "Juan Pérez",
    "email": "juan@example.com",
    "phone": "123456789",
    "points": 100,
    "serial_number": "a1b2c3d4-...",
    "apple_auth_token": "abc123...",
    "apple_pass_type_id": "pass.mx.windoe.loyalty",
    "card_detail_id": 5,
    "loyalty_account_id": "CARD-1-A1B2C3D4",
    "card_type": "points",
    "variant": "points",
    "tier": "Oro",
    "since": "2024-01-15"
  },
  "wallet": {
    "google_save_url": "https://pay.google.com/gp/v/save/...",
    "apple_pkpass_url": "https://api.example.com/api/v1/wallets/v1/passes/...",
    "apple_auth_header": "ApplePass abc123..."
  }
}

═══════════════════════════════════════════════════════════════════════
CREAR USUARIO CON TARJETA DE STRIPS
═══════════════════════════════════════════════════════════════════════

const result = await createUserAndIssueProcess({
  business_id: 9,
  name: "test strip",
  email: "test@test.com",
  phone: "123456789",
  card_detail_id: 11,
  variant: "strips",
  stripsRequired: 8,
  rewardTitle: "Café Gratis",
  rewardDescription: "Un café americano gratis por completar tu colección"
});

Respuesta:
{
  "user": {
    "id": 41,
    "business_id": 9,
    "name": "test strip",
    "email": "test@test.com",
    "phone": "123456789",
    "points": 0,
    "serial_number": "a17d8458-a192-4a1b-a25b-c05a96a8d6ed",
    "apple_auth_token": "bda614fc69b91f94976bc53667fbd015",
    "apple_pass_type_id": "pass.mx.windoe.loyalty",
    "card_detail_id": 11,
    "loyalty_account_id": "CARD-9-A17D8458",
    "card_type": "strips",
    "variant": "strips",
    "strips_collected": 0,
    "strips_required": 8,
    "reward_title": "Café Gratis",
    "reward_description": "Un café americano gratis por completar tu colección"
  },
  "wallet": {
    "google_save_url": "https://pay.google.com/gp/v/save/...",
    "apple_pkpass_url": "https://wallet-app-backend.fly.dev/api/v1/wallets/v1/passes/...",
    "apple_auth_header": "ApplePass bda614fc69b91f94976bc53667fbd015"
  },
  "strips_info": {
    "required": 8,
    "collected": 0,
    "reward": "Café Gratis",
    "isComplete": false
  }
}

═══════════════════════════════════════════════════════════════════════
CAMBIAR DISEÑO DE TARJETA EXISTENTE
═══════════════════════════════════════════════════════════════════════

const result = await changeUserDesignProcess({
  user_id: 123,
  card_detail_id: 10
});

Respuesta: true

*/