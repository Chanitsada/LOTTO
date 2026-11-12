const { getPasswordError } = require('./password');

function invalidRegistration(message) {
  const error = new Error(message);
  error.code = 'VALIDATION_ERROR';
  throw error;
}

function validateRegistration(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    invalidRegistration('Registration data must be a JSON object.');
  }

  const fields = ['name', 'phone', 'email', 'password'];
  if (Object.keys(body).some((field) => !fields.includes(field))) {
    invalidRegistration('Only name, phone, email and password are allowed.');
  }

  for (const field of fields) {
    if (!Object.hasOwn(body, field) || typeof body[field] !== 'string') {
      invalidRegistration(`${field} is required and must be a string.`);
    }
  }

  const name = body.name.trim();
  const phone = body.phone.trim();
  const email = body.email.trim();

  if (!name || [...name].length > 100) {
    invalidRegistration('Name must contain 1 to 100 characters.');
  }

  if (!phone || [...phone].length > 20) {
    invalidRegistration('Phone must contain 1 to 20 characters.');
  }

  // Email syntax validation does not verify ownership or delivery.
  if ([...email].length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    invalidRegistration('Email must have a valid format and at most 254 characters.');
  }

  const passwordError = getPasswordError(body.password);
  if (passwordError) {
    invalidRegistration(passwordError);
  }

  // Normalization preserves password contents and leaves the input object unchanged.
  return { name, phone, email, password: body.password };
}

module.exports = { validateRegistration };
