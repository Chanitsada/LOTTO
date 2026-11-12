const router = require('express').Router();
router.post('/', require('../controllers/checkout-controller').checkout);
module.exports = router;
