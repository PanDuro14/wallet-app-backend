const jwt = require('jsonwebtoken');
const businessesProcess = require('../processes/businessProcess'); 
const { createBusinessWithDesignProcess, setBusinessDefaultDesignProcess } = require('../processes/businessWithDesignProcess');

const loginBusiness = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Faltan email o password' });
    }

    const data = await businessesProcess.loginBusiness(email, password);
    if (!data) {
      return res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
    }

    const token = jwt.sign(
      { businessId: data.id, name: data.name, email: data.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Cookie para web (especialmente Safari/iOS)
    res.cookie('token', token, {
      httpOnly: true,
      secure: true,      // Fly es HTTPS
      sameSite: 'none',  // cross-site entre fly.dev y tu frontend
      path: '/',
      maxAge: 60 * 60 * 1000
      // Si usas dominio propio y subdominios, podrías añadir:
      // domain: '.windoe.mx'
    });

    // También devolvemos el token en el JSON para apps móviles nativas
    return res.status(200).json({ success: true, token, data });

  } catch (err) {
    //console.error('[loginBusiness][controller]', {
    //  message: err?.message ?? String(err),
    //  cause: err?.cause?.message ?? String(err?.cause ?? ''),
    //  stack: err?.stack
    //});
    return res.status(502).json({ error: 'Error al hacer login del negocio' });
  }
};


// Obtener todos los negocios
const getAllBusinesses = async (req, res) => {
  try {
    const businesses = await businessesProcess.getAllBusinesses();
    res.status(200).json(businesses);
  } catch (error) {
    res.status(502).json({ error: 'Error al obtener los negocios' });
  }
};

// Obtener un negocio por ID
const getOneBusiness = async (req, res) => {
  const { id } = req.params;
  try {
    const business = await businessesProcess.getOneBusiness(id);
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    res.status(200).json(business);
  } catch (error) {
    res.status(502).json({ error: 'Error al obtener el negocio' });
  }
};

// Crear un nuevo negocio
const createBusiness = async (req, res) => {
  try {
    const { name, password, created_at, updated_at } = req.body; 
    const email = req.body.email.toLowerCase(); 
    const logoBuffer = req.files['logo'] ? req.files['logo'][0].buffer : null;
    const stripImageOnBuffer  = req.files['strip_image_on'] ? req.files['strip_image_on'][0].buffer : null;
    const stripImageOffBuffer = req.files['strip_image_off'] ? req.files['strip_image_off'][0].buffer : null;
    //const stripImageBuffer = req.files['strip_image'] ? req.files['strip_image'][0].buffer : null;
    if (!logoBuffer) {
      return res.status(400).json({ error: 'Se requiere la imagen del logo' });
    }

    if (!stripImageOnBuffer || !stripImageOffBuffer) {
      return res.status(400).json({ error: 'Se requieren las imágenes de los strips' });
    }

    //console.log('Archivos recibidos:', req.files);

    const business = await businessesProcess.createBusiness(name, email, password, logoBuffer, stripImageOnBuffer, stripImageOffBuffer, created_at, updated_at); 

    res.status(201).json({ message: 'Negocio creado con éxito', business });
  } catch (error) {
    //console.error('Error al crear el negocio:', error); 
    res.status(502).json({ error: 'Error al crear el negocio', details: error.message });
  }
};

// Actualizar un negocio
const updateBusiness = async (req, res) => {
  try {
    const { id } = req.params; 
    const { name, email, password } = req.body; 

    // ✅ Construir objeto de updates solo con los campos presentes
    const updates = {};

    // Campos de texto
    if (name !== undefined && name !== null && name.trim() !== '') {
      updates.name = name.trim();
      //console.log('[updateBusiness] ✓ Nombre a actualizar:', updates.name);
    }

    if (email !== undefined && email !== null && email.trim() !== '') {
      updates.email = email.toLowerCase().trim();
      //console.log('[updateBusiness] ✓ Email a actualizar:', updates.email);
    }

    if (password !== undefined && password !== null && password.trim() !== '') {
      updates.password = password.trim();
      //console.log('[updateBusiness] ✓ Password a actualizar: [OCULTO]');
    }

    // Archivos/Imágenes (buffers)
    if (req.files?.['logo']?.[0]) {
      updates.logo = req.files['logo'][0].buffer;
      //console.log('[updateBusiness] ✓ Logo a actualizar:', updates.logo.length, 'bytes');
    }

    if (req.files?.['strip_image_on']?.[0]) {
      updates.strip_image_on = req.files['strip_image_on'][0].buffer;
      //console.log('[updateBusiness] ✓ Strip image ON a actualizar:', updates.strip_image_on.length, 'bytes');
    }

    if (req.files?.['strip_image_off']?.[0]) {
      updates.strip_image_off = req.files['strip_image_off'][0].buffer;
      //console.log('[updateBusiness] ✓ Strip image OFF a actualizar:', updates.strip_image_off.length, 'bytes');
    }

    // Verificar que hay algo que actualizar
    if (Object.keys(updates).length === 0) {
      //console.log('[updateBusiness] ⚠️ No se recibieron campos para actualizar');
      return res.status(400).json({ 
        error: 'No se especificaron campos para actualizar',
        hint: 'Envía al menos un campo: name, email, password, logo, strip_image_on, strip_image_off'
      });
    }

    //console.log('[updateBusiness] Campos a actualizar:', Object.keys(updates));

    // Actualizar
    const data = await businessesProcess.updateBusiness(id, updates);
  
    if (!data) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    // Responder sin incluir buffers binarios en el JSON
    const response = {
      message: 'Negocio actualizado con éxito',
      updated_fields: Object.keys(updates),
      business: {
        id: data.id,
        name: data.name,
        email: data.email,
        has_logo: !!data.logo,
        has_strip_on: !!data.strip_image_on,
        has_strip_off: !!data.strip_image_off,
        updated_at: data.updated_at
      }
    };

    res.status(200).json(response);
  } catch (error) {
    //console.error('[updateBusiness] Error:', error); 
    res.status(502).json({ 
      error: 'Error al actualizar el negocio', 
      details: error.message 
    });
  }
};

// Eliminar un negocio
const deleteBusiness = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await businessesProcess.deleteBusiness(id);
    if (!result) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }
    res.status(200).json({ message: 'Negocio eliminado con éxito' });
  } catch (error) {
    res.status(502).json({ error: 'Error al eliminar el negocio' });
  }
};

// getEmail 
const getEmail = async (req, res) => {
  const { email } = req.body; 
  try {
    if(!email){
      res.status(404).json({ error: 'Email no econtrado'}); 
    } else {
      const gettedEmail = await businessesProcess.getEmail(email); 
      res.status(200).json(gettedEmail); 
    }
  } catch (error) {
    res.status(502).json({ error: 'Error al obtener un email'}); 
  }
}

const getCurrentDesignById = async (req, res) => {
  const { id } = req.params; 
  try {
    if(!id) res.status(404).json({ error: 'Negocio no encontrado'}); 
    const desing = await businessesProcess.getCurrentDesignById(id); 
    res.status(200).json(desing); 
  } catch (error){
    res.status(502).json({ error: 'Error al obtener el diseño '}); 
  }
}

const updateCurrentDesingById = async (req, res) => {
  const { id } = req.params; 
  const { desingVal} = req.body; 
  try {
    if(!id) res.status(404).json({ error: 'Negocio no encontrado'}); 
    if(!desingVal) res.status(404).json({ error: 'Diseño es necesario '}); 
    const desing = await businessesProcess.updateCurrentDesingById(desingVal, id); 
    res.status(200).json(desing); 
  } catch (error){
    res.status(502).json({ error: 'Error al actualizar el diseño '}); 
  }
}

const createBusinessWithDesign = async (req, res) => {
  try {
    const { business, design } = req.body || {};
    if (!business?.name) return res.status(400).json({ error: 'business.name requerido' });
    if (!design?.colors || !design?.barcode) return res.status(400).json({ error: 'design incompleto' });

    const out = await createBusinessWithDesignProcess({ business, design });
    return res.status(201).json(out);
  } catch (e) {
    //console.error('createBusinessWithDesign error:', e);
    return res.status(e.statusCode || 500).json({ error: e.message || 'Server error' });
  }
};

// Definir un diseño predeterminado 
const setDefaultDesign = async (req, res) => {
  try {
    const bizId    = Number.parseInt(String(req.params.businessId).trim(), 10);
    const designId = Number.parseInt(String(req.body?.card_detail_id).trim(), 10);
    if (!Number.isFinite(bizId) || !Number.isFinite(designId)) {
      return res.status(400).json({ error: 'IDs inválidos (enteros requeridos)' });
    }

    const out = await setBusinessDefaultDesignProcess({
      business_id: bizId,
      card_detail_id: designId,
    });
    return res.json(out);
  } catch (e) {
    return res.status(e.statusCode || 500).json({ error: e.message || 'Server error' });
  }
};




const deleteOneClientByBusiness = async(req, res) => {
  try {
    const { businessId, userId } = req.params;
    
    // Validar que existan los parámetros
    if (!businessId || !userId) {
      return res.status(400).json({ 
        error: 'businessId y userId son requeridos' 
      });
    }
    
    // Ejecutar eliminación
    const result = await businessesProcess.deleteOneClientByBusiness(userId, businessId);
    
    return res.status(200).json(result);
    
  } catch (error) {
    console.error('[deleteOneClientByBusiness] Error:', error.message);
    
    // Errores específicos
    if (error.message.includes('no encontrado') || error.message.includes('no pertenece')) {
      return res.status(404).json({ 
        error: error.message 
      });
    }
    
    if (error.message.includes('inválidos')) {
      return res.status(400).json({ 
        error: error.message 
      });
    }
    
    // Error genérico
    return res.status(500).json({ 
      error: 'Error al eliminar el usuario',
      details: error.message 
    });
  }
}

module.exports = {
  loginBusiness,
  getAllBusinesses,
  getOneBusiness,
  createBusiness,
  updateBusiness,
  deleteBusiness,
  getEmail, 
  getCurrentDesignById, 
  updateCurrentDesingById,
  createBusinessWithDesign, 
  setDefaultDesign, 
  deleteOneClientByBusiness
  
};