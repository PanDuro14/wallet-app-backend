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
const createUserAndIssue = async (req, res) => {
  try {
    const {
      business_id,
      name,
      email,
      phone,
      card_detail_id,
      variant,
      cardType,
      points,
      tier,
      since,
      // ❌ DEPRECATED: Ya no son obligatorios (se obtienen del design_json)
      stripsRequired,
      rewardTitle,
      rewardDescription,
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

    // Determinar tipo de tarjeta
    let finalVariant = 'points';
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

    // ✅ NUEVO: Ya NO validar rewardTitle aquí
    // La configuración viene del design_json del card_detail
    console.log('[createUserAndIssue] Request:', {
      business_id,
      email,
      variant: finalVariant,
      card_detail_id,
      has_reward_title: !!rewardTitle
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
      
      variant: finalVariant,
      cardType: finalVariant,
      
      // Parámetros de points
      points: finalVariant === 'points' && isFinite(Number(points)) 
        ? Number(points) 
        : (finalVariant === 'points' ? 0 : undefined),
      tier: finalVariant === 'points' ? tier : undefined,
      since: finalVariant === 'points' ? since : undefined,
      
      // ✅ Parámetros de strips (OPCIONALES - se usan solo si no hay design_json)
      stripsRequired: finalVariant === 'strips' && isFinite(Number(stripsRequired))
        ? Number(stripsRequired)
        : undefined,
      rewardTitle: finalVariant === 'strips' ? rewardTitle : undefined,
      rewardDescription: finalVariant === 'strips' ? rewardDescription : undefined,
      
      colors,
      barcode,
      strip_base64: stripBase64 || undefined,
      strip_buffers: { on: strip_on, off: strip_off }
    });

    console.log('[createUserAndIssue] Success:', {
      userId: result.user.id,
      cardType: result.user.card_type,
      rewardSystem: result.reward_system?.type
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

    // ✅ ACTUALIZADO: Solo validar rewardTitle si NO hay card_detail_id
    if (!card_detail_id && !rewardTitle) {
      return res.status(400).json({ 
        error: 'rewardTitle es obligatorio cuando no se especifica card_detail_id' 
      });
    }

    if (variant && variant !== 'strips') {
      return res.status(400).json({ 
        error: 'Este endpoint solo acepta variant: "strips"' 
      });
    }

    console.log('[createUserAndIssueStrips] Request:', {
      business_id,
      email,
      has_card_detail_id: !!card_detail_id,
      has_reward_title: !!rewardTitle
    });

    const result = await createUserAndIssueProcess({
      business_id: Number(business_id),
      name,
      email,
      phone,
      card_detail_id: card_detail_id != null ? Number(card_detail_id) : undefined,
      variant: 'strips',
      cardType: 'strips',
      stripsRequired: stripsRequired ? Number(stripsRequired) : undefined,
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

/* ====================== CREAR USUARIO CON TARJETA DE POINTS ====================== */
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

    if (!business_id || !name || !email) {
      return res.status(400).json({ 
        error: 'business_id, name y email son obligatorios' 
      });
    }

    if (variant && variant !== 'points') {
      return res.status(400).json({ 
        error: 'Este endpoint solo acepta variant: "points"' 
      });
    }

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

    return res.status(201).json(result);
  } catch (err) {
    console.error('[createUserAndIssuePoints] Error:', err);
    return res.status(err.statusCode || 500).json({ 
      error: err.message || 'Server error' 
    });
  }
};

/* ====================== CAMBIAR DISEÑO DE TARJETA ====================== */
const changeUserDesign = async (req, res) => {
  try {
    const { userId } = req.params;
    const { card_detail_id } = req.body || {};

    if (!card_detail_id) {
      return res.status(400).json({ 
        error: 'card_detail_id es requerido' 
      });
    }

    await changeUserDesignProcess({
      user_id: Number(userId),
      card_detail_id: Number(card_detail_id)
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
  createUserAndIssue,
  createUserAndIssueStrips,
  createUserAndIssuePoints,
  changeUserDesign
};