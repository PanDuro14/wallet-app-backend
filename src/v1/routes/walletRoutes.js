const router = require('express').Router();
const auth = require('../../Middleware/authenticationMiddleware'); // si quieres proteger, descomenta
const walletController = require('../../controller/walletController'); 
// router.use(auth); // opcional: exigir JWT propio antes de emitir pases

router.post('/google', walletController.createGoogle);
router.post('/apple', walletController.addToAppleWallet);
// walletController (solo en dev)
router.post('/google/debug', walletController.debugGoogle);
router.post('/google/ensure', walletController.ensureGoogleClass);


module.exports = router;
