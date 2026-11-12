const { validateRegistration } = require('../utils/registration');
const { hashPassword, comparePassword } = require('../utils/password');
const { validateLogin } = require('../utils/login');
const { newCsrfToken } = require('../middleware/csrf');
const { clearSessionCookie } = require('../middleware/session');

// A dummy hash permits bcrypt comparison for unknown emails as well as real accounts.
const dummyHash = '$2b$10$Tvv03SVTeGkIdhbMQqTHpuYm6rYAftZanG0jQUVVGWw442BEym3Ti';

async function register(req, res, next) {
  try {
    const input = validateRegistration(req.body);
    const passwordHash = await hashPassword(input.password);

    // Lazy pool loading keeps startup and health independent of database settings.
    const db = require('../db');
    const [results] = await db.execute(
      'CALL sp_register_user(?, ?, ?, ?)',
      [input.name, input.phone, input.email, passwordHash]
    );
    const user = results[0][0];

    return res.status(201).json({
      data: { userId: user.userId, name: user.name, role: user.role },
    });
  } catch (error) {
    if (error.sqlState === '45000' && error.sqlMessage === 'DUPLICATE_EMAIL') {
      return res.status(409).json({
        error: { code: 'DUPLICATE_EMAIL', message: 'This email is already registered.' },
      });
    }
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const input = validateLogin(req.body);
    const db = require('../db');
    const [rows] = await db.execute(
      'SELECT UserID, Name, Password, Role, AccountStatus FROM `User` WHERE Email = ?',
      [input.email]
    );
    const user = rows[0];
    const matches = await comparePassword(input.password, user?.Password ?? dummyHash);
    if (!user || !matches) {
      return res.status(401).json({ error: {
        code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.',
      } });
    }
    if (user.AccountStatus !== 'Active') {
      return res.status(403).json({ error: {
        code: 'ACCOUNT_DISABLED', message: 'This account is deactivated.',
      } });
    }
    // Successful login replaces the anonymous session ID and CSRF token.
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.userId = user.UserID;
    req.session.lastActivity = Date.now();
    req.session.csrfToken = newCsrfToken();
    await new Promise((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
    return res.json({ data: { userId: user.UserID, name: user.Name, role: user.Role } });
  } catch (error) {
    next(error);
  }
}

function me(req, res) {
  res.json({ data: req.user });
}

function logout(req, res, next) {
  req.session.destroy((error) => {
    if (error) return next(error);
    clearSessionCookie(res);
    res.json({ data: { message: 'Logged out.' } });
  });
}

module.exports = { register, login, me, logout };
