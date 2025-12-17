const carddetailProcess = require('../processes/carddetailsProcess'); 
const businessProcess = require('../processes/businessProcess'); 
const { normalizeBarcodeSpec } = require('../utils/design');
const carddetailService = require('../services/carddetailService');

const getAllCardDetails = async(req, res) => {
    try {
        const cardDetails = await carddetailProcess.getAllCardDetails(); 
        res.status(200).json(cardDetails); 
    } catch (error){
        res.status(502).json({ error: 'Error al obtener todas las tarjetas'}); 
    }
}


const getOneCardDetails = async(req, res) => {
    try {
        const {id} = req.params; 
        const cardDetails = await carddetailProcess.getOneCardDetails(id); 
        res.status(200).json(cardDetails); 
    } catch (error){
        res.status(502).json({ error: `Error al obtener la tarjeta ${id}`}); 
    }
}

const createOneCardDetails = async(req, res) => {
    try {
        const { 
            business_id, background_color, foreground_color, 
            pass_type_id, terms, created_at, updated_at
        } = req.body; 

        const business = await businessProcess.getOneBusiness(business_id); 
        if(!business) {
            return res.status(404).json({ error: 'El negocio con ID proporcionado no existe'}); 
        }

        const logoBuffer = req.files['logo'] ? req.files['logo'][0].buffer : null;
        const strip_imageBuffer = req.files['strip_image'] ? req.files['strip_image'][0].buffer : null;

        if(!business_id || !background_color || !foreground_color || !pass_type_id || !terms /*|| !created_at || !updated_at*/){
            res.status(400).json({ error: 'Datos faltantes'}); 
        }

        if (!logoBuffer || !strip_imageBuffer) {
            return res.status(400).json({ error: 'Se requieren las imágenes del logo y strip' });
        }

        const cardDetails = await carddetailProcess.createOneCardDetails(
            business_id, background_color, foreground_color, pass_type_id, terms, 
            logoBuffer, strip_imageBuffer, created_at, updated_at); 

        if(cardDetails){
            res.status(200).json({ message: `Tarjeta agregada al negocio ${cardDetails.business_id}`}); 
        } else {
            res.status(400).json({ error: 'Datos inválidos'}); 
        }
    } catch (error){
        res.status(502).json({ error: 'Error al crear un cardDetail '}); 
    }
}

const updateCardDetails = async(req, res) => {
     try {
        const { id } = req.params;
        const {
            business_id, background_color, foreground_color,
            pass_type_id, terms, created_at, updated_at
        } = req.body;

        const business = await businessProcess.getOneBusiness(business_id);
        if (!business) {
            return res.status(404).json({ error: 'El negocio con ID proporcionado no existe' });
        }

        const logoBuffer = req.files['logo'] ? req.files['logo'][0].buffer : null;
        const strip_imageBuffer = req.files['strip_image'] ? req.files['strip_image'][0].buffer : null;

        const updatedCardDetails = await carddetailProcess.updateCardDetails(
            business_id, background_color, foreground_color, pass_type_id, terms,
            logoBuffer, strip_imageBuffer, created_at, updated_at, id
        );

        if (updatedCardDetails) {
            res.status(200).json({ message: `Tarjeta de negocio ${id} actualizada` });
        } else {
            res.status(404).json({ error: 'Tarjeta no encontrada' });
        }
    } catch (error) {
        //console.error(error);
        res.status(502).json({ error: 'Error al actualizar el detalle de la tarjeta' });
    }
}

const deleteCardDetails = async(req, res) => {
    try {
        const { id } = req.params;
        const result = await carddetailProcess.deleteCardDetails(id);
        if (!result) {
            return res.status(404).json({ error: 'Tarjeta no encontrada' });
        }
        res.status(200).json({ message: 'Tarjeta eliminada con éxito' });
    } catch (error) {
        //console.error(error);
        res.status(502).json({ error: 'Error al eliminar el detalle de la tarjeta' });
    }
}

const getAllCardsByBusiness = async(req, res) => {
    try {
        const { business_id } = req.params; 
        if(!business_id){
            return res.status(400).json({ error: 'business_id faltante'}); 
        }

        const result = await carddetailProcess.getAllCardsByBusiness(business_id); 
        if(!result){
            return res.status(404).json({ error: 'Tarjetas no encontradas'}); 
        }
        res.status(200).json(result); 
    } catch (error){
        //console.error(error); 
        res.status(502).json({ error: 'Error al obtener las tarjeas'}); 
    }
}

const getOneCardByBusiness = async(req, res) => {
    try {
        const { business_id, id } = req.params; 
        if(!business_id){
            return res.status(400).json({ error: 'business_id faltante'}); 
        }

        if(!id){
            return res.status(400).json({ error: 'id faltante'}); 
        }
        const result = await carddetailProcess.getOneCardByBusiness(business_id, id); 
        
        if(!result){
            return res.status(404).json({ error: 'Tarjeta no encontrada'}); 
        }
        res.status(200).json(result); 
    } catch (error){
        //console.error(error); 
        res.status(502).json({ error: 'Error al obtener la tarjea'}); 
    }
}

const generateQR = async (req, res) => {
  const { userId, businessId } = req.params;
  
  if (!userId || !businessId) {
    return res.status(400).json({ error: 'Faltan parámetros necesarios' });
  }
  
  try {
    const qrCode = await carddetailProcess.generateQR(userId, businessId);
    res.status(200).json({ qrCode });
  } catch (error) {
    res.status(500).json({ error: 'Error al generar el QR' });
  }
};

// NUEVOS endpoints (no tocan multipart)
const createDesignUnified = async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.businessId) return res.status(400).json({ error: 'businessId requerido' });

    // VALIDACIONES ACTUALIZADAS PARA STRIPS (single y multi-tier)
    if (body.cardType === 'strips') {
      if (!body.strips) {
        return res.status(400).json({ error: 'Configuración strips requerida para cardType "strips"' });
      }
      
      // Detectar si es multi-tier o single
      const isMultiTier = Array.isArray(body.strips.rewards) && body.strips.rewards.length > 0;
      
      if (isMultiTier) {
        // MULTI-TIER: validar array de rewards
        if (body.strips.rewards.length === 0) {
          return res.status(400).json({ error: 'strips.rewards debe tener al menos 1 elemento' });
        }
        
        // Validar cada reward
        for (let i = 0; i < body.strips.rewards.length; i++) {
          const reward = body.strips.rewards[i];
          if (!reward.title) {
            return res.status(400).json({ error: `strips.rewards[${i}].title es requerido` });
          }
          if (!reward.strips_required || reward.strips_required < 1) {
            return res.status(400).json({ error: `strips.rewards[${i}].strips_required debe ser mayor a 0` });
          }
        }
        
        console.log('[createDesignUnified] Multi-tier detectado:', {
          levels: body.strips.rewards.length,
          rewards: body.strips.rewards.map(r => r.title)
        });
        
      } else {
        // SINGLE: validar campos tradicionales
        if (!body.strips.rewardTitle) {
          return res.status(400).json({ error: 'strips.rewardTitle es requerido para tarjetas single' });
        }
        
        if (!body.strips.total || body.strips.total < 1 || body.strips.total > 20) {
          return res.status(400).json({ error: 'strips.total debe ser entre 1 y 20' });
        }

        // Normalizar valores single
        body.strips.total = Number(body.strips.total);
        body.strips.layout = body.strips.layout || 'horizontal';
        body.strips.rewardDescription = body.strips.rewardDescription || '';
        
        console.log('[createDesignUnified] Single detectado:', {
          total: body.strips.total,
          reward: body.strips.rewardTitle
        });
      }
    }

    // TRANSFORMAR strips -> rewardSystem
    if (body.cardType === 'strips' && body.strips) {
      const isMultiTier = Array.isArray(body.strips.rewards) && body.strips.rewards.length > 0;
      
      if (isMultiTier) {
        body.rewardSystem = {
          type: 'multi-tier',
          multiTier: {
            rewards: body.strips.rewards.map((r, idx) => ({
              level: idx + 1,
              title: r.title,
              description: r.description || null,
              strips_required: r.strips_required,
              icon: r.icon || null
            }))
          }
        };
      } else {
        body.rewardSystem = {
          type: 'single',
          single: {
            strips_required: body.strips.total,
            reward_title: body.strips.rewardTitle,
            reward_description: body.strips.rewardDescription || null
          }
        };
      }
      
      console.log('[createDesignUnified] rewardSystem creado:', {
        type: body.rewardSystem.type
      });
    }

    // Normalizar barcode
    if (body.barcode) body.barcode = normalizeBarcodeSpec(body.barcode);
    
    // Guardar
    const saved = await carddetailService.createUnifiedDesign({
      business_id: Number(body.businessId),
      design_json: body
    });
    
    // Respuesta según tipo
    const response = { 
      id: saved.id, 
      design: saved.design_json
    };
    
    if (body.cardType === 'strips' && body.rewardSystem) {
      if (body.rewardSystem.type === 'multi-tier') {
        response.strips_info = {
          type: 'multi-tier',
          total_levels: body.rewardSystem.multiTier.rewards.length,
          rewards: body.rewardSystem.multiTier.rewards.map(r => ({
            level: r.level,
            title: r.title,
            strips_required: r.strips_required
          }))
        };
      } else {
        response.strips_info = {
          type: 'single',
          total: body.strips.total,
          reward: body.strips.rewardTitle,
          has_custom_images: !!(body.strips.stripImageOn && body.strips.stripImageOff)
        };
      }
    }
    
    return res.status(201).json(response);
    
  } catch (e) {
    console.error('[createDesignUnified] Error:', e);
    return res.status(400).json({ error: e.message || 'Invalid design body' });
  }
};

const createDesignWithStripsImages = async (req, res) => {
  try {
    // Parsear el JSON del campo 'design' 
    let designData;
    try {
      designData = JSON.parse(req.body.design || '{}');
    } catch (parseError) {
      return res.status(400).json({ error: 'Campo design debe ser JSON válido' });
    }

    if (!designData.businessId) {
      return res.status(400).json({ error: 'businessId requerido en design' });
    }

    // Procesar imágenes subidas
    const stripImageOnBuffer = req.files['strip_image_on']?.[0]?.buffer;
    const stripImageOffBuffer = req.files['strip_image_off']?.[0]?.buffer;

    console.log('[createDesignWithStripsImages] Imágenes recibidas:', {
      strip_on: !!stripImageOnBuffer,
      strip_off: !!stripImageOffBuffer
    });

    // Inicializar configuración de strips si no existe
    if (!designData.strips) {
      designData.strips = {};
    }

    // Convertir imágenes a base64 y agregarlas al design
    if (stripImageOnBuffer) {
      const base64On = stripImageOnBuffer.toString('base64');
      designData.strips.stripImageOn = `data:image/png;base64,${base64On}`;
    }

    if (stripImageOffBuffer) {
      const base64Off = stripImageOffBuffer.toString('base64');
      designData.strips.stripImageOff = `data:image/png;base64,${base64Off}`;
    }

    // Forzar cardType a strips
    designData.cardType = 'strips';

    // VALIDACIONES ACTUALIZADAS (mismo código que createDesignUnified)
    const isMultiTier = Array.isArray(designData.strips.rewards) && designData.strips.rewards.length > 0;
    
    if (isMultiTier) {
      // Multi-tier: validar rewards
      for (let i = 0; i < designData.strips.rewards.length; i++) {
        const reward = designData.strips.rewards[i];
        if (!reward.title) {
          return res.status(400).json({ error: `strips.rewards[${i}].title es requerido` });
        }
        if (!reward.strips_required || reward.strips_required < 1) {
          return res.status(400).json({ error: `strips.rewards[${i}].strips_required debe ser mayor a 0` });
        }
      }
      
      // Crear rewardSystem multi-tier
      designData.rewardSystem = {
        type: 'multi-tier',
        multiTier: {
          rewards: designData.strips.rewards.map((r, idx) => ({
            level: idx + 1,
            title: r.title,
            description: r.description || null,
            strips_required: r.strips_required,
            icon: r.icon || null
          }))
        }
      };
      
    } else {
      // Single: validaciones tradicionales
      if (!designData.strips.rewardTitle) {
        return res.status(400).json({ error: 'strips.rewardTitle es requerido' });
      }

      if (!designData.strips.total) {
        designData.strips.total = 8; // Default
      }

      designData.strips.total = Number(designData.strips.total);
      designData.strips.layout = designData.strips.layout || 'horizontal';
      
      // Crear rewardSystem single
      designData.rewardSystem = {
        type: 'single',
        single: {
          strips_required: designData.strips.total,
          reward_title: designData.strips.rewardTitle,
          reward_description: designData.strips.rewardDescription || null
        }
      };
    }

    // Guardar usando el mismo servicio
    const saved = await carddetailService.createUnifiedDesign({
      business_id: Number(designData.businessId),
      design_json: designData
    });

    const response = { 
      id: saved.id, 
      design: saved.design_json
    };
    
    if (isMultiTier) {
      response.strips_info = {
        type: 'multi-tier',
        total_levels: designData.rewardSystem.multiTier.rewards.length,
        rewards: designData.rewardSystem.multiTier.rewards,
        has_custom_images: !!(stripImageOnBuffer && stripImageOffBuffer)
      };
    } else {
      response.strips_info = {
        type: 'single',
        total: designData.strips.total,
        reward: designData.strips.rewardTitle,
        has_custom_images: !!(stripImageOnBuffer && stripImageOffBuffer)
      };
    }
    
    return res.status(201).json(response);

  } catch (e) {
    console.error('[createDesignWithStripsImages] Error:', e);
    return res.status(500).json({ error: 'Error al crear diseño con imágenes de strips' });
  }
};

const updateDesignUnified = async (req, res) => {
  try {
    const id = Number(req.params.id);
    const body = req.body || {};
    if (body.barcode) body.barcode = normalizeBarcodeSpec(body.barcode);
    const updated = await carddetailService.updateUnifiedDesign({
      id,
      business_id: body.businessId ? Number(body.businessId) : undefined,
      design_json: Object.keys(body).length ? body : undefined
    });
    if (!updated) return res.status(404).json({ error: 'No encontrado' });
    return res.json({ ok: true, id, design: updated.design_json });
  } catch (e) {
    //console.error('updateDesignUnified', e);
    return res.status(400).json({ error: e.message || 'Invalid update' });
  }
};

const deleteByIdBusiness = async (req, res) => {
    try {
        const { id } = req.params; 
        if(!id) return res.status(404).json({ error: 'Negocio no encontrado'}); 
        const response = await carddetailProcess.deleteByIdBusiness(id); 
        res.status(200).json(response); 
    } catch (error){
        //console.error('Error al intentar eliminar tarjetas'); 
        return res.status(502).json({ error: error.message || 'No se pudieron eliminar las tarjetas '}); 
    }
}

const updateMeta = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: 'id inválido' });
    }

    const { pass_type_id, terms } = req.body || {};
    const payload = {};
    if (typeof pass_type_id === 'string' && pass_type_id.trim()) payload.pass_type_id = pass_type_id.trim();
    if (typeof terms === 'string' && terms.trim()) payload.terms = terms.trim();

    if (!Object.keys(payload).length) {
      return res.status(400).json({ error: 'Nada que actualizar (envía pass_type_id y/o terms)' });
    }

    const updated = await carddetailProcess.updateMeta(id, payload);
    if (!updated) return res.status(404).json({ error: 'Tarjeta no encontrada' });

    return res.status(200).json({ ok: true, id, pass_type_id: updated.pass_type_id, terms: updated.terms });
  } catch (e) {
    //console.error('updateMeta error', e);
    return res.status(502).json({ error: 'Error al actualizar meta' });
  }
};

const getActiveCardByBusiness = async (req, res) => {
  try {
    const { business_id } = req.params; 
    if (!business_id) return res.status(401).json({ error: 'Business id requerido'}); 
    const design = carddetailProcess.getActiveCardByBusiness(businessProcess); 
    if (!design) return res.status(404).json({ error: 'Diseño no encontrado'}); 
    return res.status(200).json(design); 

  } catch (error) {
    return res.status(502).json({ error: 'Error al obtener el diseño activo '})
  }
}
module.exports = {
    getAllCardDetails,
    getOneCardDetails,
    createOneCardDetails,
    updateCardDetails, 
    deleteCardDetails, 
    getAllCardsByBusiness, 
    getOneCardByBusiness,
    getActiveCardByBusiness,
    generateQR, 
    createDesignUnified, 
    updateDesignUnified, 
    deleteByIdBusiness, 
    updateMeta, 
    createDesignWithStripsImages
}