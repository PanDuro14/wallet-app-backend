const express = require('express');
const router = express.Router();
const businessController = require('../../controller/businessController');
const multer = require('multer');
const { authenticateBusiness } = require('../../Middleware/authenticationMiddleware');
// Configurar el Multer para el manejo de las imagenes 
const storage = multer.memoryStorage(); 
const upload = multer({
  storage, 
  limits: { fileSize: 10 * 1024 * 1024 }
}); 

// Rutas para las operaciones relacionadas con los negocios
router
  .post('/getemail', businessController.getEmail)
  .post('/loginBusiness', businessController.loginBusiness)
  .get('/', businessController.getAllBusinesses)
  .get('/:id', businessController.getOneBusiness)
  .post('/', upload.fields([
    {name: 'logo', maxCount: 1}]), 
    businessController.createBusiness)
  .put('/:id', upload.fields([
    {name: 'logo', maxCount: 1}]), 
    businessController.updateBusiness)
  .delete('/:id', businessController.deleteBusiness)

module.exports = router;
