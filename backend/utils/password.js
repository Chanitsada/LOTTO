const bcrypt = require('bcrypt');

const BCRYPT_COST = 10;

function getPasswordError(password) {
  if (typeof password !== 'string') {
    return 'Password must be a string.';
  }

  // Unicode character count and bcrypt's UTF-8 byte limit are separate constraints.
  if ([...password].length < 8) {
    return 'Password must contain at least 8 characters.';
  }

  if (Buffer.byteLength(password, 'utf8') > 72) {
    return 'Password must not exceed 72 UTF-8 bytes.';
  }

  return null;
}

async function hashPassword(password) {
  const error = getPasswordError(password);
  if (error) {
    throw new TypeError(error);
  }

  return bcrypt.hash(password, BCRYPT_COST);
}

async function comparePassword(password, storedHash) {
  // Validation rejects overlong input before bcrypt comparison can truncate it.
  if (getPasswordError(password) || typeof storedHash !== 'string') {
    return false;
  }

  return bcrypt.compare(password, storedHash);
}

module.exports = { getPasswordError, hashPassword, comparePassword };
