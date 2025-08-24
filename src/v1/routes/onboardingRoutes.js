const onboardingController = require('../../controller/onboardingController'); 
const router = require('express').Router(); 

router.post('/users', onboardingController.createUserAndIssue); 

module.exports = router; 