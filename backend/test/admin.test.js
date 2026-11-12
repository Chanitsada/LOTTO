const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { hashPassword } = require('../utils/password');
const { sessionStore: store } = require('../middleware/session');

const dbPath = require.resolve('../db');
const originalDb = require.cache[dbPath];
const password = 'DemoPassword123';
let server, base, passwordHash, users, payments, tickets, statements;

const publicUser = u => ({ userId: u.UserID, name: u.Name, phone: u.Phone, email: u.Email, accountStatus: u.AccountStatus });
const customers = () => users.filter(u => u.Role === 'Customer').sort((a, b) => a.UserID - b.UserID);
const db = {
  async execute(sql, values = []) {
    statements.push(sql);
    if (sql.startsWith('SELECT UserID, Name, Password, Role')) return [users.filter(u => u.Email === values[0])];
    if (sql.startsWith('SELECT UserID, Name, Role, AccountStatus')) return [users.filter(u => u.UserID === values[0])];
    if (sql.includes('SELECT UserID AS userId, Name AS name, Phone AS phone, Email AS email')) {
      return [users.filter(u => u.UserID === values[0]).map(u => ({ userId: u.UserID, name: u.Name, phone: u.Phone, email: u.Email }))];
    }
    if (sql === "SELECT COUNT(*) AS total FROM `User` WHERE Role = 'Customer'") return [[{ total: customers().length }]];
    if (sql === 'SELECT UserID, Role FROM `User` WHERE UserID = ?') {
      return [users.filter(u => u.UserID === values[0]).map(u => ({ UserID: u.UserID, Role: u.Role }))];
    }
    if (sql === "UPDATE `User` SET AccountStatus = 'Deactivated' WHERE UserID = ? AND Role = 'Customer'") {
      const user = users.find(u => u.UserID === values[0] && u.Role === 'Customer');
      if (user) user.AccountStatus = 'Deactivated';
      return [{ affectedRows: user ? 1 : 0 }];
    }
    assert.fail(`Unexpected SQL: ${sql}`);
  },
  async query(sql, values) {
    statements.push(sql);
    assert.match(sql, /FROM `User` WHERE Role = 'Customer'\s+ORDER BY UserID LIMIT \? OFFSET \?/);
    const [limit, offset] = values;
    return [customers().slice(offset, offset + limit).map(publicUser)];
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
  payments = [{ PaymentID: 1, UserID: 1, Amount: '200.00' }];
  tickets = [{ TicketID: 1, UserID: 1, PaymentID: 1 }, { TicketID: 2, UserID: 1, PaymentID: 1 }];
  statements = [];
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
    async login(email) {
      const result = await this.request('/api/auth/login', { method: 'POST', token: await this.csrf(), body: { email, password } });
      assert.equal(result.status, 200);
      return this.csrf();
    },
  };
}

async function admin() {
  const client = browser();
  client.token = await client.login('admin@lotto.test');
  return client;
}
const deactivate = (client, customerId, options = {}) => client.request(`/api/admin/customers/${customerId}/deactivate`,
  { method: 'POST', token: client.token, body: {}, ...options });

test('Admin lists only Customers with public details and status', async () => {
  const client = await admin();
  const result = await client.request('/api/admin/customers');
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    data: { items: [
      { userId: 1, name: 'Test Customer', phone: '0812345678', email: 'test@lotto.test', accountStatus: 'Active' },
      { userId: 2, name: 'Other Customer', phone: '0812345678', email: 'other@lotto.test', accountStatus: 'Active' },
    ] },
    meta: { page: 1, pageSize: 20, totalItems: 2 },
  });
  assert.doesNotMatch(JSON.stringify(result.body), /password|\$2[ab]\$|Admin|Developer/i);
});

test('customer list paginates and rejects invalid pagination', async () => {
  for (let id = 10; id < 35; id++) {
    users.push({ UserID: id, Name: `Customer ${id}`, Phone: '0800000000', Email: `c${id}@lotto.test`,
      Password: passwordHash, Role: 'Customer', AccountStatus: 'Active' });
  }
  const client = await admin();
  const second = await client.request('/api/admin/customers?page=2&pageSize=10');
  assert.equal(second.status, 200);
  assert.deepEqual(second.body.meta, { page: 2, pageSize: 10, totalItems: 27 });
  assert.deepEqual(second.body.data.items.map(i => i.userId), [18, 19, 20, 21, 22, 23, 24, 25, 26, 27]);
  const last = await client.request('/api/admin/customers?page=3&pageSize=10');
  assert.equal(last.body.data.items.length, 7);
  const beyond = await client.request('/api/admin/customers?page=99&pageSize=10');
  assert.deepEqual([beyond.status, beyond.body.data.items], [200, []]);
  for (const query of ['page=0', 'page=abc', 'pageSize=0', 'pageSize=101', 'role=Admin']) {
    assert.equal((await client.request(`/api/admin/customers?${query}`)).status, 400, query);
  }
});

test('visitors get 401; Customers and Developers get 403', async () => {
  const visitor = browser();
  assert.equal((await visitor.request('/api/admin/customers')).status, 401);
  assert.equal((await visitor.request('/api/admin/customers/1/deactivate', { method: 'POST', body: {} })).status, 401);
  for (const email of ['test@lotto.test', 'developer@lotto.test']) {
    const client = browser();
    const token = await client.login(email);
    assert.equal((await client.request('/api/admin/customers')).status, 403, email);
    assert.equal((await client.request('/api/admin/customers/2/deactivate', { method: 'POST', token, body: {} })).status, 403, email);
  }
  assert.equal(users[1].AccountStatus, 'Active');
});

test('deactivation without a valid CSRF token is rejected', async () => {
  const client = await admin();
  const missing = await deactivate(client, 1, { token: undefined });
  assert.equal(missing.status, 403);
  assert.equal(missing.body.error.code, 'INVALID_CSRF_TOKEN');
  assert.equal((await deactivate(client, 1, { token: 'b'.repeat(64) })).status, 403);
  assert.equal(users[0].AccountStatus, 'Active');
});

test('invalid IDs and request bodies return 400', async () => {
  const client = await admin();
  for (const customerId of ['0', '-1', 'abc', '1.5', '2147483648', '1e3']) {
    assert.equal((await deactivate(client, customerId)).status, 400, customerId);
  }
  for (const body of [undefined, [], { reason: 'x' }, { userId: 1 }]) {
    assert.equal((await deactivate(client, 1, { body })).status, 400, JSON.stringify(body));
  }
  assert.equal(users[0].AccountStatus, 'Active');
});

test('missing accounts and non-Customer targets return 404', async () => {
  const client = await admin();
  for (const customerId of [999, 3, 4]) {
    const result = await deactivate(client, customerId);
    assert.equal(result.status, 404, String(customerId));
    assert.equal(result.body.error.code, 'NOT_FOUND');
  }
  assert.equal(users[2].AccountStatus, 'Active');
  assert.equal(users[3].AccountStatus, 'Active');
});

test('deactivation succeeds, is repeatable and changes only that Customer', async () => {
  const client = await admin();
  const first = await deactivate(client, 1);
  assert.deepEqual(first, { status: 200, body: { data: { userId: 1, accountStatus: 'Deactivated' } } });
  const again = await deactivate(client, 1);
  assert.deepEqual(again, first);
  assert.deepEqual(users.map(u => u.AccountStatus), ['Deactivated', 'Active', 'Active', 'Active']);
  const list = await client.request('/api/admin/customers');
  assert.deepEqual(list.body.data.items.map(i => i.accountStatus), ['Deactivated', 'Active']);
  assert.equal(list.body.meta.totalItems, 2);
});

test('an existing Customer session loses access after deactivation', async () => {
  const customer = browser();
  await customer.login('test@lotto.test');
  assert.equal((await customer.request('/api/me/profile')).status, 200);

  assert.equal((await deactivate(await admin(), 1)).status, 200);

  const blocked = await customer.request('/api/me/profile');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'ACCOUNT_DISABLED');
  assert.equal((await customer.request('/api/auth/me')).status, 401); // The session was destroyed.
  const login = await customer.request('/api/auth/login', { method: 'POST', token: await customer.csrf(),
    body: { email: 'test@lotto.test', password } });
  assert.equal(login.status, 403);
});

test('deactivation keeps users, tickets and payments unchanged', async () => {
  const paymentsBefore = structuredClone(payments);
  const ticketsBefore = structuredClone(tickets);
  const userCount = users.length;
  assert.equal((await deactivate(await admin(), 1)).status, 200);
  assert.deepEqual(payments, paymentsBefore);
  assert.deepEqual(tickets, ticketsBefore);
  assert.equal(users.length, userCount);
  assert.ok(statements.every(sql => !/DELETE|Payment|LotteryTicket/i.test(sql)));
});
