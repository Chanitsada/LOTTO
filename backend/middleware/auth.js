const { clearSessionCookie, IDLE_TIMEOUT } = require('./session');

async function requireLogin(req, res, next) {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ error: { code: 'LOGIN_REQUIRED', message: 'Please sign in.' } });
    }
    const expired = !Number.isFinite(req.session.lastActivity) ||
      Date.now() - req.session.lastActivity >= IDLE_TIMEOUT;
    const db = require('../db');
    const [rows] = expired ? [[]] : await db.execute(
      'SELECT UserID, Name, Role, AccountStatus FROM `User` WHERE UserID = ?',
      [req.session.userId]
    );
    const user = rows[0];
    if (!user || user.AccountStatus !== 'Active') {
      await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
      clearSessionCookie(res);
      const disabled = user?.AccountStatus === 'Deactivated';
      return res.status(disabled ? 403 : 401).json({ error: {
        code: disabled ? 'ACCOUNT_DISABLED' : 'LOGIN_REQUIRED',
        message: disabled ? 'This account is deactivated.' : 'Please sign in.',
      } });
    }
    // Each request reloads account status/role; the browser cannot select its identity.
    req.user = { userId: user.UserID, name: user.Name, role: user.Role };
    req.session.lastActivity = Date.now();
    next();
  } catch (error) {
    next(error);
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'LOGIN_REQUIRED', message: 'Please sign in.' } });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access is not allowed.' } });
    }
    next();
  };
}

module.exports = { requireLogin, requireRole };
