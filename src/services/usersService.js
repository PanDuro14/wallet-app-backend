const usersDb = require('../db/usersDB');

const getAllUsers = async () => usersDb.getAllUsers();
const getOneUser  = async (id) => usersDb.getOneUser(id);
const getOneUserByBusiness = async(id) => usersDb.getOneUserByBusiness(id); 

// acepta (obj) o (name,email,phone,business_id,points,serial_number)
const createUser = async (...args) => {
  if (args.length === 1 && args[0] && typeof args[0] === 'object') {
    return usersDb.createUserFull(args[0]); 
  }
  const [name, email, phone, business_id, points = 0, serial_number = null] = args;
  return usersDb.createUser(name, email, phone, business_id, points, serial_number);
};

// updateUser: (id, patchObj) o (id, name, email, phone)
const updateUser = async (id, arg2, email, phone) => {
  if (arg2 && typeof arg2 === 'object') {
    return usersDb.updateUserFields(id, arg2); // NUEVO
  }
  return usersDb.updateUser(id, arg2, email, phone);
};

const deleteUser      = async (id) => usersDb.deleteUser(id);
const saveUserWallet  = async ({ userId, loyalty_account_id, wallet_url }) => usersDb.saveUserWallet({ userId, loyalty_account_id, wallet_url });
const markWalletAdded = async ({ userId }) => usersDb.markWalletAdded({ userId });

const getUserDataBySerial = async ({ serial }) => {
  try {
    return await usersDb.getUserDataBySerial(serial);
  } catch (error) {
    throw new Error('Error en el servicio de obtención de usuario: ' + error.message);
  }
};


module.exports = {
  getAllUsers,
  getOneUser,
  getOneUserByBusiness,
  createUser,
  updateUser,
  deleteUser,
  saveUserWallet,
  markWalletAdded, 
  getUserDataBySerial
};
