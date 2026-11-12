const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { hashPassword } = require('../utils/password');
const { IDLE_TIMEOUT, sessionStore: store } = require('../middleware/session');

// Real MemoryStore and HTTP middleware use fake accounts in these tests.
// npm test never reads a personal database.
const dbPath = require.resolve('../db');
const originalDb = require.cache[dbPath];
const limitPath = require.resolve('express-rate-limit');
const originalLimit = require(limitPath);
let limiter;
require.cache[limitPath].exports = { ...originalLimit, rateLimit(options) {
  limiter = originalLimit.rateLimit(options);
  return limiter;
} };
let server, base, account, passwordHash;
let databaseFailure = false;
const password = ' DemoPassword123 ';
const db = {
  async execute(sql, values) {
    if (databaseFailure) throw new Error('PRIVATE_DATABASE_DETAILS');
    assert.match(sql, /^SELECT UserID, Name,/);
    if (sql.includes('WHERE Email = ?')) {
      assert.equal(values.length, 1);
      return [[values[0] === account.Email ? { ...account } : undefined].filter(Boolean)];
    }
    assert.match(sql, /WHERE UserID = \?/);
    assert.deepEqual(values, [account.UserID]);
    return [[{ ...account }]];
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
  account = { UserID: 17, Name: 'Demo Customer', Email: 'demo@example.com',
    Password: passwordHash, Role: 'Customer', AccountStatus: 'Active' };
  databaseFailure = false;
  limiter.resetKey('127.0.0.1');
  if (store) store.clear(() => {});
});

after(async () => {
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  if (originalDb) require.cache[dbPath] = originalDb; else delete require.cache[dbPath];
  require.cache[limitPath].exports = originalLimit;
});

function browser() {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async request(path, { method = 'GET', body, token, headers = {} } = {}) {
      const response = await fetch(base + path, {
        method, headers: {
          ...(cookie && { Cookie: cookie }),
          ...(body !== undefined && { 'Content-Type': 'application/json' }),
          ...(token && { 'X-CSRF-Token': token }), ...headers,
        },
        ...(body !== undefined && { body: typeof body === 'string' ? body : JSON.stringify(body) }),
      });
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      return { status: response.status, headers: response.headers, body: await response.json() };
    },
    async csrf() {
      const response = await this.request('/api/auth/csrf');
      assert.equal(response.status, 200);
      assert.match(response.body.data.csrfToken, /^[a-f0-9]{64}$/);
      return response.body.data.csrfToken;
    },
    async login(overrides = {}) {
      return this.request('/api/auth/login', {
        method: 'POST', token: await this.csrf(),
        body: { email: ' demo@example.com ', password, ...overrides },
      });
    },
  };
}

test('missing or placeholder secrets disable auth safely while health still works', async () => {
  const configured = process.env.SESSION_SECRET;
  const client = browser();
  try {
    for (const secret of ['', 'short', 'REPLACE_WITH_UNIQUE_RANDOM_SECRET']) {
      process.env.SESSION_SECRET = secret;
      const result = await client.request('/api/auth/csrf');
      assert.equal(result.status, 503);
      assert.equal(result.body.error.code, 'AUTH_NOT_CONFIGURED');
      assert.equal((await client.request('/api/health')).status, 200);
    }
  } finally {
    process.env.SESSION_SECRET = configured;
  }
});

test('login rotates the session ID/token, persists identity and logout invalidates the old cookie', async () => {
  const client = browser();
  const token = await client.csrf();
  const anonymous = client.cookie;
  const login = await client.request('/api/auth/login', {
    method: 'POST', token, body: { email: account.Email, password },
  });
  assert.equal(login.status, 200);
  assert.deepEqual(login.body, { data: { userId: 17, name: 'Demo Customer', role: 'Customer' } });
  assert.notEqual(client.cookie, anonymous);
  assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(login.headers.get('set-cookie'), /SameSite=Lax/i);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  const expires = login.headers.get('set-cookie').match(/Expires=([^;]+)/)[1];
  assert.ok(Math.abs(new Date(expires).getTime() - Date.now() - IDLE_TIMEOUT) < 3000);
  const loggedInCookie = client.cookie;
  assert.deepEqual((await client.request('/api/auth/me')).body, login.body);
  const newToken = await client.csrf();
  assert.notEqual(newToken, token);
  assert.equal((await client.request('/api/auth/logout', { method: 'POST', token, body: {} })).status, 403);
  assert.equal((await client.request('/api/auth/logout', { method: 'POST', token: newToken, body: {} })).status, 200);
  assert.equal((await client.request('/api/auth/me', { headers: { Cookie: loggedInCookie } })).status, 401);
});

test('wrong password and unknown email have the same safe error; invalid fields fail', async () => {
  const client = browser();
  const wrong = await client.login({ password: 'WrongPassword123' });
  const unknown = await client.login({ email: 'missing@example.com' });
  assert.equal(wrong.status, 401);
  assert.equal(unknown.status, 401);
  assert.deepEqual(wrong.body, unknown.body);
  for (const overrides of [{ role: 'Admin' }, { userId: 17 }, { remember: true },
    { password: 'short' }, { password: 'ก'.repeat(25) }, { email: 'bad' }]) {
    assert.equal((await client.login(overrides)).status, 400);
  }
});

test('CSRF protects login and signup, including invalid multibyte tokens and another browser token', async () => {
  const client = browser();
  const token = await browser().csrf();
  for (const supplied of [undefined, 'é'.repeat(64), token]) {
    for (const path of ['/api/auth/login', '/api/auth/register']) {
      const result = await client.request(path, { method: 'POST', body: {}, token: supplied });
      assert.equal(result.status, 403);
      assert.equal(result.body.error.code, 'INVALID_CSRF_TOKEN');
    }
  }
});

test('deactivated accounts cannot log in and existing sessions lose access', async () => {
  const client = browser();
  assert.equal((await client.login()).status, 200);
  account.AccountStatus = 'Deactivated';
  const result = await client.request('/api/auth/me');
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, 'ACCOUNT_DISABLED');
  assert.equal((await client.request('/api/auth/me')).status, 401);
  assert.equal((await client.login()).status, 403);
});

test('server rejects 30-minute inactivity even with a still-valid cookie and renews active sessions', async () => {
  const client = browser();
  assert.equal((await client.login()).status, 200);
  const [sid] = Object.keys(store.sessions);
  let saved = JSON.parse(store.sessions[sid]);
  saved.lastActivity = Date.now() - IDLE_TIMEOUT;
  store.sessions[sid] = JSON.stringify(saved);
  assert.equal((await client.request('/api/auth/me')).status, 401);
  assert.equal(store.sessions[sid], undefined);

  assert.equal((await client.login()).status, 200);
  const [activeSid] = Object.keys(store.sessions);
  saved = JSON.parse(store.sessions[activeSid]);
  saved.lastActivity = Date.now() - 1000;
  store.sessions[activeSid] = JSON.stringify(saved);
  assert.equal((await client.request('/api/auth/me')).status, 200);
  assert.ok(JSON.parse(store.sessions[activeSid]).lastActivity > saved.lastActivity);
});

test('private API guards enforce current role and still protect unknown endpoints', async () => {
  const client = browser();
  assert.equal((await client.request('/api/admin/dashboard')).status, 401);
  assert.equal((await client.login()).status, 200);
  assert.equal((await client.request('/api/admin/dashboard')).status, 403);
  assert.equal((await client.request('/api/me/not-implemented')).status, 404);
  account.Role = 'Developer';
  assert.equal((await client.request('/api/admin/dashboard')).status, 403);
  assert.equal((await client.request('/api/me/tickets')).status, 403);
  account.Role = 'Admin';
  assert.equal((await client.request('/api/admin/not-implemented')).status, 404);
  assert.equal((await client.request('/api/admin/draws', { method: 'POST', body: {} })).status, 403);
  assert.equal((await client.request('/api/admin/draws', { method: 'POST', token: await client.csrf(), body: {} })).status, 404);
});

test('database errors stay generic and health/unknown routes stay independent', async () => {
  const client = browser();
  databaseFailure = true;
  const result = await client.login();
  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
  assert.equal((await client.request('/api/health')).status, 200);
  assert.equal((await client.request('/api/auth/unknown')).status, 404);
});

test('repeated failed login attempts are rate limited', async () => {
  const client = browser();
  let result;
  for (let index = 0; index < 11; index++) result = await client.login({ password: 'WrongPassword123' });
  assert.equal(result.status, 429);
  assert.equal(result.body.error.code, 'TOO_MANY_ATTEMPTS');
  assert.ok(result.headers.get('retry-after'));
});

// A process restart creates a new MemoryStore; the old cookie has no stored login.
test('demo memory sessions keep login across requests and clearing memory requires login again', async () => {
  const client = browser();
  assert.equal((await client.login()).status, 200);
  assert.equal((await client.request('/api/health')).status, 200);
  assert.equal((await client.request('/api/auth/me')).status, 200);
  await new Promise(resolve => store.clear(resolve));
  assert.equal((await client.request('/api/auth/me')).status, 401);
});
