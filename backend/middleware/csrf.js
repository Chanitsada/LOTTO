const { randomBytes, timingSafeEqual } = require('node:crypto');

function newCsrfToken() {
  return randomBytes(32).toString('hex');
}

function csrfToken(req, res, next) {
  req.session.csrfToken ??= newCsrfToken();
  req.session.save((error) => {
    if (error) return next(error);
    res.json({ data: { csrfToken: req.session.csrfToken } });
  });
}

function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const supplied = req.get('X-CSRF-Token');
  const expected = req.session?.csrfToken;
  if (typeof supplied !== 'string' || typeof expected !== 'string' ||
      !/^[a-f0-9]{64}$/.test(supplied) || !/^[a-f0-9]{64}$/.test(expected) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.status(403).json({ error: {
      code: 'INVALID_CSRF_TOKEN', message: 'The form has expired. Please try again.',
    } });
  }
  next();
}

module.exports = { csrfToken, requireCsrf, newCsrfToken };
