const assetsController = require('../../controller/assetsController'); 
const router = require('express').Router();

router.get('/', assetsController.getBusinessLogo); 

module.exports = router; 

