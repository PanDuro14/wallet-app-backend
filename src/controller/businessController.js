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
    console.error('[loginBusiness][controller]', {
      message: err?.message ?? String(err),
      cause: err?.cause?.message ?? String(err?.cause ?? ''),
      stack: err?.stack
    });
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
    const { name, password,  created_at, updated_at } = req.body; 
    const email = req.body.email.toLowerCase(); 
    const logoBuffer = req.files['logo'] ? req.files['logo'][0].buffer : null;
    //const stripImageBuffer = req.files['strip_image'] ? req.files['strip_image'][0].buffer : null;
 
    const business = await businessesProcess.createBusiness(name, email, password, logoBuffer, created_at, updated_at); 

    res.status(201).json({ message: 'Negocio creado con éxito', business });
  } catch (error) {
    console.error('Error al crear el negocio:', error); 
    res.status(502).json({ error: 'Error al crear el negocio', details: error.message });
  }
};

// Actualizar un negocio
const updateBusiness = async (req, res) => {
  try {
    const { id } = req.params; 
    const { name, email, password, created_at, updated_at } = req.body; 
    const logoBuffer = req.files['logo'] ? req.files['logo'][0].buffer : null;
    //const stripImageBuffer = req.files['strip_image'] ? req.files['strip_image'][0].buffer : null;

    if (!logoBuffer) {
      return res.status(400).json({ error: 'Se requieren las imágenes del logo y strip' });
    }

    const data = await businessesProcess.updateBusiness(id, name, email, password, logoBuffer, created_at, updated_at)
  
    if (!data) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    res.status(200).json({ message: 'Negocio actualizado con éxito', data });
  } catch (error) {
    console.error('Error al update el negocio:', error); 
    res.status(502).json({ error: 'Error al actualizar el negocio', details: error.message });
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
    console.error('createBusinessWithDesign error:', e);
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
  setDefaultDesign
};