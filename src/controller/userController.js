const userProcess = require('../processes/usersProcess');

// Obtener todos los usuarios
const getAllUsers = async (req, res) => {
  try {
    const users = await userProcess.getAllUsers();
    res.status(200).json(users);
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener los usuarios' });
  }
};

// Obtener un usuario por ID
const getOneUser = async (req, res) => {
  const { id } = req.params;
  try {
    const user = await userProcess.getOneUser(id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.status(200).json(user);
  } catch (error) {
    res.status(500).json({ error: `Error al obtener el usuario con ID ${id}` });
  }
};

// Crear un nuevo usuario (sin auth_token ni strip_image_url)
const createUser = async (req, res) => {
  const { name, email, phone, business_id, points, serial_number } = req.body;
  try {
    const result = await userProcess.createUser(name, email, phone, business_id, points, serial_number);
    res.status(201).json({ message: 'Usuario creado con éxito', ...result });
  } catch (error) {
    res.status(500).json({ error: 'Error al crear el usuario', details: error.message });
  }
};

// Actualizar un usuario
const updateUser = async (req, res) => {
  const { id } = req.params;
  const { name, email, phone } = req.body;
  try {
    const updatedUser = await userProcess.updateUser(id, name, email, phone);
    if (!updatedUser) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.status(200).json({ message: 'Usuario actualizado con éxito', updatedUser });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el usuario', details: error.message });
  }
};

// Eliminar un usuario
const deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await userProcess.deleteUser(id);
    if (!result) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.status(200).json({ message: 'Usuario eliminado con éxito' });
  } catch (error) {
    res.status(500).json({ error: 'Error al eliminar el usuario' });
  }
};

// Opcional: reintentar generar wallet
const retryWallet = async (req, res) => {
  const { id } = req.params;
  try {
    const result = await userProcess.regenerateWallet(Number(id));
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ error: 'No se pudo regenerar la wallet', details: error.message });
  }
};

module.exports = {
  getAllUsers,
  getOneUser,
  createUser,
  updateUser,
  deleteUser,
  retryWallet
};
