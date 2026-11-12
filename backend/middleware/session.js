const session = require('express-session');

const IDLE_TIMEOUT = 30 * 60 * 1000;
const COOKIE_NAME = 'lotto.sid';
// Sessions live in this Node process; a restart clears logins, not MySQL records.
const sessionStore = new session.MemoryStore();
let middleware;

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, {
    path: '/', httpOnly: true, sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

function sessions(req, res, next) {
  // Missing authentication configuration leaves public/static startup available.
  if (!middleware) {
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32 || /REPLACE_|CHANGE_ME/i.test(secret)) {
      return res.status(503).json({ error: {
        code: 'AUTH_NOT_CONFIGURED',
        message: 'Set a unique SESSION_SECRET of at least 32 characters in the root .env and restart the backend.',
      } });
    }
    try {
      middleware = session({
        name: COOKIE_NAME, secret, store: sessionStore,
        resave: false, saveUninitialized: false, rolling: true,
        cookie: {
          path: '/', httpOnly: true, sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production', maxAge: IDLE_TIMEOUT,
        },
      });
    } catch (error) {
      return next(error);
    }
  }
  return middleware(req, res, next);
}

module.exports = { sessions, clearSessionCookie, IDLE_TIMEOUT, sessionStore };
