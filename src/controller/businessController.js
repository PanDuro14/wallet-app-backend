const jwt = require('jsonwebtoken');
const businessesProcess = require('../processes/businessProcess'); 

const loginBusiness = async (req, res) => {
  const { email, password } = req.body;
  try {
    const business = await businessesProcess.loginBusiness(email, password);

    if (business) {
      // Generar el token para el negocio
      const token = jwt.sign({ businessId: business.id, name: business.name, email: business.email }, process.env.JWT_SECRET, { expiresIn: '1h' });

      // Guardar el token en las cookies para permitir la persistencia de sesión
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',  
        maxAge: 3600000,  // 1 hora de expiración
      });

      res.status(200).json({ success: true, token, business });
    } else {
      res.status(401).json({ success: false, message: 'Credenciales incorrectas' });
    }
  } catch (error) {
    console.error('Error al hacer login del negocio: ', error);
    res.status(502).json({ error: 'Error al hacer login del negocio', details: error.message });
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
    const { name, email, password,  created_at, updated_at } = req.body; 
    const logoBuffer = req.files['logo'] ? req.files['logo'][0].buffer : null;
    //const stripImageBuffer = req.files['strip_image'] ? req.files['strip_image'][0].buffer : null;

    if (!logoBuffer ) {
      console.log(req.files); 
      return res.status(400).json({ error: 'Se requieren las imágenes del logo y strip' });
    }
    
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

    const business = await businessesProcess.updateBusiness(id, name, email, password, logoBuffer, created_at, updated_at)
  
    if (!business) {
      return res.status(404).json({ error: 'Negocio no encontrado' });
    }

    res.status(200).json({ message: 'Negocio actualizado con éxito', business });
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

module.exports = {
  loginBusiness,
  getAllBusinesses,
  getOneBusiness,
  createBusiness,
  updateBusiness,
  deleteBusiness,
};