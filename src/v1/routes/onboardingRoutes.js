const onboardingController = require('../../controller/onboardingController'); 
const router = require('express').Router(); 
const multer = require('multer');
const upload = multer({
    storage: multer.memoryStorage(), 
    limits: { fileSize: 4 * 1024 * 1024 }, 
    fileFilter: (req, file, cb) => {
        const ok = ['image/png','image/jpeg','image/jpg'].includes(file.mimetype);
        cb(ok ? null : new Error('Solo PNG/JPG'), ok);
    }
}); 

router.post('/users', onboardingController.createUserAndIssue); 
// Agregar nueva ruta para crear tarjetas de strips
router.post('/users/strips', onboardingController.createUserAndIssueStrips);

module.exports = router; 