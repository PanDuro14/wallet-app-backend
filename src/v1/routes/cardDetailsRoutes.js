const express = require('express');
const router = express.Router();
const carddetailController = require('../../controller/carddetailController'); 
const multer = require('multer');

// Configurar el Multer para el manejo de las imagenes 
const storage = multer.memoryStorage(); 
const upload = multer({
  storage, 
  limits: { fileSize: 10 * 1024 * 1024 }
}); 

router
    .get('/generate/:userId/:businessId', carddetailController.generateQR)
    .get('/', carddetailController.getAllCardDetails)
    .get('/:id', carddetailController.getOneCardDetails)
    .post('/',upload.fields([
            {name: 'logo', maxCount: 1}, 
            {name: 'strip_image', maxCount: 1}
        ]), carddetailController.createOneCardDetails)
    .put('/:id', upload.fields([
            {name: 'logo', maxCount: 1}, 
            {name: 'strip_image', maxCount: 1}
        ]), carddetailController.updateCardDetails)
    .delete('/:id', carddetailController.deleteCardDetails)

module.exports = router; 