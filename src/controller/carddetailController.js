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

    // ====== NUEVO: Validaciones específicas para strips ======
    if (body.cardType === 'strips') {
      // Validar configuración mínima de strips
      if (!body.strips) {
        return res.status(400).json({ error: 'Configuración strips requerida para cardType "strips"' });
      }
      
      if (!body.strips.rewardTitle) {
        return res.status(400).json({ error: 'strips.rewardTitle es requerido' });
      }
      
      if (!body.strips.total || body.strips.total < 1 || body.strips.total > 20) {
        return res.status(400).json({ error: 'strips.total debe ser entre 1 y 20' });
      }

      // Valores por defecto para strips
      body.strips.total = Number(body.strips.total);
      body.strips.layout = body.strips.layout || 'horizontal';
      body.strips.rewardDescription = body.strips.rewardDescription || '';
      
      //console.log('[createDesignUnified] Configuración de strips validada:', {
      //  total: body.strips.total,
      //  rewardTitle: body.strips.rewardTitle,
      //  layout: body.strips.layout,
      //  hasOnImage: !!body.strips.stripImageOn,
      //  hasOffImage: !!body.strips.stripImageOff
      //});
    }

    // normaliza barcode para guardar limpio (tu código original)
    if (body.barcode) body.barcode = normalizeBarcodeSpec(body.barcode);
    
    const saved = await carddetailService.createUnifiedDesign({
      business_id: Number(body.businessId),
      design_json: body
    });
    
    return res.status(201).json({ 
      id: saved.id, 
      design: saved.design_json,
      // Información adicional para strips
      ...(body.cardType === 'strips' ? {
        strips_info: {
          total: body.strips.total,
          reward: body.strips.rewardTitle,
          has_custom_images: !!(body.strips.stripImageOn && body.strips.stripImageOff)
        }
      } : {})
    });
  } catch (e) {
    //console.error('createDesignUnified', e);
    return res.status(400).json({ error: e.message || 'Invalid design body' });
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


// ====== NUEVO: Función para crear design con imágenes subidas ======
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

    //console.log('[createDesignWithStripsImages] Imágenes recibidas:', {
    //  strip_on: !!stripImageOnBuffer,
    //  strip_off: !!stripImageOffBuffer,
    //  strip_on_size: stripImageOnBuffer?.length || 0,
    //  strip_off_size: stripImageOffBuffer?.length || 0
    //});

    // Inicializar configuración de strips si no existe
    if (!designData.strips) {
      designData.strips = {};
    }

    // Convertir imágenes a base64 y agregarlas al design
    if (stripImageOnBuffer) {
      try {
        const base64On = stripImageOnBuffer.toString('base64');
        designData.strips.stripImageOn = `data:image/png;base64,${base64On}`;
        //console.log('[createDesignWithStripsImages] Imagen ON convertida:', base64On.length, 'chars');
      } catch (convertError) {
        //console.error('Error convirtiendo imagen ON:', convertError);
        return res.status(400).json({ error: 'Error procesando strip_image_on' });
      }
    }

    if (stripImageOffBuffer) {
      try {
        const base64Off = stripImageOffBuffer.toString('base64');
        designData.strips.stripImageOff = `data:image/png;base64,${base64Off}`;
        //console.log('[createDesignWithStripsImages] Imagen OFF convertida:', base64Off.length, 'chars');
      } catch (convertError) {
        //console.error('Error convirtiendo imagen OFF:', convertError);
        return res.status(400).json({ error: 'Error procesando strip_image_off' });
      }
    }

    // Forzar cardType a strips
    designData.cardType = 'strips';

    // Validaciones mínimas (reutilizando lógica)
    if (!designData.strips.rewardTitle) {
      return res.status(400).json({ error: 'strips.rewardTitle es requerido' });
    }

    if (!designData.strips.total) {
      designData.strips.total = 10; // Default
    }

    designData.strips.total = Number(designData.strips.total);
    designData.strips.layout = designData.strips.layout || 'horizontal';

    // Guardar usando el mismo servicio
    const saved = await carddetailService.createUnifiedDesign({
      business_id: Number(designData.businessId),
      design_json: designData
    });

    return res.status(201).json({ 
      id: saved.id, 
      design: saved.design_json,
      strips_info: {
        total: designData.strips.total,
        reward: designData.strips.rewardTitle,
        has_custom_images: !!(stripImageOnBuffer && stripImageOffBuffer),
        images_processed: {
          strip_on: !!stripImageOnBuffer,
          strip_off: !!stripImageOffBuffer
        }
      }
    });

  } catch (e) {
    //console.error('createDesignWithStripsImages error:', e);
    return res.status(500).json({ error: 'Error al crear diseño con imágenes de strips' });
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