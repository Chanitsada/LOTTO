const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcrypt');
const { seedAccounts } = require('../scripts/seed-accounts');

let users;
const db = {
  async execute(sql, values) {
    if (sql.startsWith('SELECT Role, AccountStatus')) {
      return [users.filter(u => u.Email.toLowerCase() === values[0].toLowerCase())];
    }
    assert.match(sql, /^INSERT INTO `User` \(Name, Email, Password, Role, AccountStatus\)/);
    const [Name, Email, Password, Role] = values;
    users.push({ Name, Email, Password, Role, AccountStatus: 'Active' });
    return [{ insertId: users.length }];
  },
};
const env = (overrides = {}) => ({
  SEED_ADMIN_EMAIL: 'admin@lotto.test', SEED_ADMIN_PASSWORD: 'AdminPassword123',
  SEED_DEVELOPER_EMAIL: 'developer@lotto.test', SEED_DEVELOPER_PASSWORD: 'DeveloperPassword123',
  ...overrides,
});
const statuses = results => results.map(r => `${r.role}:${r.status}`);

beforeEach(() => { users = []; });

test('creates Admin and Developer as Active with working bcrypt passwords', async () => {
  const results = await seedAccounts(env(), db);
  assert.deepEqual(statuses(results), ['Admin:created', 'Developer:created']);
  const admin = users.find(u => u.Email === 'admin@lotto.test');
  const developer = users.find(u => u.Email === 'developer@lotto.test');
  assert.equal(admin.Role, 'Admin');
  assert.equal(admin.Name, 'Admin');
  assert.equal(developer.Role, 'Developer');
  assert.equal(developer.Name, 'Developer');
  for (const user of users) assert.equal(user.AccountStatus, 'Active');
  assert.notEqual(admin.Password, 'AdminPassword123');
  assert.ok(await bcrypt.compare('AdminPassword123', admin.Password));
  assert.ok(await bcrypt.compare('DeveloperPassword123', developer.Password));
  assert.equal(await bcrypt.compare('AdminPassword123', developer.Password), false);
});

test('results never contain passwords or hashes', async () => {
  const results = await seedAccounts(env(), db);
  const text = JSON.stringify(results);
  assert.doesNotMatch(text, /AdminPassword123|DeveloperPassword123|\$2[ab]\$/);
});

test('rerun skips existing accounts and keeps their passwords and details', async () => {
  await seedAccounts(env(), db);
  const before = JSON.parse(JSON.stringify(users));
  const results = await seedAccounts(env({ SEED_ADMIN_PASSWORD: 'ChangedPassword123' }), db);
  assert.deepEqual(statuses(results), ['Admin:skipped', 'Developer:skipped']);
  assert.deepEqual(users, before);
});

test('creates only the missing account', async () => {
  await seedAccounts(env(), db);
  users = users.filter(u => u.Role === 'Admin');
  assert.deepEqual(statuses(await seedAccounts(env(), db)), ['Admin:skipped', 'Developer:created']);
  assert.equal(users.length, 2);
});

test('missing or invalid settings are rejected before any database call', async () => {
  const noDb = { execute: async () => assert.fail('Database must not be used') };
  const bad = [
    { SEED_ADMIN_EMAIL: undefined }, { SEED_ADMIN_EMAIL: '   ' }, { SEED_ADMIN_EMAIL: 'not-an-email' },
    { SEED_DEVELOPER_EMAIL: undefined }, { SEED_ADMIN_PASSWORD: undefined }, { SEED_ADMIN_PASSWORD: '' },
    { SEED_ADMIN_PASSWORD: 'short' }, { SEED_DEVELOPER_PASSWORD: 'ก'.repeat(25) },
    { SEED_DEVELOPER_PASSWORD: 'REPLACE_WITH_LOCAL_DEVELOPER_PASSWORD' },
    { SEED_DEVELOPER_PASSWORD: 'short' },
  ];
  for (const overrides of bad) {
    await assert.rejects(seedAccounts(env(overrides), noDb), Error, JSON.stringify(Object.keys(overrides)));
  }
  assert.deepEqual(users, []);
});

test('the same email cannot be used for both roles, even with different letter case', async () => {
  const noDb = { execute: async () => assert.fail('Database must not be used') };
  await assert.rejects(seedAccounts(env({ SEED_DEVELOPER_EMAIL: 'ADMIN@lotto.test' }), noDb), /different/);
});

test('an email owned by another role is reported as a conflict and not changed', async () => {
  users = [{ Name: 'Customer', Email: 'admin@lotto.test', Password: 'customer-hash', Role: 'Customer', AccountStatus: 'Active' }];
  const results = await seedAccounts(env(), db);
  assert.deepEqual(statuses(results), ['Admin:conflict', 'Developer:created']);
  assert.deepEqual(users[0], { Name: 'Customer', Email: 'admin@lotto.test', Password: 'customer-hash', Role: 'Customer', AccountStatus: 'Active' });
});

test('an existing deactivated account is reported and not reactivated', async () => {
  users = [{ Name: 'Admin', Email: 'admin@lotto.test', Password: 'old-hash', Role: 'Admin', AccountStatus: 'Deactivated' }];
  const results = await seedAccounts(env(), db);
  assert.deepEqual(statuses(results), ['Admin:deactivated', 'Developer:created']);
  assert.equal(users[0].AccountStatus, 'Deactivated');
  assert.equal(users[0].Password, 'old-hash');
});
