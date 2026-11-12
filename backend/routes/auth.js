const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { register, login, me, logout } = require('../controllers/auth-controller');
const { sessions } = require('../middleware/session');
const { csrfToken, requireCsrf } = require('../middleware/csrf');
const { requireLogin } = require('../middleware/auth');

const router = express.Router();
const loginLimit = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 10,
  skipSuccessfulRequests: true, standardHeaders: true, legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_ATTEMPTS', message: 'Too many sign-in attempts. Try again in 15 minutes.' } },
});

router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/csrf', sessions, csrfToken);
router.post('/register', sessions, requireCsrf, register);
router.post('/login', loginLimit, sessions, requireCsrf, login);
router.get('/me', sessions, requireLogin, me);
router.post('/logout', sessions, requireLogin, requireCsrf, logout);

module.exports = router;
