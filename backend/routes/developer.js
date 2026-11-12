const router = require('express').Router();
const controller = require('../controllers/developer-controller');

router.get('/inventory', controller.inventory);

module.exports = router;
