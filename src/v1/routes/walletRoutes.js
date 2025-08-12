const router = require('express').Router();
const { addToGoogleWallet, addToAppleWallet } = require('../../controller/walletController');
const auth = require('../../Middleware/authenticationMiddleware'); // si quieres proteger, descomenta

// router.use(auth); // opcional: exigir JWT propio antes de emitir pases

router.post('/google', addToGoogleWallet);
router.post('/apple', addToAppleWallet);

module.exports = router;
