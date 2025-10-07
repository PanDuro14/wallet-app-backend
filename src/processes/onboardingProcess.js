// processes/onboardingProcess.js
const crypto = require('crypto');

const usersService      = require('../services/usersService');
const businessService   = require('../services/businessService');
const carddetailService = require('../services/carddetailService');
const walletProcess     = require('../processes/walletProcess'); // ya lo tienes: issueGoogleWalletLink / issueAppleWalletPkpass

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

// ===== helpers para “desenrollar” lo que devuelva el service =====
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

// ===== reemplaza tu pickDesign por este =====
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

    console.log('[pickDesign] v4 check', {
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

  console.log('[pickDesign] v4 fallback-first', {
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


// En src/processes/onboardingProcess.js
// Modificar la función createUserAndIssueProcess

const createUserAndIssueProcess = async ({ 
  business_id, name, email, phone, card_detail_id, points,
  variant,
  // Nuevos parámetros para strips unificado
  cardType,
  stripsRequired = 10,
  rewardTitle,
  rewardDescription
}) => {
  
  // ====== DETERMINAR TIPO DE TARJETA ======
  let finalCardType = 'points'; // Default es points
  
  if (cardType) {
    // Nuevo sistema: cardType directo
    finalCardType = cardType;
  } else if (variant) {
    // Sistema existente: mapear variant a cardType
    finalCardType = variant === 'strips' ? 'strips' : 'points';
  }
  console.log('[Variante recibida: 1 ] Variante en finalCardType', finalCardType); 

  console.log('[createUserAndIssue] Tipo de tarjeta determinado:', {
    input_variant: variant,
    input_cardType: cardType,
    final_cardType: finalCardType
  });

  // Inicializar los puntos si es "points"
  const initial_points = finalCardType === 'points' ? (points || 0) : 0;

  // 1) Validaciones de negocio y diseño
  const biz = await ensureBusiness(business_id);
  const design = await pickDesign(business_id, card_detail_id);

  // Saneamiento básico
  name  = (name ?? '').toString().trim();
  email = (email ?? '').toString().trim();
  phone = (phone ?? '').toString().trim() || null;

  // 2) Identificadores del pase
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
    if (v != null && String(v).length > n) throw new Error(`${field} demasiado largo (${String(v).length} > ${n})`);
  };
  assertLen(name, 255, 'name');
  assertLen(email, 255, 'email');
  assertLen(phone, 32, 'phone');
  assertLen(apple_pass_type_id, 255, 'apple_pass_type_id');
  assertLen(loyalty_account_id, 64, 'loyalty_account_id');

  // 3) Preparar los datos para crear el usuario
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
    // Campos nuevos para strips - IMPORTANTE: asegurar que se guarden
    card_type: finalCardType
  };

  // Solo agregar campos de strips si es necesario
  if (finalCardType === 'strips') {
    userData.strips_collected = 0;
    userData.strips_required = stripsRequired;
    userData.reward_title = rewardTitle;
    userData.reward_description = rewardDescription;
    userData.reward_unlocked = false;
  }

  // Si viene variant, agregarlo para compatibilidad
  if (variant) {
    userData.design_variant = variant;
  }

  console.log('[createUserAndIssue] userData preparado:', {
    card_type: userData.card_type,
    design_variant: userData.design_variant,
    strips_required: userData.strips_required,
    reward_title: userData.reward_title
  });

  // 4) Crear usuario en DB
  const user = await usersService.createUser(userData);
  console.log("[PROCESS] Usuario creado:", { 
    id: user.id, 
    email: user.email, 
    card_type: user.card_type,
    strips_required: user.strips_required 
  });

  // VERIFICAR que el usuario se creó correctamente
  if (finalCardType === 'strips' && !user.card_type) {
    console.error('[CRITICAL] Usuario creado sin card_type, revisar usersService.createUser');
  }

  // 5) Emitir artefactos de Wallet
  const google_save_url = await walletProcess.issueGoogleWalletLink({
    cardCode: serial_number,
    userName: user.name,
    programName: biz.name,
    businessId: business_id,
  });

  const base = process.env.PUBLIC_BASE_URL || process.env.WALLET_BASE_URL || '';
  const typeId = process.env.PASS_TYPE_IDENTIFIER; 
  const apple_pkpass_url = `${base}/api/v1/wallets/v1/passes/${encodeURIComponent(typeId)}/${serial_number}`;

  // 6) Guardar URL de Google Wallet
  await usersService.saveUserWallet({
    userId: user.id,
    loyalty_account_id,
    wallet_url: google_save_url
  });

  // Respuesta final
  const response = {
    user: {
      id: user.id,
      business_id: user.business_id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      points: user.points,
      serial_number,
      apple_auth_token,
      apple_pass_type_id,
      card_detail_id: design.id,
      loyalty_account_id,
      // Nuevos campos de strips
      card_type: finalCardType,
      // IMPORTANTE: usar finalCardType en lugar de user.card_type
      // por si acaso el DB no lo guardó correctamente
      variant: finalCardType  // Agregar este campo para compatibilidad
    },
    wallet: {
      google_save_url,
      apple_pkpass_url,
      apple_auth_header: `ApplePass ${apple_auth_token}`,
    },
  };

  // Agregar información de strips si es necesario
  if (finalCardType === 'strips') {
    response.user.strips_collected = user.strips_collected || 0;
    response.user.strips_required = user.strips_required || stripsRequired;
    response.user.reward_title = user.reward_title || rewardTitle;
    response.user.reward_description = user.reward_description || rewardDescription;
    response.strips_info = {
      required: user.strips_required || stripsRequired,
      collected: user.strips_collected || 0,
      reward: user.reward_title || rewardTitle,
      isComplete: false
    };
  }
  
  console.log('[Variante recibida: ] Variante en finalCardType', finalCardType); 
  return response;
};



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

    // Actualiza y marca updated_at para que iOS refresque (o para 304 logic)
    await usersService.updateUser(user.id, {
        card_detail_id: design.id,
        updated_at: new Date(),
    });

    // (Opcional) Notificar APNs para refrescar
    // Si tienes un helper en process o service para esto, llámalo aquí.
    // p.ej.: await walletProcess.pushRefresh(user.serial_number);

    return true;
};

module.exports = {
  createUserAndIssueProcess,
  changeUserDesignProcess,
};
