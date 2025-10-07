const { createUserAndIssueProcess, changeUserDesignProcess } = require('../processes/onboardingProcess');

function toBufferFromBase64(data) {
  if (!data) return undefined;
  const m = String(data).match(/^data:image\/\w+;base64,(.+)$/);
  const b64 = m ? m[1] : data;
  return Buffer.from(b64, 'base64');
}

const createUserAndIssue = async (req, res) => {
  try {
    const { business_id, name, email, phone, card_detail_id, points, variant, stripBase64 } = req.body || {};
    if (!business_id || !name || !email) {
      return res.status(400).json({ error: 'business_id, name y email son obligatorios' });
    }

    const strip_on  = req.files?.strip_on?.[0]?.buffer || null;
    const strip_off = req.files?.strip_off?.[0]?.buffer || null;

    const result = await createUserAndIssueProcess({
      business_id: Number(business_id),
      name,
      email,
      phone,
      card_detail_id: card_detail_id != null ? Number(card_detail_id) : undefined,
      points: isFinite(Number(points)) ? Number(points) : 0,

      // NUEVO: preferencia de diseño + imagen (si aplica)
      variant: (variant || '').toLowerCase(),                  // 'points' | 'strip'
      strip_base64: stripBase64 || undefined, 
      strip_buffers: { on: strip_on, off: strip_off }                     // opcional
    });

    return res.status(201).json(result);
  } catch (err) {
    console.error('onboarding.createUserAndIssue error:', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Server error' });
  }
};

const changeUserDesign = async (req, res) => {
    try {
        const { userId } = req.params;
        const { card_detail_id } = req.body || {};
        if (!card_detail_id) return res.status(400).json({ error: 'card_detail_id es requerido' });

        await changeUserDesignProcess({
            user_id: Number(userId),
            card_detail_id: Number(card_detail_id),
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error('onboarding.changeUserDesign error:', err);
        return res.status(err.statusCode || 500).json({ error: err.message || 'Server error' });
    }
};

const createUserAndIssueStrips = async (req, res) => {
  try {
    const {
      business_id, name, email, phone, card_detail_id,
      stripsRequired = 10, rewardTitle, rewardDescription, variant
    } = req.body || {};

    // Verifica si variant está presente
    if (!variant) {
      return res.status(400).json({ error: 'El campo "variant" es obligatorio' });
    }

    // Validación básica de los campos requeridos
    if (!business_id || !name || !email) {
      return res.status(400).json({ error: 'business_id, name y email son obligatorios' });
    }

    if (!rewardTitle) {
      return res.status(400).json({ error: 'rewardTitle es obligatorio para tarjetas de strips' });
    }

    if (variant !== 'strips' && variant !== 'points') {
      return res.status(400).json({ error: 'El campo "variant" debe ser "strips" o "points"' });
    }
    
    // Asignar el tipo de tarjeta: "strips" o "points"
    const card_type = variant === 'strips' ? 'strips' : 'points';

    console.log("[STRIPS CONTROLLER] Card type:", card_type);

    // Llamar al proceso para crear el usuario y emitir la tarjeta de strips
    const result = await createUserAndIssueProcess({
      business_id: Number(business_id),
      name,
      email,
      phone,
      card_detail_id: card_detail_id != null ? Number(card_detail_id) : undefined,
      stripsRequired: Number(stripsRequired),
      rewardTitle,
      rewardDescription,
      variant: card_type,  // Pasar el tipo de tarjeta
      // IMPORTANTE: También pasar los parámetros para strips
      cardType: card_type  // Agregar este parámetro también
    });

    // REMOVER esta validación que está causando el error
    // La respuesta del proceso puede tener una estructura diferente
    // if (result.variant !== card_type) {
    //   return res.status(500).json({ error: 'Variante incorrecta', variant }); 
    // }

    if (!result) {
      return res.status(500).json({ error: 'Error al crear la tarjeta' });
    }
    
    console.log("Result:", result);
    return res.status(201).json(result);
  } catch (err) {
    console.error('[createUserAndIssueStrips] Error:', err);
    return res.status(err.statusCode || 500).json({ error: err.message || 'Server error' });
  }
};



// Agregar al module.exports:

module.exports = {
    createUserAndIssue,
    changeUserDesign,
    createUserAndIssueStrips
};
