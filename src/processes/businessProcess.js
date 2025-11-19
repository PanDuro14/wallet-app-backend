// processes/businessProcess.js
const businessService = require('../services/businessService');


const safeMsg = (e) => (e?.message ?? (typeof e === 'string' ? e : 'unknown'));

async function loginBusiness(email, password) {
  try {
    const user = await businessService.loginBusiness(email, password);
    // Convención: service devuelve `null` si email/pass no validan
    return user; // { id, name, email } | null
  } catch (err) {
    // Propaga manteniendo mensaje, sea Error o string
    const msg = err?.message ?? String(err);
    throw new Error(`Error en login de negocios: ${msg}`);
  }
}

// Puedes aplicar el mismo patrón al resto para evitar "…: undefined"
async function getAllBusinesses() {
  try {
    return await businessService.getAllBusinesses();
  } catch (err) {
    throw new Error('getAllBusinesses failed', { cause: err });
  }
}

async function getOneBusiness(id) {
  try {
    const business = await businessService.getOneBusiness(id);
    return business; // si no existe, que service devuelva null
  } catch (err) {
    throw new Error('getOneBusiness failed', { cause: err });
  }
}

async function createBusiness(name, email, password, logoBuffer, stripImageOn, stripImageOff, created_at, updated_at) {
  try {
    return await businessService.createBusiness(name, email, password, logoBuffer, stripImageOn, stripImageOff, created_at, updated_at);
  } catch (err) {
    throw new Error('createBusiness failed', { cause: err });
  }
}

async function updateBusiness(id, updates) {
  try {
    return await businessService.updateBusiness(id, updates);
  } catch (err) {
    throw new Error('updateBusiness failed', { cause: err });
  }
}

async function deleteBusiness(id) {
  try {
    return await businessService.deleteBusiness(id);
  } catch (err) {
    throw new Error('deleteBusiness failed', { cause: err });
  }
}

async function getEmail(email) {
  try {
    return await businessService.getEmail(email);
  } catch (err) {
    throw new Error('getEmail failed', { cause: err });
  }
}

const getCurrentDesignById = async (id) => businessService.getCurrentDesignById(id);
const updateCurrentDesignById = async (designId, businessId) => businessService.updateCurrentDesignById(designId, businessId);

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
