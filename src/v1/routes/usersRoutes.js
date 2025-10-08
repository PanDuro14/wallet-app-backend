const express = require('express');
const router = express.Router();
const userController = require('../../controller/userController');
const { authenticateUser } = require('../../Middleware/authenticationMiddleware');
// Rutas para las operaciones relacionadas con los usuarios
router
  .post('/getbyserial', userController.getUserDataBySerial)
  .get('/business/:id', userController.getOneUserByBusiness) // Obtener todos los usuarios por business
  .post('/search', userController.getUserByData)
  .get('/', userController.getAllUsers) // Obtener todos los usuarios
  .get('/:id', userController.getOneUser) // Obtener un usuario por ID
  .post('/', userController.createUser) // Crear un nuevo usuario
  .put('/:id', userController.updateUser) // Actualizar un usuario
  .delete('/:id', userController.deleteUser) // Eliminar un usuario
  .post('/users/:id/wallet', userController.retryWallet);// reintento de wallet (opcional)


module.exports = router;
