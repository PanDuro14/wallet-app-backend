const businessDb = require('../db/businessesdb'); 

// Login de negocios
const loginBusiness = async (email, password) => {
  try {
    const user = await businessDb.loginBusiness(email, password);
    return user;
  } catch (err) {
    const msg = err?.message ?? String(err);
    throw new Error(`Error en el login de negocios: ${msg}`);
  }
};

// Obtener todos los negocios
const getAllBusinesses = async () => {
  try {
    const businesses = await businessDb.getAllBusinesses();
    return businesses;
  } catch (err) {
    throw new Error('Error al obtener los negocios: ' + err.message);
  }
};

// Obtener un negocio por ID
const getOneBusiness = async (id) => {
  try {
    const business = await businessDb.getOneBusiness(id);
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
    const newBusiness = await businessDb.createBusiness(name, email, password, logoBuffer, created_at, updated_at);
    return newBusiness;
  } catch (err) {
    throw new Error('Error al crear el negocio: ' + err.message);
  }
};

// Actualizar un negocio por ID
const updateBusiness = async (id, name, email, password, logoBuffer, created_at, updated_at) => {
  try {
    const updatedBusiness = await businessDb.updateBusiness(id, name, email, password, logoBuffer, created_at, updated_at);
    return updatedBusiness;
  } catch (err) {
    throw new Error('Error al actualizar el negocio: ' + err.message);
  }
};

// Eliminar un negocio por ID
const deleteBusiness = async (id) => {
  try {
    const result = await businessDb.deleteBusiness(id);
    return result;
  } catch (err) {
    throw new Error('Error al eliminar el negocio: ' + err.message);
  }
};

const getEmail = async (email) => {
  const result = await businessDb.getEmail(email); 
  return result; 
}

const getCurrentDesignById = async (id) => {
  return businessDb.getCurrentDesignById(id);          // 👈 pasa número, no objeto
};

const updateCurrentDesignById = async (designId, businessId) => {
  return businessDb.updateCurrentDesignById(designId, businessId); // 👈 nombre correcto y números
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
