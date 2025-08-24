const router = require('express').Router();
const auth = require('../../Middleware/authenticationMiddleware'); // si quieres proteger, descomenta
const walletController = require('../../controller/walletController'); 
const passkitCtrl = require('../../controller/passkitController');
// router.use(auth); // opcional: exigir JWT propio antes de emitir pases

router.post('/google', walletController.createGoogle);
router.post('/apple', walletController.addToAppleWallet);
// walletController (solo en dev)
router.post('/google/debug', walletController.debugGoogle);
router.post('/google/ensure', walletController.ensureGoogleClass);

// PassKit Web Service
router.get('/v1/passes/:passTypeId/:serial', passkitCtrl.getPass);
router.post('/v1/devices/:deviceId/registrations/:passTypeId/:serial', passkitCtrl.registerDevice);

// Ruta interna para cambiar puntos
router.post('/internal/passes/:serial/points', passkitCtrl.bumpPoints);

module.exports = router;
