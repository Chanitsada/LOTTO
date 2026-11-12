const { getPasswordError } = require('./password');

function validateLogin(body) {
  const invalid = (message) => {
    throw Object.assign(new Error(message), { code: 'VALIDATION_ERROR' });
  };
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(field => !['email', 'password'].includes(field)) ||
      !Object.hasOwn(body, 'email') || !Object.hasOwn(body, 'password') ||
      typeof body.email !== 'string' || typeof body.password !== 'string') {
    invalid('Send only email and password as strings.');
  }
  const email = body.email.trim();
  if ([...email].length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    invalid('Email must have a valid format and at most 254 characters.');
  }
  const passwordError = getPasswordError(body.password);
  if (passwordError) invalid(passwordError);
  return { email, password: body.password };
}

module.exports = { validateLogin };
