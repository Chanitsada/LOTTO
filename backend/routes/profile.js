const router = require('express').Router();
const controller = require('../controllers/profile-controller');
router.get('/', controller.getProfile);
router.patch('/', controller.updateProfile);
module.exports = router;
