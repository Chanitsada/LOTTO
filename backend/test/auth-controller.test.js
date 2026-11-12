const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { register } = require('../controllers/auth-controller');
const { comparePassword } = require('../utils/password');
const { errorHandler } = require('../middleware/error-handler');

// This isolated test process installs a fake pool before loading the controller;
// unit tests do not connect to a personal database.
const dbPath = require.resolve('../db');
const originalDb = require.cache[dbPath];
const db = { execute: null };
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
after(() => {
  if (originalDb) require.cache[dbPath] = originalDb;
  else delete require.cache[dbPath];
});
beforeEach(() => {
  db.execute = async () => assert.fail('This request must not reach the database');
});

function validInput(overrides = {}) {
  return {
    name: "  Demo O'Connor  ", phone: ' 0812345678 ',
    email: ' Customer@example.com ', password: ' password with spaces ',
    ...overrides,
  };
}

async function request(body) {
  let status;
  let payload;
  const res = {
    headersSent: false,
    status(value) { status = value; return this; },
    json(value) { payload = value; return this; },
  };
  await register({ body }, res, (error) => {
    errorHandler(error, {}, res, () => assert.fail('Error must be handled'));
  });
  return { status, payload };
}

test('registration passes validated values and a password hash to SQL and returns only public fields', async () => {
  const input = validInput();
  let parameters;
  let calls = 0;
  db.execute = async (sql, values) => {
    calls++;
    assert.equal(sql, 'CALL sp_register_user(?, ?, ?, ?)');
    parameters = values;
    return [[[{ userId: 17, name: "Demo O'Connor", role: 'Customer', Password: 'PRIVATE_HASH' }], {}], []];
  };
  const response = await request(input);
  assert.equal(calls, 1);
  assert.deepEqual(parameters.slice(0, 3), ["Demo O'Connor", '0812345678', 'Customer@example.com']);
  assert.notEqual(parameters[3], input.password);
  assert.equal(await comparePassword(input.password, parameters[3]), true);
  assert.deepEqual(response, {
    status: 201, payload: { data: { userId: 17, name: "Demo O'Connor", role: 'Customer' } },
  });
});

test('registration rejects missing, invalid, privileged and legacy frontend fields before database access', async () => {
  for (const body of [undefined, validInput({ password: 'short' }), validInput({ role: 'Admin' }),
    validInput({ firstName: 'Demo', lastName: 'Customer' }), validInput({ remember: true })]) {
    const response = await request(body);
    assert.equal(response.status, 400);
    assert.equal(response.payload.error.code, 'VALIDATION_ERROR');
  }
});

test('the procedure duplicate-email signal becomes a safe 409 response', async () => {
  db.execute = async () => {
    throw Object.assign(new Error('PRIVATE_SQL_DETAILS'), {
      sqlState: '45000', sqlMessage: 'DUPLICATE_EMAIL',
    });
  };
  assert.deepEqual(await request(validInput()), {
    status: 409,
    payload: { error: { code: 'DUPLICATE_EMAIL', message: 'This email is already registered.' } },
  });
});

test('unexpected SQL errors remain generic 500 responses', async () => {
  db.execute = async () => { throw new Error('PRIVATE_SQL_OR_CREDENTIAL_DETAILS'); };
  assert.deepEqual(await request(validInput()), {
    status: 500,
    payload: { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } },
  });
});

test('the app still imports without .env or database settings and does not load the pool', () => {
  const result = spawnSync(process.execPath, ['-e', `
    require('dotenv').config = () => ({ error: { code: 'ENOENT' } });
    for (const key of ['DB_USER', 'DB_PASSWORD', 'DB_NAME']) delete process.env[key];
    const app = require('./app');
    if (typeof app !== 'function' || require.cache[require.resolve('./db')]) {
      throw new Error('The app unexpectedly loaded the database at startup');
    }
  `], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
