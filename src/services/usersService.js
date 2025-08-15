const usersDb = require('../db/usersDB');

const getAllUsers = async () => {
  return usersDb.getAllUsers();
};

const getOneUser = async (id) => {
  return usersDb.getOneUser(id);
};

const createUser = async (name, email, phone, business_id, points = 0, serial_number = null) => {
  return usersDb.createUser(name, email, phone, business_id, points, serial_number);
};

const updateUser = async (id, name, email, phone) => {
  return usersDb.updateUser(id, name, email, phone);
};

const deleteUser = async (id) => {
  return usersDb.deleteUser(id);
};

const saveUserWallet = async ({ userId, loyalty_account_id, wallet_url }) => {
  return usersDb.saveUserWallet({ userId, loyalty_account_id, wallet_url });
};

const markWalletAdded = async ({ userId }) => {
  return usersDb.markWalletAdded({ userId });
};

module.exports = {
  getAllUsers,
  getOneUser,
  createUser,
  updateUser,
  deleteUser,
  saveUserWallet,
  markWalletAdded
};
