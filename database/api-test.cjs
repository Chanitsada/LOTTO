// npm run test:integration from backend/. Uses local MySQL credentials, but ONLY
// a newly created lotto_test_* database. Never imports SQL into the project DB.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const mysql = require('../backend/node_modules/mysql2/promise');
require('../backend/node_modules/dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const name = `lotto_test_${Date.now()}_${randomBytes(4).toString('hex')}`;
const settings = { host: process.env.DB_HOST ?? '127.0.0.1', port: Number(process.env.DB_PORT ?? 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, timezone: 'Z', charset: 'utf8mb4' };
let admin, pool, server, created = false, passed = 0;
const pass = text => { passed++; console.log(`PASS: ${text}`); };

async function source(file) {
  let delimiter = ';', buffer = '';
  const script = fs.readFileSync(path.join(__dirname, file), 'utf8')
    .replace(/DROP DATABASE IF EXISTS lotto\b/g, `DROP DATABASE IF EXISTS ${name}`)
    .replace(/CREATE DATABASE IF NOT EXISTS lotto\b/g, `CREATE DATABASE IF NOT EXISTS ${name}`)
    .replace(/USE lotto\s*;/g, `USE ${name};`);
  // A guard rejects any SQL that escapes temporary-database mapping.
  assert.doesNotMatch(script, /^\s*(?:DROP\s+DATABASE(?:\s+IF\s+EXISTS)?|CREATE\s+DATABASE(?:\s+IF\s+NOT\s+EXISTS)?|USE)\s+`?lotto`?\b/im,
    'Refusing to run SQL that still targets the project database');
  const connection = await pool.getConnection();
  try {
    // A stale variable on this exact session must not override the monthly seed.
    if (file === 'seed.sql') await connection.query("SET @draw_date = '2098-12-31'");
    for (const line of script.split('\n')) {
      const directive = line.match(/^DELIMITER\s+(\S+)\s*$/);
      if (directive) { delimiter = directive[1]; continue; }
      buffer += `${line}\n`;
      if (buffer.trimEnd().endsWith(delimiter)) {
        const statement = buffer.trimEnd().slice(0, -delimiter.length).trim();
        buffer = '';
        if (statement) await connection.query(statement);
      }
    }
    assert.ok(!buffer.replace(/--[^\n]*/g, '').trim(), `Incomplete SQL in ${file}`);
  } finally { connection.release(); }
}

// Specific-date fixtures test the shared initializer; seed.sql always uses today.
async function initializeFixture(date) {
  const connection = await pool.getConnection();
  try {
    await connection.execute(`INSERT INTO LotteryDraw (DrawDate, SalesCloseAt, DrawAt)
      SELECT ?, TIMESTAMP(?, '10:00:00'), TIMESTAMP(?, '11:00:00')
      WHERE NOT EXISTS (SELECT 1 FROM LotteryDraw WHERE DrawDate = ?)`, [date, date, date, date]);
    const [[draw]] = await connection.execute('SELECT DrawID FROM LotteryDraw WHERE DrawDate = ?', [date]);
    await connection.execute('CALL sp_initialize_draw(?)', [draw.DrawID]);
  } finally { connection.release(); }
}

function browser(base) {
  let cookie = '', token;
  return {
    async request(route, method = 'GET', body, headers = {}) {
      if (method !== 'GET' && !token) token = (await this.request('/api/auth/csrf')).body.data.csrfToken;
      const response = await fetch(`${base}${route}`, { method, headers: {
        Cookie: cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(token ? { 'X-CSRF-Token': token } : {}), ...headers,
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.headers.get('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
      const result = { status: response.status, body: await response.json() };
      if (route === '/api/auth/login' && result.status === 200) token = undefined;
      return result;
    },
    async login(email) {
      const result = await this.request('/api/auth/login', 'POST', { email, password: 'Integration123' });
      assert.equal(result.status, 200, JSON.stringify(result.body));
    },
  };
}

async function check() {
  admin = await mysql.createConnection(settings);
  assert.match((await admin.query('SELECT VERSION() AS version'))[0][0].version, /^8\./);
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  created = true;
  pool = mysql.createPool({ ...settings, database: name, connectionLimit: 8 });
  for (const file of ['schema.sql', 'procedures.sql', 'triggers.sql']) await source(file);
  const hash = await require('../backend/utils/password').hashPassword('Integration123');
  const users = {};
  for (const [key, role] of [['a', 'Customer'], ['b', 'Customer'], ['admin', 'Admin'], ['dev', 'Developer']]) {
    const [row] = await pool.execute('INSERT INTO `User` (Name, Phone, Email, Password, Role) VALUES (?, ?, ?, ?, ?)',
      [key, '0812345678', `${key}@integration.test`, hash, role]);
    users[key] = row.insertId;
  }
  const dbPath = require.resolve('../backend/db');
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
  // Fix only the test RNG output so per-copy winnings are reproducible.
  // Production crypto.randomInt sampling is exercised separately by the unit tests.
  require('../backend/utils/draw').generateWinners = () => [
    '900000', '900001', '900002', '000000', ...Array.from({ length: 9 }, (_, i) => String(900003 + i)),
  ];
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = randomBytes(32).toString('hex');
  server = require('../backend/app').listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const a = browser(base), b = browser(base), owner = browser(base), dev = browser(base), guest = browser(base);
  for (const [client, email] of [[a, 'a'], [b, 'b'], [owner, 'admin'], [dev, 'dev']]) await client.login(`${email}@integration.test`);
  assert.equal((await guest.request('/api/checkout', 'POST', {})).status, 401);
  assert.equal((await a.request('/api/admin/dashboard')).status, 403);
  assert.equal((await dev.request('/api/me/tickets')).status, 403);
  const profile = await a.request('/api/me/profile');
  assert.deepEqual(profile.body.data, { userId: users.a, name: 'a', phone: '0812345678', email: 'a@integration.test' });
  const edited = await a.request('/api/me/profile', 'PATCH', { name: "  Customer O'Connor ก  ", phone: ' 0899999999 ' });
  assert.equal(edited.status, 200);
  assert.deepEqual(edited.body.data, { ...profile.body.data, name: "Customer O'Connor ก", phone: '0899999999' });
  assert.deepEqual((await a.request('/api/me/profile')).body.data, edited.body.data);
  assert.equal((await b.request('/api/me/profile')).body.data.name, 'b');
  assert.equal((await a.request('/api/me/profile', 'PATCH', { userId: users.b, name: 'Forbidden' })).status, 400);
  assert.equal((await a.request('/api/me/profile', 'PATCH', { name: 'Forbidden' }, { 'X-CSRF-Token': '' })).status, 403);
  const customers = await owner.request('/api/admin/customers?page=2&pageSize=1');
  assert.deepEqual(customers.body.meta, { page: 2, pageSize: 1, totalItems: 2 });
  assert.equal(customers.body.data.items[0].userId, users.b);
  assert.doesNotMatch(JSON.stringify(customers.body), /password|\$2[ab]\$/i);
  assert.equal((await dev.request('/api/admin/customers')).status, 403);
  pass('Profile reads/edits use the session owner, preserve other accounts and enforce CSRF; Admin customer pagination works');

  // Run the real command-line script against ONLY the isolated database.
  const seedEnv = { ...process.env, DB_NAME: name,
    SEED_ADMIN_EMAIL: 'seed-admin@integration.test', SEED_ADMIN_PASSWORD: 'Integration123',
    SEED_DEVELOPER_EMAIL: 'seed-developer@integration.test', SEED_DEVELOPER_PASSWORD: 'Integration123' };
  const seedScript = path.resolve(__dirname, '../backend/scripts/seed-accounts.js');
  const seedRun = env => spawnSync(process.execPath, [seedScript], { env, encoding: 'utf8', timeout: 15000 });
  const firstSeed = seedRun(seedEnv);
  assert.equal(firstSeed.status, 0, firstSeed.stderr);
  assert.match(firstSeed.stdout, /Admin seed-admin@integration.test: created/);
  assert.match(firstSeed.stdout, /Developer seed-developer@integration.test: created/);
  const seedQuery = "SELECT Name, Email, Password, Role, AccountStatus FROM `User` WHERE Email IN (?, ?) ORDER BY Role";
  const seedEmails = [seedEnv.SEED_ADMIN_EMAIL, seedEnv.SEED_DEVELOPER_EMAIL];
  const [seeded] = await pool.execute(seedQuery, seedEmails);
  assert.deepEqual(seeded.map(u => [u.Role, u.AccountStatus]), [['Admin', 'Active'], ['Developer', 'Active']]);
  for (const user of seeded) assert.equal(await require('../backend/utils/password').comparePassword('Integration123', user.Password), true);
  const secondSeed = seedRun({ ...seedEnv, SEED_ADMIN_PASSWORD: 'DifferentPassword123' });
  assert.equal(secondSeed.status, 0, secondSeed.stderr);
  assert.match(secondSeed.stdout, /skipped/);
  assert.deepEqual((await pool.execute(seedQuery, seedEmails))[0], seeded);
  assert.doesNotMatch(firstSeed.stdout + firstSeed.stderr + secondSeed.stdout + secondSeed.stderr, /Integration123|DifferentPassword123|\$2[ab]\$/);
  const seededAdmin = browser(base), seededDeveloper = browser(base);
  await seededAdmin.login(seedEnv.SEED_ADMIN_EMAIL);
  await seededDeveloper.login(seedEnv.SEED_DEVELOPER_EMAIL);
  assert.equal((await seededAdmin.request('/api/admin/dashboard')).status, 200);
  assert.equal((await seededDeveloper.request('/api/admin/dashboard')).status, 403);
  pass('Real account-seeding command creates bcrypt accounts, closes the pool, preserves safe reruns and supports role-checked login');
  const [[clock]] = await pool.query(`SELECT DATE_FORMAT(LAST_DAY(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR))), '%Y-%m-%d') AS date,
    UTC_TIMESTAMP() < TIMESTAMP(LAST_DAY(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR))), '10:00:00') AS beforeCutoff`);
  assert.ok(clock.beforeCutoff, 'Run purchase integration checks before the current month-end 17:00 Thailand cutoff.');
  assert.equal((await owner.request('/api/admin/draws', 'POST', { drawDate: clock.date })).status, 404);
  // Direct fixture setup isolates tests; normal app creation uses the monthly check.
  const [createdDraw] = await pool.execute(`INSERT INTO LotteryDraw (DrawDate, SalesCloseAt, DrawAt)
    VALUES (?, TIMESTAMP(?, '10:00:00'), TIMESTAMP(?, '11:00:00'))`, [clock.date, clock.date, clock.date]);
  const drawId = createdDraw.insertId;
  for (const [client, status] of [[guest, 401], [a, 403], [owner, 403]]) {
    assert.equal((await client.request('/api/developer/inventory')).status, status);
  }
  const pendingInventory = await dev.request('/api/developer/inventory');
  assert.equal(pendingInventory.status, 200);
  assert.equal(pendingInventory.body.data.summary.missingNumbers, 1000000);
  assert.equal(pendingInventory.body.data.summary.consistent, false);
  assert.equal((await owner.request(`/api/admin/draws/${drawId}/open`, 'POST', {})).status, 404);
  assert.equal((await guest.request('/api/draws/current')).body.data.purchasable, false);
  console.log('Initializing the full one-million-number test draw...');
  const initialized = await owner.request(`/api/admin/draws/${drawId}/initialize`, 'POST', {});
  assert.equal(initialized.status, 200, JSON.stringify(initialized.body));
  assert.equal(initialized.body.data.numbers, 1000000);
  assert.equal(initialized.body.data.copiesAvailable, '5000000');
  assert.equal(initialized.body.data.drawStatus, 'Open');
  const current = await guest.request('/api/draws/current');
  assert.equal(current.body.data.drawId, drawId);
  assert.equal(current.body.data.purchasable, true);
  const search = await guest.request(`/api/draws/${drawId}/numbers?ticketNumber=000000`);
  assert.equal(search.body.data.items[0].ticketNumber, '000000');
  assert.equal(search.body.data.items[0].availableQuantity, 5);
  const first = search.body.data.items[0].lotteryNumberId;
  const second = (await guest.request(`/api/draws/${drawId}/numbers?ticketNumber=999999`)).body.data.items[0].lotteryNumberId;
  assert.equal((await guest.request(`/api/draws/${drawId}/numbers?pageSize=101`)).status, 400);
  assert.equal((await guest.request(`/api/draws/${drawId}/check?ticketNumber=000000`)).body.data.status, 'pending');
  assert.equal((await owner.request(`/api/admin/draws/${drawId}/generate`, 'POST', {})).status, 409);
  pass('Full initialization, opening, current draw, pagination, six-digit search and publication timing');
  const initialInventory = await dev.request('/api/developer/inventory');
  assert.equal(initialInventory.status, 200, JSON.stringify(initialInventory.body));
  assert.equal(initialInventory.body.data.summary.numberCount, 1000000);
  assert.equal(initialInventory.body.data.summary.availableCopies, 5000000);
  assert.equal(initialInventory.body.data.summary.purchasedCopies, 0);
  assert.equal(initialInventory.body.data.summary.consistent, true);
  assert.equal(initialInventory.body.data.items[0].ticketNumber, '000000');
  assert.equal(initialInventory.body.data.items.length, 20);
  assert.equal((await dev.request('/api/developer/inventory?page=2')).body.data.items[0].ticketNumber, '000020');
  for (const method of ['POST', 'PATCH', 'DELETE']) assert.equal((await dev.request('/api/developer/inventory', method, {})).status, 404);
  pass('Developer-only read report detects pending inventory, checks a full million-row draw and paginates without mutation routes');

  assert.equal((await a.request('/api/me/cart', 'POST', { lotteryNumberId: first, quantity: 2 }, { 'X-CSRF-Token': '' })).status, 403);
  const saved = await a.request('/api/me/cart', 'POST', { lotteryNumberId: first, quantity: 2 });
  assert.equal(saved.status, 201);
  const cartItemId = saved.body.data.cartItemId;
  assert.equal((await a.request('/api/me/cart')).body.data.items[0].drawDate, clock.date);
  assert.equal((await a.request(`/api/me/cart/${cartItemId}`, 'PATCH', { quantity: 3 })).status, 200);
  assert.equal((await a.request('/api/checkout', 'POST', { drawId, items: [{ lotteryNumberId: first, quantity: 2 }] })).body.error.code, 'CART_CHANGED');
  assert.equal((await a.request(`/api/me/cart/${cartItemId}`, 'PATCH', { quantity: 2 })).status, 200);
  assert.equal((await b.request(`/api/me/cart/${cartItemId}`, 'DELETE')).status, 404);
  assert.equal((await a.request('/api/me/cart', 'POST', { lotteryNumberId: first, quantity: 1 })).status, 409);
  assert.equal((await a.request(`/api/me/cart/${cartItemId}`, 'PATCH', { quantity: 6 })).status, 400);
  assert.equal((await guest.request(`/api/draws/${drawId}/numbers?ticketNumber=000000`)).body.data.items[0].availableQuantity, 5);
  const temporarySelection = await a.request('/api/me/cart', 'POST', { lotteryNumberId: second, quantity: 1 });
  assert.equal(temporarySelection.status, 201);
  assert.equal((await a.request(`/api/me/cart/${temporarySelection.body.data.cartItemId}`, 'DELETE')).status, 200);
  assert.equal((await guest.request(`/api/draws/${drawId}/numbers?ticketNumber=999999`)).body.data.items[0].availableQuantity, 5);
  assert.deepEqual((await pool.query('SELECT (SELECT COUNT(*) FROM Payment) AS payments, (SELECT COUNT(*) FROM LotteryTicket) AS tickets'))[0][0], { payments: 0, tickets: 0 });
  const payload = { drawId, items: [{ lotteryNumberId: first, quantity: 2 }, { lotteryNumberId: second, quantity: 1 }] };
  assert.equal((await a.request('/api/checkout', 'POST', { ...payload, userId: users.b })).status, 400);
  const paid = await a.request('/api/checkout', 'POST', payload);
  assert.equal(paid.status, 201, JSON.stringify(paid.body));
  assert.equal(paid.body.data.amount, '300.00');
  assert.equal(paid.body.data.tickets.length, 3);
  assert.equal((await a.request('/api/me/cart')).body.data.items.length, 0);
  assert.equal((await b.request(`/api/me/payments/${paid.body.data.paymentId}`)).status, 404);
  assert.equal((await b.request(`/api/me/tickets/${paid.body.data.tickets[0].ticketId}/result`)).status, 404);
  assert.equal((await a.request(`/api/me/tickets/${paid.body.data.tickets[0].ticketId}/result`)).body.data.status, 'pending');
  assert.equal((await a.request('/api/me/tickets')).body.data.items.length, 3);
  assert.equal((await a.request('/api/me/payments')).body.data.items.length, 1);
  const ownedReceipt = await a.request(`/api/me/payments/${paid.body.data.paymentId}`);
  assert.equal(ownedReceipt.body.data.drawDate, clock.date);
  assert.ok(ownedReceipt.body.data.tickets.every(t => t.drawDate === clock.date));
  assert.equal((await guest.request(`/api/draws/${drawId}/numbers?ticketNumber=000000`)).body.data.items[0].availableQuantity, 3);
  assert.equal((await guest.request(`/api/draws/${drawId}/numbers?ticketNumber=999999`)).body.data.items[0].availableQuantity, 4);
  assert.equal((await owner.request(`/api/admin/dashboard?drawId=${drawId}`)).body.data.totalSales, '300.00');
  pass('Owned cart CRUD, no stock reservation, trusted totals, one payment, per-copy tickets and private history');

  const boughtInventory = await dev.request('/api/developer/inventory?ticketNumber=000000');
  assert.deepEqual(boughtInventory.body.data.items, [{ lotteryNumberId: first, ticketNumber: '000000',
    availableQuantity: 3, purchasedCopies: 2, consistent: true }]);
  assert.equal(boughtInventory.body.data.summary.purchasedCopies, 3);
  assert.equal(boughtInventory.body.data.summary.availableCopies, 4999997);
  assert.equal(boughtInventory.body.meta.totalItems, 1);
  assert.deepEqual((await dev.request('/api/developer/inventory?ticketNumber=000000&page=2&pageSize=1')).body.data.items, []);
  // Controlled inconsistencies in unused fixture inventory exercise report detection.
  const [[unused]] = await pool.execute("SELECT * FROM LotteryNumber WHERE DrawID = ? AND TicketNumber = '888888'", [drawId]);
  try {
    await pool.execute('UPDATE LotteryNumber SET AvailableQuantity = 4 WHERE LotteryNumberID = ?', [first]);
    await pool.execute('DELETE FROM LotteryNumber WHERE LotteryNumberID = ?', [unused.LotteryNumberID]);
    const audit = await dev.request('/api/developer/inventory?inconsistentOnly=true');
    assert.equal(audit.status, 200, JSON.stringify(audit.body));
    assert.equal(audit.body.data.summary.missingNumbers, 1);
    assert.equal(audit.body.data.summary.inconsistentNumbers, 1);
    assert.equal(audit.body.data.summary.consistent, false);
    assert.deepEqual(audit.body.data.items, [{ lotteryNumberId: first, ticketNumber: '000000',
      availableQuantity: 4, purchasedCopies: 2, consistent: false }]);
    assert.equal(audit.body.meta.totalItems, 1);
    assert.doesNotMatch(JSON.stringify(audit.body), /email|password|userId|paymentId/i);
    assert.equal((await pool.execute('SELECT AvailableQuantity FROM LotteryNumber WHERE LotteryNumberID = ?', [first]))[0][0].AvailableQuantity, 4);
  } finally {
    await pool.execute('UPDATE LotteryNumber SET AvailableQuantity = 3 WHERE LotteryNumberID = ?', [first]);
    await pool.execute('INSERT INTO LotteryNumber (LotteryNumberID, DrawID, TicketNumber, AvailableQuantity) VALUES (?, ?, ?, ?)',
      [unused.LotteryNumberID, unused.DrawID, unused.TicketNumber, unused.AvailableQuantity]);
  }
  assert.equal((await dev.request('/api/developer/inventory')).body.data.summary.consistent, true);
  pass('Inventory report counts purchased copies, preserves leading zeros and detects missing numbers and mismatches without repairing data');

  const blocker = await pool.getConnection();
  let waitingCart;
  try {
    await blocker.beginTransaction();
    await blocker.execute('SELECT DrawID FROM LotteryDraw WHERE DrawID = ? FOR UPDATE', [drawId]);
    waitingCart = a.request('/api/me/cart', 'POST', { lotteryNumberId: second, quantity: 1 });
    let waiting = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM information_schema.PROCESSLIST
        WHERE DB = ? AND ID <> CONNECTION_ID() AND INFO LIKE 'SELECT DrawID FROM LotteryDraw WHERE DrawID = % FOR UPDATE'`, [name]);
      if (count.total > 0) { waiting = true; break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(waiting, 'Cart request must reach the held draw lock');
    await blocker.execute("UPDATE LotteryDraw SET DrawStatus = 'Closed' WHERE DrawID = ?", [drawId]);
    await blocker.commit();
    assert.equal((await waitingCart).status, 409);
  } finally {
    await blocker.rollback();
    blocker.release();
    if (waitingCart) await waitingCart;
  }
  assert.equal((await owner.request(`/api/admin/draws/${drawId}/generate`, 'POST', {})).status, 409);
  await initializeFixture(clock.date);
  assert.equal((await guest.request('/api/draws/current')).body.data.purchasable, false);
  // Resetting this isolated fixture permits additional purchase cases.
  // The application has no manual-reopen route.
  await pool.execute("UPDATE LotteryDraw SET DrawStatus = 'Open' WHERE DrawID = ?", [drawId]);
  pass('A waiting cart sees closure; early closure does not allow early publication');

  const raceId = (await guest.request(`/api/draws/${drawId}/numbers?ticketNumber=123456`)).body.data.items[0].lotteryNumberId;
  const racingPayload = { drawId, items: [{ lotteryNumberId: raceId, quantity: 4 }] };
  const racing = await Promise.all([a.request('/api/checkout', 'POST', racingPayload),
    b.request('/api/checkout', 'POST', racingPayload)]);
  assert.deepEqual(racing.map(value => value.status).sort(), [201, 409]);
  const retryId = (await guest.request(`/api/draws/${drawId}/numbers?ticketNumber=222222`)).body.data.items[0].lotteryNumberId;
  const retryPayload = { drawId, items: [{ lotteryNumberId: retryId, quantity: 1 }] };
  const repeated = await Promise.all([
    a.request('/api/checkout', 'POST', retryPayload),
    a.request('/api/checkout', 'POST', retryPayload),
  ]);
  assert.ok(repeated.every(result => result.status === 201));
  assert.notEqual(repeated[0].body.data.paymentId, repeated[1].body.data.paymentId);

  await b.request('/api/me/cart', 'POST', { lotteryNumberId: first, quantity: 2 });
  await pool.query(`CREATE TRIGGER test_rollback BEFORE INSERT ON LotteryTicket FOR EACH ROW
    BEGIN IF NEW.LotteryNumberID = ${second} THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TEST_ROLLBACK'; END IF; END`);
  const [[before]] = await pool.query('SELECT (SELECT COUNT(*) FROM Payment) AS payments, (SELECT COUNT(*) FROM LotteryTicket) AS tickets');
  assert.equal((await b.request('/api/checkout', 'POST', payload)).status, 500);
  const [[after]] = await pool.query('SELECT (SELECT COUNT(*) FROM Payment) AS payments, (SELECT COUNT(*) FROM LotteryTicket) AS tickets');
  assert.deepEqual(after, before);
  assert.equal((await guest.request(`/api/draws/${drawId}/numbers?ticketNumber=000000`)).body.data.items[0].availableQuantity, 3);
  assert.equal((await b.request('/api/me/cart')).body.data.items.length, 1);
  await pool.execute('DELETE FROM CartItem WHERE UserID = ?', [users.b]);
  await pool.query('DROP TRIGGER test_rollback');
  pass('Concurrent stock, independent repeated purchases, SQL rollback and safe unexpected errors');

  const [cartNumbers] = await pool.execute(`SELECT LotteryNumberID AS lotteryNumberId FROM LotteryNumber
    WHERE DrawID = ? AND TicketNumber BETWEEN '000100' AND '000120' ORDER BY TicketNumber`, [drawId]);
  for (const item of cartNumbers.slice(0, 19)) await pool.execute(
    'INSERT INTO CartItem (UserID, LotteryNumberID, Quantity) VALUES (?, ?, 5)', [users.a, item.lotteryNumberId]);
  const cartRace = await Promise.all(cartNumbers.slice(19).map(item => a.request('/api/me/cart', 'POST', { ...item, quantity: 5 })));
  assert.deepEqual(cartRace.map(value => value.status).sort(), [201, 409]);
  const hundred = (await a.request('/api/me/cart')).body.data;
  assert.equal(hundred.totalCopies, 100);
  assert.equal((await a.request('/api/checkout', 'POST', { drawId, items: hundred.items.map(item => ({
    lotteryNumberId: item.lotteryNumberId, quantity: item.quantity,
  })) })).body.data.amount, '10000.00');
  assert.equal((await a.request('/api/me/cart')).body.data.items.length, 0);
  await initializeFixture(clock.date);
  assert.equal((await guest.request(`/api/draws/${drawId}/numbers?ticketNumber=000100`)).body.data.items[0].availableQuantity, 0);
  pass('Concurrent cart changes respect 100 copies, full-size checkout succeeds and seed reruns preserve sold stock');

  const savedAgain = await a.request('/api/me/cart', 'POST', { lotteryNumberId: second, quantity: 1 });
  assert.equal(savedAgain.status, 201);
  const closeRace = await Promise.all([
    b.request('/api/checkout', 'POST', retryPayload),
    owner.request(`/api/admin/draws/${drawId}/close`, 'POST', {}),
  ]);
  assert.ok([201, 409].includes(closeRace[0].status));
  assert.equal(closeRace[1].status, 200);
  assert.equal((await a.request('/api/me/cart')).body.data.items.length, 1);
  assert.equal((await a.request('/api/checkout', 'POST', payload)).status, 409);
  assert.equal((await a.request(`/api/me/cart/${savedAgain.body.data.cartItemId}`, 'DELETE')).status, 200);
  const [future] = await pool.query(`INSERT INTO LotteryDraw (DrawDate, SalesCloseAt, DrawAt, DrawStatus, InitializationStatus)
    VALUES ('2099-12-31', '2099-12-31 10:00:00', '2099-12-31 11:00:00', 'Open', 'Ready')`);
  const [futureNumber] = await pool.execute('INSERT INTO LotteryNumber (DrawID, TicketNumber) VALUES (?, ?)', [future.insertId, '000000']);
  assert.equal((await a.request('/api/checkout', 'POST', { drawId: future.insertId, items: [{ lotteryNumberId: futureNumber.insertId, quantity: 1 }] })).body.error.code, 'DRAW_NOT_CURRENT');
  assert.equal((await a.request('/api/me/cart', 'POST', { lotteryNumberId: futureNumber.insertId, quantity: 1 })).status, 409);
  pass('Closure rejects every new checkout, keeps saved selections, allows stale deletion and rejects future draws');

  // Historical dates on this isolated fixture exercise publication without changing the server clock.
  const [[previous]] = await pool.query("SELECT DATE_FORMAT(LAST_DAY(DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MONTH)), '%Y-%m-%d') AS date");
  await pool.execute(`UPDATE LotteryDraw SET DrawDate = ?, SalesCloseAt = TIMESTAMP(?, '10:00:00'),
    DrawAt = TIMESTAMP(?, '11:00:00'), DrawStatus = 'Open' WHERE DrawID = ?`, [previous.date, previous.date, previous.date, drawId]);
  assert.equal((await a.request('/api/checkout', 'POST', retryPayload)).body.error.code, 'DRAW_CLOSED');
  await assert.rejects(() => pool.execute('INSERT INTO LotteryTicket (UserID, LotteryNumberID, PaymentID) VALUES (?, ?, ?)',
    [users.a, first, paid.body.data.paymentId]), error => error.sqlMessage === 'DRAW_CLOSED');
  await assert.rejects(() => pool.execute('DELETE FROM LotteryTicket WHERE TicketID = ?', [paid.body.data.tickets[0].ticketId]),
    error => error.sqlMessage === 'PURCHASED_TICKET_DELETE_BLOCKED');
  await require('../backend/utils/close-sales').closeExpiredSales();
  assert.equal((await pool.execute('SELECT DrawStatus FROM LotteryDraw WHERE DrawID = ?', [drawId]))[0][0].DrawStatus, 'Closed');
  const generated = await owner.request(`/api/admin/draws/${drawId}/generate`, 'POST', {});
  assert.equal(generated.status, 201, JSON.stringify(generated.body));
  assert.equal(new Set(generated.body.data.items.map(p => p.winningNumber)).size, 13);
  assert.equal((await owner.request(`/api/admin/draws/${drawId}/generate`, 'POST', {})).status, 409);
  const originalResults = (await guest.request(`/api/draws/${drawId}/results`)).body.data;
  assert.equal((await a.request(`/api/me/payments/${paid.body.data.paymentId}`)).body.data.drawDate, previous.date);
  assert.equal((await owner.request(`/api/admin/draws/${drawId}/corrections`, 'POST', { reason: 'Not supported', changes: [] })).status, 404);
  assert.equal((await owner.request(`/api/admin/draws/${drawId}/result-history`)).status, 404);
  assert.deepEqual((await guest.request(`/api/draws/${drawId}/results`)).body.data, originalResults);
  const ticketResults = await Promise.all(paid.body.data.tickets.slice(0, 2).map(ticket => a.request(`/api/me/tickets/${ticket.ticketId}/result`)));
  assert.ok(ticketResults.every(result => result.body.data.prizeAmount === '2000.00'));
  assert.equal((await a.request('/api/me/winnings')).body.data.totalWinnings, '4000.00');
  assert.equal((await owner.request('/api/admin/payments')).status, 200);
  assert.equal((await owner.request('/api/admin/tickets')).status, 200);
  assert.equal((await owner.request(`/api/admin/draws/${drawId}/winners`)).body.data.items.length, 2);
  await initializeFixture(previous.date);
  assert.equal((await guest.request(`/api/draws/${drawId}/results`)).body.data.items[3].winningNumber, '000000');
  pass('Catch-up closure, scheduled publication, no editing/rerolls and per-copy winnings');
  const [paymentsBeforeDeactivation] = await pool.query('SELECT * FROM Payment ORDER BY PaymentID');
  const [ticketsBeforeDeactivation] = await pool.query('SELECT * FROM LotteryTicket ORDER BY TicketID');
  assert.equal((await owner.request(`/api/admin/customers/${users.admin}/deactivate`, 'POST', {})).status, 404);
  const disabled = await owner.request(`/api/admin/customers/${users.a}/deactivate`, 'POST', {});
  assert.deepEqual(disabled, { status: 200, body: { data: { userId: users.a, accountStatus: 'Deactivated' } } });
  assert.deepEqual(await owner.request(`/api/admin/customers/${users.a}/deactivate`, 'POST', {}), disabled);
  const blocked = await a.request('/api/me/profile');
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, 'ACCOUNT_DISABLED');
  assert.equal((await a.request('/api/auth/me')).status, 401);
  assert.equal((await b.request('/api/me/profile')).status, 200);
  assert.deepEqual((await pool.query('SELECT * FROM Payment ORDER BY PaymentID'))[0], paymentsBeforeDeactivation);
  assert.deepEqual((await pool.query('SELECT * FROM LotteryTicket ORDER BY TicketID'))[0], ticketsBeforeDeactivation);
  pass('Admin deactivation is repeatable, blocks an existing Customer session and preserves every ticket and payment');
  await source('schema.sql');
  const [[reset]] = await pool.query(`SELECT (SELECT COUNT(*) FROM \`User\`) AS users,
    (SELECT COUNT(*) FROM LotteryNumber) AS numbers, (SELECT COUNT(*) FROM Payment) AS payments`);
  assert.deepEqual(reset, { users: 0, numbers: 0, payments: 0 });
  const [[tables]] = await pool.execute('SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ?', [name]);
  assert.equal(tables.total, 7);
  pass('Schema reset recreates exactly seven business tables with no supporting tables');

  // The same default seed covers the current SQL month and one year of past
  // results, without creating any future draw. Never seed the project database.
  await source('procedures.sql');
  await source('triggers.sql');
  console.log('Checking the default current/history seed...');
  await source('seed.sql');
  const currentSeed = await guest.request('/api/draws/current');
  assert.equal(currentSeed.status, 200);
  assert.equal(currentSeed.body.data.drawDate, clock.date);
  assert.equal(currentSeed.body.data.purchasable, true);
  assert.ok(Number.isFinite(Date.parse(currentSeed.body.data.drawAt)));
  assert.ok(Number.isFinite(Date.parse(currentSeed.body.data.serverNow)));
  const [[seededMonths]] = await pool.execute(`SELECT COUNT(*) AS total,
    SUM(DrawDate > ?) AS future FROM LotteryDraw`, [clock.date]);
  assert.deepEqual(seededMonths, { total: 13, future: '0' });
  const [freshDrawIds] = await pool.query('SELECT DrawID FROM LotteryDraw ORDER BY DrawDate');
  assert.deepEqual(freshDrawIds.map(d => d.DrawID), Array.from({ length: 13 }, (_, i) => i + 1));
  const [[currentStock]] = await pool.execute(`SELECT COUNT(*) AS numbers,
    SUM(AvailableQuantity) AS copies, MIN(AvailableQuantity) AS minimumCopies,
    MAX(AvailableQuantity) AS maximumCopies FROM LotteryNumber WHERE DrawID = ?`, [currentSeed.body.data.drawId]);
  assert.deepEqual(currentStock, { numbers: 1000000, copies: '5000000', minimumCopies: 5, maximumCopies: 5 });
  const visible = await guest.request('/api/draws?page=1&pageSize=100');
  assert.equal(visible.body.data.items.length, 13);
  const past = visible.body.data.items.filter(d => d.drawDate < clock.date);
  assert.equal(past.length, 12);
  for (const draw of past) {
    assert.equal(draw.drawStatus, 'Closed');
    assert.equal(draw.purchasable, false);
    const result = await guest.request(`/api/draws/${draw.drawId}/results`);
    assert.equal(result.status, 200);
    assert.equal(result.body.data.status, 'published');
    assert.equal(new Set(result.body.data.items.map(p => p.winningNumber)).size, 13);
    assert.ok(result.body.data.items.every(p => /^\d{6}$/.test(p.winningNumber)));
    assert.equal((await guest.request(`/api/draws/${draw.drawId}/numbers`)).status, 404);
  }
  const [demoCounts] = await pool.query(`SELECT d.DrawID, COUNT(n.LotteryNumberID) AS numbers
    FROM LotteryDraw d LEFT JOIN LotteryNumber n ON n.DrawID = d.DrawID
    WHERE d.DrawDate < ? GROUP BY d.DrawID`, [clock.date]);
  assert.ok(demoCounts.every(d => d.numbers === 0), 'Past demo draws must not allocate million-row stock');
  const [[beforeRerun]] = await pool.query('SELECT COUNT(*) AS numbers, SUM(AvailableQuantity) AS copies FROM LotteryNumber');
  const [resultsBeforeRerun] = await pool.query('SELECT * FROM Prize ORDER BY PrizeID');
  await source('seed.sql');
  assert.equal((await guest.request('/api/draws/current')).body.data.purchasable, true);
  assert.deepEqual((await pool.query('SELECT COUNT(*) AS numbers, SUM(AvailableQuantity) AS copies FROM LotteryNumber'))[0][0], beforeRerun);
  assert.deepEqual((await pool.query('SELECT * FROM Prize ORDER BY PrizeID'))[0], resultsBeforeRerun);
  await pool.execute('CALL sp_close_draw(?)', [currentSeed.body.data.drawId]);
  await source('seed.sql');
  assert.equal((await guest.request('/api/draws/current')).body.data.purchasable, false);
  assert.equal((await pool.execute('SELECT DrawStatus FROM LotteryDraw WHERE DrawID = ?', [currentSeed.body.data.drawId]))[0][0].DrawStatus, 'Closed');
  assert.deepEqual((await pool.query('SELECT * FROM Prize ORDER BY PrizeID'))[0], resultsBeforeRerun);
  pass('First successful seed opens current sales; reruns preserve open sales and emergency closures');

  // Exercise the first-setup cutoff on this session only, without changing the
  // server clock or allocating another million-row fixture.
  const cutoffConnection = await pool.getConnection();
  try {
    await cutoffConnection.query('SET timestamp = UNIX_TIMESTAMP(?)', [`${clock.date} 10:00:00`]);
    const [[atCutoff]] = await cutoffConnection.query('SELECT UTC_TIMESTAMP() = TIMESTAMP(?, \'10:00:00\') AS exactCutoff', [clock.date]);
    assert.ok(atCutoff.exactCutoff);
    await cutoffConnection.execute("UPDATE LotteryDraw SET InitializationStatus = 'Pending', SalesStarted = FALSE WHERE DrawID = ?", [currentSeed.body.data.drawId]);
    await cutoffConnection.execute('CALL sp_initialize_draw(?)', [currentSeed.body.data.drawId]);
    await cutoffConnection.execute('CALL sp_initialize_draw(?)', [currentSeed.body.data.drawId]);
    const [[closed]] = await cutoffConnection.execute('SELECT DrawStatus, InitializationStatus FROM LotteryDraw WHERE DrawID = ?', [currentSeed.body.data.drawId]);
    assert.deepEqual(closed, { DrawStatus: 'Closed', InitializationStatus: 'Ready' });
  } finally {
    await cutoffConnection.query('SET timestamp = 0');
    cutoffConnection.release();
  }
  assert.equal((await guest.request('/api/draws/current')).body.data.purchasable, false);
  pass('First setup and repeated initialization at the 17:00 cutoff stay closed');
  pass('Automatic monthly seed creates one current million-number draw, no future dates, 12 past result sets and preserves safe reruns');

  // Legacy future rows stay stored but cannot appear in public or Admin views.
  const [hiddenFuture] = await pool.query(`INSERT INTO LotteryDraw (DrawDate, SalesCloseAt, DrawAt)
    VALUES ('2099-12-31', '2099-12-31 10:00:00', '2099-12-31 11:00:00')`);
  const futureId = hiddenFuture.insertId;
  assert.ok(visible.body.data.items.every(d => d.drawDate <= clock.date));
  assert.equal((await guest.request('/api/draws?month=2099-12')).body.meta.totalItems, 0);
  for (const suffix of ['', '/numbers', '/prizes', '/results', '/check?ticketNumber=000000']) {
    assert.equal((await guest.request(`/api/draws/${futureId}${suffix}`)).status, 404);
  }
  const [old] = await pool.execute(`INSERT INTO LotteryDraw (DrawDate, SalesCloseAt, DrawAt, DrawStatus, ResultsPublishedAt)
    VALUES ('2000-01-31', '2000-01-31 10:00:00', '2000-01-31 11:00:00', 'Closed', '2000-01-31 11:00:00')`);
  assert.equal((await guest.request(`/api/draws/${old.insertId}/results`)).status, 404);
  await pool.execute("INSERT INTO `User` (Name, Email, Password, Role) VALUES ('Seed Admin', 'visibility@integration.test', ?, 'Admin')", [hash]);
  const visibilityAdmin = browser(base);
  await visibilityAdmin.login('visibility@integration.test');
  const adminList = await visibilityAdmin.request('/api/admin/draws?pageSize=100');
  assert.ok(adminList.body.data.items.every(d => d.drawDate <= clock.date));
  assert.equal((await visibilityAdmin.request('/api/admin/draws?month=2099-12')).body.meta.totalItems, 0);
  assert.equal((await visibilityAdmin.request(`/api/admin/draws/${futureId}`)).status, 404);
  assert.equal((await guest.request(`/api/admin/draws/${futureId}`)).status, 401);
  const numbers = adminList.body.data.items.map(d => d.drawNumber);
  assert.deepEqual(numbers, Array.from({ length: numbers.length }, (_, i) => numbers.length - i));
  pass('Public and Admin views exclude future draws; display numbers follow chronological order independently of DrawID');

  // Real React handlers use this disposable fixture. A test-only reset restores
  // the purchase precondition after cutoff cases; the app has no reopen API.
  await pool.execute("UPDATE LotteryDraw SET DrawStatus = 'Open' WHERE DrawID = ?", [currentSeed.body.data.drawId]);
  const [uiUser] = await pool.execute("INSERT INTO `User` (Name, Email, Password, Role) VALUES ('UI Customer', 'ui-purchase@integration.test', ?, 'Customer')", [hash]);
  const frontend = path.resolve(__dirname, '../frontend');
  const child = spawn(process.execPath, [path.join(frontend, 'node_modules/vitest/vitest.mjs'),
    'run', '--environment', 'jsdom', 'test/purchase-integration.test.jsx'], {
    cwd: frontend, env: { ...process.env, LOTTO_TEST_API_URL: base }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let uiOutput = '';
  child.stdout.on('data', chunk => { uiOutput += chunk; });
  child.stderr.on('data', chunk => { uiOutput += chunk; });
  const timeout = setTimeout(() => child.kill('SIGTERM'), 45000);
  try {
    const [code] = await once(child, 'close');
    assert.equal(code, 0, uiOutput);
  } finally { clearTimeout(timeout); }
  const [[uiPurchase]] = await pool.execute(`SELECT COUNT(*) AS tickets, SUM(p.Amount) AS amount
    FROM LotteryTicket t JOIN Payment p ON p.PaymentID = t.PaymentID WHERE t.UserID = ?`, [uiUser.insertId]);
  assert.deepEqual(uiPurchase, { tickets: 1, amount: '100.00' });
  const [[uiStock]] = await pool.execute("SELECT AvailableQuantity FROM LotteryNumber WHERE DrawID = ? AND TicketNumber = '000123'", [currentSeed.body.data.drawId]);
  assert.equal(uiStock.AvailableQuantity, 4);
  assert.equal((await pool.execute('SELECT COUNT(*) AS total FROM CartItem WHERE UserID = ?', [uiUser.insertId]))[0][0].total, 0);
  pass('Real React login, Buy ticket and Pay persist payment/ticket/stock changes and display purchase history and receipt');

  // A legacy-shaped disposable table exercises SalesStarted compatibility setup.
  // Column removal and data resets here affect only the test database.
  const [[beforeUpgrade]] = await pool.query(`SELECT (SELECT COUNT(*) FROM LotteryNumber) AS numbers,
    (SELECT COUNT(*) FROM LotteryTicket) AS tickets, (SELECT COUNT(*) FROM Payment) AS payments`);
  await pool.query('ALTER TABLE LotteryDraw DROP COLUMN SalesStarted');
  await source('procedures.sql');
  assert.deepEqual((await pool.query(`SELECT (SELECT COUNT(*) FROM LotteryNumber) AS numbers,
    (SELECT COUNT(*) FROM LotteryTicket) AS tickets, (SELECT COUNT(*) FROM Payment) AS payments`))[0][0], beforeUpgrade);
  assert.equal((await pool.execute('SELECT SalesStarted FROM LotteryDraw WHERE DrawID = ?', [currentSeed.body.data.drawId]))[0][0].SalesStarted, 1);
  assert.equal((await pool.execute('SELECT SalesStarted FROM LotteryDraw WHERE DrawID = ?', [futureId]))[0][0].SalesStarted, 0);
  // Procedure reinstallation preserves flags when SalesStarted already exists.
  await pool.execute('UPDATE LotteryDraw SET SalesStarted = FALSE WHERE DrawID = ?', [currentSeed.body.data.drawId]);
  await source('procedures.sql');
  assert.equal((await pool.execute('SELECT SalesStarted FROM LotteryDraw WHERE DrawID = ?', [currentSeed.body.data.drawId]))[0][0].SalesStarted, 0);
  await pool.execute('UPDATE LotteryDraw SET SalesStarted = TRUE WHERE DrawID = ?', [currentSeed.body.data.drawId]);
  assert.equal((await pool.execute("SELECT COUNT(*) AS total FROM information_schema.routines WHERE routine_schema = ? AND routine_type = 'PROCEDURE'", [name]))[0][0].total, 6);
  pass('procedures.sql upgrades an older database once, preserves data/flags on reruns and leaves only six application procedures');

  const monthly = require('../backend/utils/monthly-draw').prepareCurrentDraw;
  const calendar = await pool.getConnection();
  try {
    const [[dates]] = await calendar.execute(`SELECT
      DATE_FORMAT(LAST_DAY(DATE_ADD(?, INTERVAL 1 MONTH)), '%Y-%m-%d') AS nextMonth,
      DATE_FORMAT(LAST_DAY(DATE_ADD(?, INTERVAL 2 MONTH)), '%Y-%m-%d') AS laterMonth`, [clock.date, clock.date]);
    // Publication does not create the following month before its calendar boundary.
    await calendar.query('SET timestamp = UNIX_TIMESTAMP(?)', [`${clock.date} 12:00:00`]);
    await calendar.execute('UPDATE Prize SET WinningNumber = LPAD(PrizeID, 6, \'0\') WHERE DrawID = ?', [currentSeed.body.data.drawId]);
    await calendar.execute("UPDATE LotteryDraw SET DrawStatus = 'Closed', ResultsPublishedAt = TIMESTAMP(?, '11:00:00') WHERE DrawID = ?", [clock.date, currentSeed.body.data.drawId]);
    await monthly(calendar);
    assert.equal((await calendar.execute('SELECT COUNT(*) AS total FROM LotteryDraw WHERE DrawDate = ?', [dates.nextMonth]))[0][0].total, 0);
    // Month-end 17:00 UTC is the next month's 00:00 Thailand, including year rollover.
    await calendar.query('SET timestamp = UNIX_TIMESTAMP(?)', [`${clock.date} 17:00:00`]);
    // An unfinished preceding result blocks creation even after the calendar boundary.
    await calendar.execute('UPDATE LotteryDraw SET ResultsPublishedAt = NULL WHERE DrawID = ?', [currentSeed.body.data.drawId]);
    await monthly(calendar);
    assert.equal((await calendar.execute('SELECT COUNT(*) AS total FROM LotteryDraw WHERE DrawDate = ?', [dates.nextMonth]))[0][0].total, 0);
    await calendar.execute("UPDATE LotteryDraw SET ResultsPublishedAt = TIMESTAMP(?, '11:00:00') WHERE DrawID = ?", [clock.date, currentSeed.body.data.drawId]);
    const otherWorker = await pool.getConnection();
    try {
      await otherWorker.query("SET SESSION time_zone = '+00:00'");
      await otherWorker.query('SET timestamp = UNIX_TIMESTAMP(?)', [`${clock.date} 17:00:00`]);
      await Promise.all([monthly(calendar), monthly(otherWorker)]);
    } finally {
      await otherWorker.query('SET timestamp = 0');
      otherWorker.release();
    }
    const [[next]] = await calendar.execute('SELECT DrawID, DrawStatus, InitializationStatus, SalesStarted FROM LotteryDraw WHERE DrawDate = ?', [dates.nextMonth]);
    assert.deepEqual(next, { DrawID: next.DrawID, DrawStatus: 'Open', InitializationStatus: 'Ready', SalesStarted: 1 });
    assert.equal((await calendar.execute('SELECT COUNT(*) AS total FROM LotteryNumber WHERE DrawID = ?', [next.DrawID]))[0][0].total, 1000000);
    await monthly(calendar);
    assert.equal((await calendar.execute('SELECT COUNT(*) AS total FROM LotteryDraw WHERE DrawDate = ?', [dates.nextMonth]))[0][0].total, 1);
    await calendar.execute('CALL sp_close_draw(?)', [next.DrawID]);
    await monthly(calendar);
    assert.equal((await calendar.execute('SELECT DrawStatus FROM LotteryDraw WHERE DrawID = ?', [next.DrawID]))[0][0].DrawStatus, 'Closed');

    // Reused fixture inventory models a prepared future draw and first opening
    // in its own month without a third million-row allocation.
    await calendar.execute(`UPDATE LotteryDraw SET DrawDate = ?, SalesCloseAt = TIMESTAMP(?, '10:00:00'),
      DrawAt = TIMESTAMP(?, '11:00:00'), SalesStarted = FALSE WHERE DrawID = ?`,
    [dates.laterMonth, dates.laterMonth, dates.laterMonth, next.DrawID]);
    await calendar.execute('CALL sp_initialize_draw(?)', [next.DrawID]);
    assert.equal((await calendar.execute('SELECT DrawStatus FROM LotteryDraw WHERE DrawID = ?', [next.DrawID]))[0][0].DrawStatus, 'Closed');
    const [previous] = await calendar.execute(`INSERT INTO LotteryDraw (DrawDate, SalesCloseAt, DrawAt, ResultsPublishedAt)
      VALUES (?, TIMESTAMP(?, '10:00:00'), TIMESTAMP(?, '11:00:00'), TIMESTAMP(?, '11:00:00'))`,
    [dates.nextMonth, dates.nextMonth, dates.nextMonth, dates.nextMonth]);
    await calendar.execute(`INSERT INTO Prize (DrawID, PrizeType, PrizeAmount, WinningNumber)
      SELECT ?, PrizeType, PrizeAmount, WinningNumber FROM Prize WHERE DrawID = ?`,
    [previous.insertId, currentSeed.body.data.drawId]);
    await calendar.query('SET timestamp = UNIX_TIMESTAMP(?)', [`${dates.nextMonth} 17:00:00`]);
    await monthly(calendar);
    assert.equal((await calendar.execute('SELECT DrawStatus FROM LotteryDraw WHERE DrawID = ?', [next.DrawID]))[0][0].DrawStatus, 'Open');
    assert.ok(previous.insertId);
  } finally {
    await calendar.query('SET timestamp = 0');
    calendar.release();
  }
  pass('Monthly automation waits for the new Thailand month and completed prior results, creates one full draw and preserves emergency closures');
  console.log(`Completed ${passed} API/MySQL integration groups.`);
}

async function cleanup() {
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  if (pool) await pool.end();
  if (created) { await admin.query(`DROP DATABASE \`${name}\``); created = false; }
  if (admin) await admin.end();
}
check().catch(error => {
  console.error(error.code ?? error.message);
  if (error.code === 'ER_PARSE_ERROR' && /sp_seed_demo/.test(error.sql ?? '')) console.error(error.sqlMessage);
  if (error.code === 'ERR_ASSERTION') console.error(error.message);
  process.exitCode = 1;
}).finally(cleanup);
