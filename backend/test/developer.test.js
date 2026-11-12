const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { hashPassword } = require('../utils/password');
const { sessionStore } = require('../middleware/session');

const dbPath = require.resolve('../db');
const originalDb = require.cache[dbPath];
let server, base, users, statements, draw, broken, released, rolledBack, lastValues;
const rows = [
  { lotteryNumberId: 12, ticketNumber: '000123', purchasedCopies: '2', availableQuantity: 3, consistent: 1 },
  { lotteryNumberId: 13, ticketNumber: '000456', purchasedCopies: '2', availableQuantity: 4, consistent: 0 },
];
const connection = {
  async execute(sql, values) { return this.query(sql, values); },
  async query(sql, values = []) {
    statements.push(sql);
    if (sql.startsWith('SET ') || sql.startsWith('START ')) return [];
    if (broken) throw new Error('private database details');
    if (sql.includes('FROM LotteryDraw d')) return [draw ? [draw] : []];
    if (sql.includes('AS numberCount')) return [[{ numberCount: 1000000, availableCopies: '4999997', purchasedCopies: '4', inconsistentNumbers: '1' }]];
    if (sql.startsWith('SELECT COUNT(*) AS total')) return [[{ total: 1 }]];
    lastValues = values;
    return [rows];
  },
  async commit() { statements.push('COMMIT'); },
  async rollback() { rolledBack = true; },
  release() { released = true; },
};
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  async execute(sql, values) {
    if (sql.startsWith('SELECT UserID, Name, Password, Role')) return [users.filter(u => u.Email === values[0])];
    if (sql.startsWith('SELECT UserID, Name, Role, AccountStatus')) return [users.filter(u => u.UserID === values[0])];
    throw new Error('Unexpected account query');
  },
  async getConnection() { return connection; },
} };

before(async () => {
  process.env.SESSION_SECRET = 'isolated-developer-tests-session-secret-32-characters';
  process.env.NODE_ENV = 'test';
  const password = await hashPassword('DemoPassword123');
  users = ['Customer', 'Admin', 'Developer'].map((Role, index) => ({ UserID: index + 1,
    Name: Role, Email: `${Role}@lotto.test`, Password: password, Role, AccountStatus: 'Active' }));
  server = require('../app').listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  draw = { drawId: 7, drawDate: '2026-10-31', initializationStatus: 'Ready' };
  statements = []; broken = false; released = false; rolledBack = false;
  sessionStore.clear(() => {});
});
after(async () => {
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  if (originalDb) require.cache[dbPath] = originalDb; else delete require.cache[dbPath];
});
async function client(role) {
  let cookie = '';
  const request = async (path, method = 'GET', body, token) => {
    const res = await fetch(base + path, { method, headers: { Cookie: cookie,
      ...(body && { 'Content-Type': 'application/json' }), ...(token && { 'X-CSRF-Token': token }) },
      ...(body && { body: JSON.stringify(body) }) });
    if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    return { status: res.status, body: await res.json() };
  };
  if (role) {
    const token = (await request('/api/auth/csrf')).body.data.csrfToken;
    assert.equal((await request('/api/auth/login', 'POST', { email: `${role}@lotto.test`, password: 'DemoPassword123' }, token)).status, 200);
  }
  return request;
}

test('inventory is Developer-only; visitors, Customers and Admins cannot query it', async () => {
  assert.equal((await (await client())('/api/developer/inventory')).status, 401);
  for (const role of ['Customer', 'Admin']) assert.equal((await (await client(role))('/api/developer/inventory')).status, 403);
  assert.deepEqual(statements, []);
});

test('Developer gets numeric totals and leading-zero numbers from a read-only snapshot', async () => {
  const result = await (await client('Developer'))('/api/developer/inventory');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.data.summary, { numberCount: 1000000, availableCopies: 4999997,
    purchasedCopies: 4, inconsistentNumbers: 1, expectedNumbers: 1000000, missingNumbers: 0, consistent: false });
  assert.equal(result.body.data.items[0].ticketNumber, '000123');
  assert.equal(result.body.data.items[0].consistent, true);
  assert.equal(result.body.data.items[1].consistent, false);
  assert.deepEqual(result.body.meta, { page: 1, pageSize: 20, totalItems: 1000000 });
  assert.ok(statements.includes('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'));
  assert.ok(statements.every(sql => !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|FOR UPDATE)\b/.test(sql)));
  assert.doesNotMatch(JSON.stringify(result.body), /password|email|userId|paymentId|session/i);
  assert.equal(released, true);
});

test('search, mismatch filtering and pagination bind values and leave totals unfiltered', async () => {
  const result = await (await client('Developer'))('/api/developer/inventory?ticketNumber=000456&inconsistentOnly=true&page=2&pageSize=10');
  assert.equal(result.status, 200);
  assert.deepEqual(lastValues, [7, 7, '000456', 10, 10]);
  assert.deepEqual(result.body.meta, { page: 2, pageSize: 10, totalItems: 1 });
  assert.equal(result.body.data.summary.numberCount, 1000000);
});

test('invalid queries are rejected before opening a report connection', async () => {
  const request = await client('Developer');
  for (const query of ['page=0', 'pageSize=101', 'ticketNumber=123', 'ticketNumber=000001&ticketNumber=000002',
    'inconsistentOnly=1', 'inconsistentOnly=true&inconsistentOnly=false', 'drawId=7', 'userId=1']) {
    assert.equal((await request(`/api/developer/inventory?${query}`)).status, 400, query);
  }
  assert.deepEqual(statements, []);
});

test('missing current draw returns 404 and releases its read transaction', async () => {
  draw = null;
  const result = await (await client('Developer'))('/api/developer/inventory');
  assert.equal(result.status, 404);
  assert.equal(result.body.error.code, 'DRAW_NOT_FOUND');
  assert.equal(rolledBack, true);
  assert.equal(released, true);
});

test('database failures stay generic and Developer has no inventory mutation routes', async () => {
  const request = await client('Developer');
  broken = true;
  const result = await request('/api/developer/inventory');
  assert.equal(result.status, 500);
  assert.doesNotMatch(JSON.stringify(result.body), /private database details/);
  assert.equal(rolledBack, true);
  assert.equal(released, true);
  for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await request('/api/developer/inventory', method, {})).status, 404);
});
