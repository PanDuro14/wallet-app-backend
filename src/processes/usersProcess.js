
const userService = require('../services/usersService');
const { issueGoogleWalletLink } = require('./walletProcess'); // asegúrate de la ruta real

function buildCardCode({ business_id, serial_number, id }) {
  const short = (serial_number || '').toString().split('-')[0];
  return `CARD-${business_id}-${(short || String(id)).toUpperCase()}`;
}

const getAllUsers = async () => {
  return userService.getAllUsers();
};

const getOneUser = async (id) => {
  return userService.getOneUser(id);
};

const getOneUserByBusiness = async(id) => userService.getOneUserByBusiness(id); // cambié el estilo para ahorrar tiempo 

const createUser = async (name, email, phone, business_id, points = 0, serial_number = null) => {
  // 1) crear usuario
  const newUser = await userService.createUser(name, email, phone, business_id, points, serial_number);

  // 2) generar cardCode
  const cardCode = buildCardCode({
    business_id: newUser.business_id,
    serial_number: newUser.serial_number,
    id: newUser.id
  });

  // 3) pedir URL de Google Wallet
  try {
    const { url } = await issueGoogleWalletLink({
      cardCode,
      userName: newUser.name,
      programName: 'Mi Programa',
      businessId: newUser.business_id
    });

    // 4) guardar en DB
    const updated = await userService.saveUserWallet({
      userId: newUser.id,
      loyalty_account_id: cardCode,
      wallet_url: url
    });

    return { user: updated, walletUrl: url };
  } catch (err) {
    // no rompas el alta si falla Wallet: guarda loyalty y deja url nula
    await userService.saveUserWallet({
      userId: newUser.id,
      loyalty_account_id: cardCode,
      wallet_url: null
    });
    return { user: newUser, walletUrl: null, walletStatus: 'PENDING', error: err?.message };
  }
};

const updateUser = async (id, name, email, phone) => {
  return userService.updateUser(id, name, email, phone);
};

const deleteUser = async (id) => {
  return userService.deleteUser(id);
};

// opcional: reintentar wallet luego
const regenerateWallet = async (userId) => {
  const user = await userService.getOneUser(userId);
  if (!user) throw new Error('Usuario no encontrado');
  const cardCode = buildCardCode(user);
  const { url } = await issueGoogleWalletLink({
    cardCode,
    userName: user.name,
    programName: 'Mi Programa',
    businessId: user.business_id
  });
  const updated = await userService.saveUserWallet({
    userId: user.id,
    loyalty_account_id: cardCode,
    wallet_url: url
  });
  return { walletUrl: url, user: updated };
};

// Función en el proceso que invoca al servicio
const getUserDataBySerial = async ({ serial }) => {
  try {
    return await userService.getUserDataBySerial({ serial });
  } catch (error) {
    throw new Error('Error en el proceso de obtención de usuario: ' + error.message);
  }
};


module.exports = {
  getAllUsers,
  getOneUser,
  getOneUserByBusiness,
  createUser,
  updateUser,
  deleteUser,
  regenerateWallet, 
  getUserDataBySerial
};
