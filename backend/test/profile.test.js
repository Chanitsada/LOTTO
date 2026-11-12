const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { hashPassword } = require('../utils/password');
const { sessionStore: store } = require('../middleware/session');

const dbPath = require.resolve('../db');
const originalDb = require.cache[dbPath];
const password = 'DemoPassword123';
let server, base, passwordHash, users, updates;

const db = {
  async execute(sql, values) {
    if (sql.startsWith('SELECT UserID, Name, Password, Role')) {
      return [users.filter(u => u.Email === values[0])];
    }
    if (sql.startsWith('SELECT UserID, Name, Role, AccountStatus')) {
      return [users.filter(u => u.UserID === values[0])];
    }
    if (sql.includes('SELECT UserID AS userId, Name AS name, Phone AS phone, Email AS email')) {
      return [users.filter(u => u.UserID === values[0])
        .map(u => ({ userId: u.UserID, name: u.Name, phone: u.Phone, email: u.Email }))];
    }
    const update = sql.match(/^UPDATE `User` SET (.+) WHERE UserID = \?$/);
    assert.ok(update, `Unexpected SQL: ${sql}`);
    const columns = update[1].split(', ').map(part => part.replace(' = ?', ''));
    const userId = values.at(-1);
    updates.push({ columns, userId });
    const user = users.find(u => u.UserID === userId);
    columns.forEach((column, i) => { user[column] = values[i]; });
    return [{ affectedRows: 1 }];
  },
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };

before(async () => {
  process.env.SESSION_SECRET = 'isolated-test-session-secret-at-least-32-characters';
  process.env.NODE_ENV = 'test';
  passwordHash = await hashPassword(password);
  server = require('../app').listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  const account = (UserID, Name, Email, Role) => ({ UserID, Name, Phone: '0812345678', Email,
    Password: passwordHash, Role, AccountStatus: 'Active' });
  users = [
    account(1, 'Test Customer', 'test@lotto.test', 'Customer'),
    account(2, 'Other Customer', 'other@lotto.test', 'Customer'),
    account(3, 'Admin', 'admin@lotto.test', 'Admin'),
    account(4, 'Developer', 'developer@lotto.test', 'Developer'),
  ];
  updates = [];
  store.clear(() => {});
});

after(async () => {
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  if (originalDb) require.cache[dbPath] = originalDb; else delete require.cache[dbPath];
});

function browser() {
  let cookie = '';
  return {
    async request(path, { method = 'GET', body, token } = {}) {
      const response = await fetch(base + path, {
        method, headers: {
          ...(cookie && { Cookie: cookie }),
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
          ...(token && { 'X-CSRF-Token': token }),
        },
        ...(body !== undefined && { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { status: response.status, body: await response.json() };
    },
    async csrf() {
      return (await this.request('/api/auth/csrf')).body.data.csrfToken;
    },
    // Returns a fresh CSRF token for the logged-in session.
    async login(email = 'test@lotto.test') {
      const result = await this.request('/api/auth/login', { method: 'POST', token: await this.csrf(), body: { email, password } });
      assert.equal(result.status, 200);
      return this.csrf();
    },
  };
}

test('GET returns only the logged-in Customer without password data', async () => {
  const client = browser();
  await client.login();
  const result = await client.request('/api/me/profile');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { data: { userId: 1, name: 'Test Customer', phone: '0812345678', email: 'test@lotto.test' } });
  assert.doesNotMatch(JSON.stringify(result.body), /password|\$2[ab]\$/i);
});

test('PATCH updates name and phone, trims values and returns the GET shape', async () => {
  const client = browser();
  const token = await client.login();
  const result = await client.request('/api/me/profile', { method: 'PATCH', token,
    body: { name: '  Updated Customer ', phone: ' 0899999999 ' } });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { data: { userId: 1, name: 'Updated Customer', phone: '0899999999', email: 'test@lotto.test' } });
  assert.deepEqual((await client.request('/api/me/profile')).body, result.body);
  assert.doesNotMatch(JSON.stringify(result.body), /password|\$2[ab]\$/i);
});

test('PATCH can update only name or only phone', async () => {
  const client = browser();
  const token = await client.login();
  const name = await client.request('/api/me/profile', { method: 'PATCH', token, body: { name: 'Only Name' } });
  assert.deepEqual([name.status, name.body.data.name, name.body.data.phone], [200, 'Only Name', '0812345678']);
  const phone = await client.request('/api/me/profile', { method: 'PATCH', token, body: { phone: '0800000000' } });
  assert.deepEqual([phone.status, phone.body.data.name, phone.body.data.phone], [200, 'Only Name', '0800000000']);
  assert.deepEqual(updates.map(u => u.columns), [['Name'], ['Phone']]);
});

test('PATCH updates only the session account, even if a user ID is sent', async () => {
  const client = browser();
  const token = await client.login();
  await client.request('/api/me/profile', { method: 'PATCH', token, body: { name: 'Changed' } });
  assert.deepEqual(updates, [{ columns: ['Name'], userId: 1 }]);
  assert.equal(users[1].Name, 'Other Customer');
  const forged = await client.request('/api/me/profile', { method: 'PATCH', token, body: { name: 'Hacked', userId: 2 } });
  assert.equal(forged.status, 400);
  assert.equal(users[1].Name, 'Other Customer');
});

test('PATCH rejects empty, overlong, missing, non-string and unexpected fields with 400', async () => {
  const client = browser();
  const token = await client.login();
  const bad = [
    undefined, {}, [], { name: '' }, { name: '   ' }, { phone: '' }, { phone: '   ' },
    { name: 'a'.repeat(101) }, { phone: '1'.repeat(21) }, { name: 123 }, { phone: null }, { name: ['x'] },
    { name: 'Valid', email: 'new@lotto.test' }, { email: 'new@lotto.test' }, { role: 'Admin' },
    { accountStatus: 'Deactivated' }, { userId: 2 }, { name: 'Valid', password: 'NewPassword123' },
  ];
  for (const body of bad) {
    const result = await client.request('/api/me/profile', { method: 'PATCH', token, body });
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  }
  for (const body of ['{bad', 'text']) {
    const invalidJson = await client.request('/api/me/profile', { method: 'PATCH', token, body });
    assert.deepEqual([invalidJson.status, invalidJson.body.error.code], [400, 'INVALID_JSON']);
  }
  assert.deepEqual(updates, []);
  // Boundary values are accepted.
  const max = await client.request('/api/me/profile', { method: 'PATCH', token,
    body: { name: 'a'.repeat(100), phone: '1'.repeat(20) } });
  assert.equal(max.status, 200);
});

test('visitors get 401', async () => {
  const client = browser();
  assert.equal((await client.request('/api/me/profile')).status, 401);
  assert.equal((await client.request('/api/me/profile', { method: 'PATCH', body: { name: 'X' } })).status, 401);
});

test('Admin and Developer accounts are rejected with 403', async () => {
  for (const email of ['admin@lotto.test', 'developer@lotto.test']) {
    const client = browser();
    const token = await client.login(email);
    assert.equal((await client.request('/api/me/profile')).status, 403);
    assert.equal((await client.request('/api/me/profile', { method: 'PATCH', token, body: { name: 'X' } })).status, 403);
  }
  assert.deepEqual(updates, []);
});

test('PATCH without a valid CSRF token is rejected', async () => {
  const client = browser();
  const token = await client.login();
  const missing = await client.request('/api/me/profile', { method: 'PATCH', body: { name: 'X' } });
  assert.equal(missing.status, 403);
  assert.equal(missing.body.error.code, 'INVALID_CSRF_TOKEN');
  const wrong = await client.request('/api/me/profile', { method: 'PATCH', token: 'a'.repeat(64), body: { name: 'X' } });
  assert.equal(wrong.status, 403);
  assert.notEqual(token, 'a'.repeat(64));
  assert.deepEqual(updates, []);
});
