// controllers/onboardingController.js
const { 
  createUserAndIssueProcess, 
  changeUserDesignProcess 
} = require('../processes/onboardingProcess');

/* ====================== HELPERS ====================== */
function toBufferFromBase64(data) {
  if (!data) return undefined;
  const m = String(data).match(/^data:image\/\w+;base64,(.+)$/);
  const b64 = m ? m[1] : data;
  return Buffer.from(b64, 'base64');
}

/* ====================== CREAR USUARIO Y EMITIR TARJETA (UNIFICADO) ====================== */
/**
 * Endpoint unificado que crea usuario y emite tarjeta (points o strips)
 * Mantiene compatibilidad con código anterior y agrega nuevas funcionalidades
 */
const createUserAndIssue = async (req, res) => {
  try {
    const {
      // Datos básicos del usuario
      business_id,
      name,
      email,
      phone,
      card_detail_id,
      
      // Tipo de tarjeta
      variant,
      cardType,
      
      // Parámetros para tarjeta de POINTS
      points,
      tier,
      since,
      
      // Parámetros para tarjeta de STRIPS
      stripsRequired,
      rewardTitle,
      rewardDescription,
      
      // Opcionales (diseño)
      colors,
      barcode,
      stripBase64
    } = req.body || {};

    // Validaciones básicas
    if (!business_id || !name || !email) {
      return res.status(400).json({ 
        error: 'business_id, name y email son obligatorios' 
      });
    }

    // Determinar tipo de tarjeta (prioridad: cardType > variant > default)
    let finalVariant = 'points'; // Default
    if (cardType) {
      finalVariant = cardType.toLowerCase().trim();
    } else if (variant) {
      finalVariant = variant.toLowerCase().trim();
    }

    // Validar variante
    if (finalVariant !== 'points' && finalVariant !== 'strips') {
      return res.status(400).json({ 
        error: 'variant/cardType debe ser "points" o "strips"' 
      });
    }

    // Validación específica para strips
    if (finalVariant === 'strips' && !rewardTitle) {
      return res.status(400).json({ 
        error: 'rewardTitle es obligatorio para tarjetas de strips' 
      });
    }

    console.log('[createUserAndIssue] Request:', {
      business_id,
      email,
      variant: finalVariant,
      points: finalVariant === 'points' ? points : undefined,
      stripsRequired: finalVariant === 'strips' ? stripsRequired : undefined
    });

    // Procesar archivos de strips (multer)
    const strip_on  = req.files?.strip_on?.[0]?.buffer || null;
    const strip_off = req.files?.strip_off?.[0]?.buffer || null;

    // Llamar al proceso unificado
    const result = await createUserAndIssueProcess({
      business_id: Number(business_id),
      name,
      email,
      phone,
      card_detail_id: card_detail_id != null ? Number(card_detail_id) : undefined,
      
      // Tipo de tarjeta
      variant: finalVariant,
      cardType: finalVariant,
      
      // Parámetros de points
      points: finalVariant === 'points' && isFinite(Number(points)) 
        ? Number(points) 
        : (finalVariant === 'points' ? 0 : undefined),
      tier: finalVariant === 'points' ? tier : undefined,
      since: finalVariant === 'points' ? since : undefined,
      
      // Parámetros de strips
      stripsRequired: finalVariant === 'strips' && isFinite(Number(stripsRequired))
        ? Number(stripsRequired)
        : (finalVariant === 'strips' ? 10 : undefined),
      rewardTitle: finalVariant === 'strips' ? rewardTitle : undefined,
      rewardDescription: finalVariant === 'strips' ? rewardDescription : undefined,
      
      // Opcionales
      colors,
      barcode,
      strip_base64: stripBase64 || undefined,
      strip_buffers: { on: strip_on, off: strip_off }
    });

    console.log('[createUserAndIssue] Success:', {
      userId: result.user.id,
      cardType: result.user.card_type,
      hasGoogleUrl: !!result.wallet.google_save_url,
      hasAppleUrl: !!result.wallet.apple_pkpass_url
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error('[createUserAndIssue] Error:', err);
    return res.status(err.statusCode || 500).json({ 
      error: err.message || 'Server error' 
    });
  }
};

/* ====================== CREAR USUARIO CON TARJETA DE STRIPS (ENDPOINT ESPECÍFICO) ====================== */
/**
 * Endpoint específico para crear tarjetas de strips
 * Mantiene compatibilidad con código existente
 */
const createUserAndIssueStrips = async (req, res) => {
  try {
    const {
      business_id,
      name,
      email,
      phone,
      card_detail_id,
      stripsRequired = 10,
      rewardTitle,
      rewardDescription,
      variant,
      colors,
      barcode
    } = req.body || {};

    // Validaciones básicas
    if (!business_id || !name || !email) {
      return res.status(400).json({ 
        error: 'business_id, name y email son obligatorios' 
      });
    }

    if (!rewardTitle) {
      return res.status(400).json({ 
        error: 'rewardTitle es obligatorio para tarjetas de strips' 
      });
    }

    // Validar que variant sea strips (si se proporciona)
    if (variant && variant !== 'strips') {
      return res.status(400).json({ 
        error: 'Este endpoint solo acepta variant: "strips"' 
      });
    }

    console.log('[createUserAndIssueStrips] Request:', {
      business_id,
      email,
      stripsRequired,
      rewardTitle
    });

    // Llamar al proceso con parámetros de strips
    const result = await createUserAndIssueProcess({
      business_id: Number(business_id),
      name,
      email,
      phone,
      card_detail_id: card_detail_id != null ? Number(card_detail_id) : undefined,
      variant: 'strips',
      cardType: 'strips',
      stripsRequired: Number(stripsRequired),
      rewardTitle,
      rewardDescription,
      colors,
      barcode
    });

    console.log('[createUserAndIssueStrips] Success:', {
      userId: result.user.id,
      strips_required: result.user.strips_required,
      reward_title: result.user.reward_title
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error('[createUserAndIssueStrips] Error:', err);
    return res.status(err.statusCode || 500).json({ 
      error: err.message || 'Server error' 
    });
  }
};

/* ====================== CREAR USUARIO CON TARJETA DE POINTS (ENDPOINT ESPECÍFICO - NUEVO) ====================== */
/**
 * Endpoint específico para crear tarjetas de puntos
 */
const createUserAndIssuePoints = async (req, res) => {
  try {
    const {
      business_id,
      name,
      email,
      phone,
      card_detail_id,
      points = 0,
      tier,
      since,
      variant,
      colors,
      barcode
    } = req.body || {};

    // Validaciones básicas
    if (!business_id || !name || !email) {
      return res.status(400).json({ 
        error: 'business_id, name y email son obligatorios' 
      });
    }

    // Validar que variant sea points (si se proporciona)
    if (variant && variant !== 'points') {
      return res.status(400).json({ 
        error: 'Este endpoint solo acepta variant: "points"' 
      });
    }

    console.log('[createUserAndIssuePoints] Request:', {
      business_id,
      email,
      points,
      tier
    });

    // Llamar al proceso con parámetros de points
    const result = await createUserAndIssueProcess({
      business_id: Number(business_id),
      name,
      email,
      phone,
      card_detail_id: card_detail_id != null ? Number(card_detail_id) : undefined,
      variant: 'points',
      cardType: 'points',
      points: isFinite(Number(points)) ? Number(points) : 0,
      tier,
      since,
      colors,
      barcode
    });

    console.log('[createUserAndIssuePoints] Success:', {
      userId: result.user.id,
      points: result.user.points,
      tier: result.user.tier
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error('[createUserAndIssuePoints] Error:', err);
    return res.status(err.statusCode || 500).json({ 
      error: err.message || 'Server error' 
    });
  }
};

/* ====================== CAMBIAR DISEÑO DE TARJETA ====================== */
/**
 * Cambiar el diseño de una tarjeta existente
 * Sin cambios - mantiene funcionalidad original
 */
const changeUserDesign = async (req, res) => {
  try {
    const { userId } = req.params;
    const { card_detail_id } = req.body || {};

    if (!card_detail_id) {
      return res.status(400).json({ 
        error: 'card_detail_id es requerido' 
      });
    }

    console.log('[changeUserDesign] Request:', {
      userId,
      card_detail_id
    });

    await changeUserDesignProcess({
      user_id: Number(userId),
      card_detail_id: Number(card_detail_id)
    });

    console.log('[changeUserDesign] Success:', {
      userId,
      newDesignId: card_detail_id
    });

    return res.json({ 
      ok: true,
      message: 'Diseño actualizado exitosamente'
    });
  } catch (err) {
    console.error('[changeUserDesign] Error:', err);
    return res.status(err.statusCode || 500).json({ 
      error: err.message || 'Server error' 
    });
  }
};

module.exports = {
  createUserAndIssue,           // Endpoint unificado (mantiene compatibilidad + nuevas features)
  createUserAndIssueStrips,     // Endpoint específico para strips (mantiene compatibilidad)
  createUserAndIssuePoints,     // Endpoint específico para points (NUEVO)
  changeUserDesign              // Sin cambios
};

/* ====================== GUÍA DE MIGRACIÓN ====================== 

═══════════════════════════════════════════════════════════════════════
CÓDIGO EXISTENTE (sigue funcionando sin cambios)
═══════════════════════════════════════════════════════════════════════

Request anterior:
POST /api/onboarding/create
{
  "business_id": 1,
  "name": "Usuario",
  "email": "test@test.com",
  "points": 100,
  "variant": "points"
}

✅ Sigue funcionando exactamente igual

═══════════════════════════════════════════════════════════════════════
NUEVO - TARJETA DE STRIPS
═══════════════════════════════════════════════════════════════════════

Request nuevo:
POST /api/onboarding/create
{
  "business_id": 9,
  "name": "test strip",
  "email": "test@test.com",
  "phone": "123456789",
  "card_detail_id": 11,
  "variant": "strips",
  "stripsRequired": 8,
  "rewardTitle": "Café Gratis",
  "rewardDescription": "Un café americano gratis por completar tu colección"
}

Response esperado:
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
ENDPOINTS ESPECÍFICOS (OPCIONALES)
═══════════════════════════════════════════════════════════════════════

// Para strips específicamente
POST /api/onboarding/create-strips
{
  "business_id": 9,
  "name": "test strip",
  "email": "test@test.com",
  "stripsRequired": 8,
  "rewardTitle": "Café Gratis"
}

// Para points específicamente
POST /api/onboarding/create-points
{
  "business_id": 1,
  "name": "Juan",
  "email": "juan@test.com",
  "points": 100,
  "tier": "Oro"
}

═══════════════════════════════════════════════════════════════════════
COMPATIBILIDAD GARANTIZADA
═══════════════════════════════════════════════════════════════════════

✅ Código anterior funciona sin modificaciones
✅ Nuevas funcionalidades son opcionales
✅ Default sigue siendo "points" si no se especifica
✅ Validaciones específicas por tipo
✅ Mensajes de error claros

*/