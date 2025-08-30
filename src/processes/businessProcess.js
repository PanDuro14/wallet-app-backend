const businessService = require('../services/businessService'); 

// Login de negocios
const loginBusiness = async (email, password) => {
  try {
    const user = await businessService.loginBusiness(email, password);
    return user;
  } catch (err) {
    throw new Error('Error en el login de negocios: ' + err.message);
  }
};

// Obtener todos los negocios
const getAllBusinesses = async () => {
  try {
    const businesses = await businessService.getAllBusinesses();
    return businesses;
  } catch (err) {
    throw new Error('Error al obtener los negocios: ' + err.message);
  }
};

// Obtener un negocio por ID
const getOneBusiness = async (id) => {
  try {
    const business = await businessService.getOneBusiness(id);
    if (!business) {
      throw new Error('Negocio no encontrado');
    }
    return business;
  } catch (err) {
    throw new Error('Error al obtener el negocio: ' + err.message);
  }
};

// Crear un nuevo negocio
const createBusiness = async (name, email, password, logoBuffer, created_at, updated_at) => {
  try {
    const newBusiness = await businessService.createBusiness(name, email, password, logoBuffer, created_at, updated_at);
    return newBusiness;
  } catch (err) {
    throw new Error('Error al crear el negocio: ' + err.message);
  }
};

// Actualizar un negocio por ID
const updateBusiness = async (id, name, email, password, logoBuffer, created_at, updated_at) => {
  try {
    const updatedBusiness = await businessService.updateBusiness(id, name, email, password, logoBuffer, created_at, updated_at);
    return updatedBusiness;
  } catch (err) {
    throw new Error('Error al actualizar el negocio: ' + err.message);
  }
};

// Eliminar un negocio por ID
const deleteBusiness = async (id) => {
  try {
    const result = await businessService.deleteBusiness(id);
    return result;
  } catch (err) {
    throw new Error('Error al eliminar el negocio: ' + err.message);
  }
};

// getEmail 
const getEmail = async (email) => {
  const result = await businessService.getEmail(email); 
  return result; 
}

const getCurrentDesignById = async (id) => {
  return businessService.getCurrentDesignById(id);
};

const updateCurrentDesignById = async (designId, businessId) => {
  return businessService.updateCurrentDesignById(designId, businessId);
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
  updateCurrentDesignById
};
