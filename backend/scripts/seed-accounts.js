// Creates the Admin and Developer website accounts in the User table.
// npm run seed:accounts creates website roles, separate from MySQL server logins.
const path = require('node:path');
const dotenv = require('dotenv');
const { getPasswordError, hashPassword } = require('../utils/password');

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });

const accounts = [
  { role: 'Admin', name: 'Admin', emailKey: 'SEED_ADMIN_EMAIL', passwordKey: 'SEED_ADMIN_PASSWORD' },
  { role: 'Developer', name: 'Developer', emailKey: 'SEED_DEVELOPER_EMAIL', passwordKey: 'SEED_DEVELOPER_PASSWORD' },
];

function readSettings(env) {
  const settings = accounts.map(account => {
    const email = typeof env[account.emailKey] === 'string' ? env[account.emailKey].trim() : '';
    const password = env[account.passwordKey];
    if (!email) throw new Error(`${account.emailKey} is missing.`);
    if ([...email].length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`${account.emailKey} must be a valid email with at most 254 characters.`);
    }
    if (typeof password !== 'string' || !password) throw new Error(`${account.passwordKey} is missing.`);
    if (/REPLACE_/.test(password)) throw new Error(`${account.passwordKey} still has the placeholder value.`);
    const passwordError = getPasswordError(password);
    if (passwordError) throw new Error(`${account.passwordKey}: ${passwordError}`);
    return { ...account, email, password };
  });
  if (settings[0].email.toLowerCase() === settings[1].email.toLowerCase()) {
    throw new Error('SEED_ADMIN_EMAIL and SEED_DEVELOPER_EMAIL must be different.');
  }
  return settings;
}


async function seedAccounts(env = process.env, db) {
  const settings = readSettings(env);
  db ??= require('../db');
  const results = [];
  for (const { role, name, email, password } of settings) {
    const [rows] = await db.execute('SELECT Role, AccountStatus FROM `User` WHERE Email = ?', [email]);
    if (!rows.length) {
      await db.execute(
        "INSERT INTO `User` (Name, Email, Password, Role, AccountStatus) VALUES (?, ?, ?, ?, 'Active')",
        [name, email, await hashPassword(password), role]);
      results.push({ role, email, status: 'created' });
    } else if (rows[0].Role !== role) {
      results.push({ role, email, status: 'conflict', detail: `email already belongs to a ${rows[0].Role} account` });
    } else if (rows[0].AccountStatus !== 'Active') {
      results.push({ role, email, status: 'deactivated', detail: 'existing account is deactivated and was not reactivated' });
    } else {
      results.push({ role, email, status: 'skipped', detail: 'account already exists' });
    }
  }
  return results;
}

async function main() {
  try {
    for (const { role, email, status, detail } of await seedAccounts()) {
      console.log(`${role} ${email}: ${status}${detail ? ` (${detail})` : ''}`);
      if (status === 'conflict' || status === 'deactivated') process.exitCode = 1;
    }
  } catch (error) {
    // Error output contains setup messages/codes without passwords or hashes.
    console.error(`Cannot seed accounts: ${error.code ? `database error ${error.code}` : error.message}`);
    process.exitCode = 1;
  } finally {
    // Cleanup closes the pool only when configuration validation loaded it.
    const dbPath = require.resolve('../db');
    if (require.cache[dbPath]) await require.cache[dbPath].exports.end();
  }
}

if (require.main === module) main();

module.exports = { seedAccounts };
