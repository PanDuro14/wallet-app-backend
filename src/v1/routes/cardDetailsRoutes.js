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
    .get('/getByBusiness/:business_id', carddetailController.getAllCardsByBusiness)
    .get('/getOneByBusiness/:business_id/:id', carddetailController.getOneCardByBusiness)
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


// routes/carddesign.routes.js
router.post('/unified', carddetailController.createDesignUnified);
router.put('/unified/:id', carddetailController.updateDesignUnified);
router.delete('/bybusiness/:id', carddetailController.deleteByIdBusiness); 
router.patch('/meta/:id', carddetailController.updateMeta);
router.post('/unified/with-strips', 
  upload.fields([
    { name: 'strip_image_on', maxCount: 1 },
    { name: 'strip_image_off', maxCount: 1 }
  ]), 
  carddetailController.createDesignWithStripsImages
);
router.get('/getActiveDesign/:business_id', carddetailController.getActiveCardByBusiness); 

module.exports = router; 