// Run: node database/test.cjs (or npm run test:sql from backend/).
// Uses a cached image only. Never contacts a project/personal MySQL server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { hashPassword, comparePassword } = require('../backend/utils/password');
const exec = promisify(execFile);
const image = process.env.LOTTO_MYSQL_IMAGE || 'mysql:8.0';
const container = `lotto-sql-check-${process.pid}-${Date.now()}`;
let created = false;
let passed = 0;
const quote = value => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function pass(label) { passed++; console.log(`PASS: ${label}`); }
async function docker(args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        // Do not echo SQL statements, credentials or generated password hashes.
        const safe = stderr.split('\n').filter(line => line.startsWith('ERROR')).join('\n');
        reject(new Error(safe || `Docker command failed (${args[0]}). Check Docker Desktop and the cached image.`));
      } else resolve(stdout.trim());
    });
    if (input !== undefined) child.stdin.end(input);
  });
}
function mysql(script) {
  return docker(['exec', '-i', container, 'mysql', '--protocol=TCP', '-h127.0.0.1', '-uroot',
    '--batch', '--raw', '--skip-column-names', '--default-character-set=utf8mb4'], script);
}
function sql(script) { return mysql(`USE lotto; SET SESSION time_zone = '+00:00';\n${script}`); }
async function source(file, prefix = '') { return mysql(prefix + '\n' + fs.readFileSync(path.join(__dirname, file), 'utf8')); }
async function expectError(script, code) {
  await assert.rejects(() => sql(script), error => error.message.includes(code), `Expected ${code}`);
}
const rows = output => output.split('\n').filter(Boolean).map(line => line.split('\t'));
// Custom-date test fixtures use the initializer, without overriding production seeding.
async function seed(date) {
  const selected = quote(date);
  return sql(`INSERT INTO LotteryDraw (DrawDate, SalesCloseAt, DrawAt)
    SELECT ${selected}, TIMESTAMP(${selected}, '10:00:00'), TIMESTAMP(${selected}, '11:00:00')
    WHERE NOT EXISTS (SELECT 1 FROM LotteryDraw WHERE DrawDate = ${selected});
    SET @fixture_draw = (SELECT DrawID FROM LotteryDraw WHERE DrawDate = ${selected});
    CALL sp_initialize_draw(@fixture_draw);`);
}
async function check() {
  try {
    await exec('docker', ['image', 'inspect', image]);
  } catch {
    throw new Error(`No usable cached ${image} image or Docker daemon. Start Docker Desktop and provide a locally available MySQL 8 image; this script will not download one.`);
  }
  // Include interrupted/failed starts in cleanup; the name belongs only to this run.
  created = true;
  await docker(['run', '--detach', '--rm', '--pull=never', '--network=none', '--name', container,
    '-e', 'MYSQL_ALLOW_EMPTY_PASSWORD=yes', image]);
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { await mysql('SELECT 1;'); ready = true; break; } catch { await pause(1000); }
  }
  assert.ok(ready, 'MySQL did not finish startup within 120 seconds');
  const version = await mysql('SELECT VERSION();');
  assert.match(version, /^8\./, 'Tests require MySQL 8');
  console.log(`Testing isolated MySQL ${version}; no host database ports are exposed.`);
  for (const file of ['schema.sql', 'procedures.sql', 'triggers.sql']) await source(file);
  assert.equal(await sql("SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema='lotto' AND routine_type='PROCEDURE';"), '6');
  assert.equal(await sql("SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='lotto';"), '2');
  pass('Schema, six procedures and two triggers load successfully');

  const seedDate = await mysql("SELECT DATE_FORMAT(LAST_DAY(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR))), '%Y-%m-%d');");
  console.log('Generating and checking the full one-million-row inventory...');
  await seed(seedDate);
  const draw = Number(await sql(`SELECT DrawID FROM LotteryDraw WHERE DrawDate=${quote(seedDate)};`));
  assert.equal(await sql(`SELECT COUNT(*), SUM(AvailableQuantity), MIN(TicketNumber), MAX(TicketNumber) FROM LotteryNumber WHERE DrawID=${draw};`), '1000000\t5000000\t000000\t999999');
  assert.equal(await sql(`SELECT DrawStatus = IF(SalesCloseAt > UTC_TIMESTAMP(6), 'Open', 'Closed'), InitializationStatus FROM LotteryDraw WHERE DrawID=${draw};`), '1\tReady');
  assert.equal(await sql(`SELECT PrizeType, COUNT(*), MIN(PrizeAmount), SUM(WinningNumber IS NOT NULL) FROM Prize WHERE DrawID=${draw} GROUP BY PrizeType ORDER BY PrizeType;`), '1st\t1\t6000000.00\t0\n2nd\t1\t200000.00\t0\n3rd\t1\t80000.00\t0\n4th\t10\t2000.00\t0');
  assert.equal(await sql('SELECT (SELECT COUNT(*) FROM LotteryTicket), (SELECT COUNT(*) FROM Payment);'), '0\t0');
  await seed(seedDate);
  assert.equal(await sql(`SELECT COUNT(*) FROM LotteryNumber WHERE DrawID=${draw};`), '1000000');
  pass('Full seed has exact stock/prizes, preserves leading zeros, and reruns safely');

  const hash = await hashPassword('DemoPassword123');
  const register = async (name, email) => Number(rows(await sql(`CALL sp_register_user(${quote(name)}, '0812345678', ${quote(email)}, ${quote(hash)});`))[0][0]);
  const a = await register('Customer A', 'a@example.com');
  const b = await register('Customer B', 'b@example.com');
  const longEmail = `${'a'.repeat(242)}@example.com`;
  const c = await register('ก'.repeat(100), longEmail);
  assert.equal(await sql(`SELECT Role, CHAR_LENGTH(Email) FROM \`User\` WHERE UserID=${c};`), 'Customer\t254');
  assert.equal(await comparePassword('DemoPassword123', await sql(`SELECT Password FROM \`User\` WHERE UserID=${a};`)), true);
  await expectError(`CALL sp_register_user('Duplicate','1','A@example.com',${quote(hash)});`, 'DUPLICATE_EMAIL');
  await expectError("CALL sp_register_user('Bad','1','bad@example.com','plaintext');", 'INVALID_PASSWORD_HASH');
  await expectError(`CALL sp_register_user('Bad','1','invalid',${quote(hash)});`, 'INVALID_INPUT');
  await sql(`UPDATE \`User\` SET AccountStatus='Deactivated' WHERE UserID=${c};
    INSERT INTO \`User\` (Name,Email,Password,Role) VALUES ('Admin','admin@example.com',${quote(hash)},'Admin'), ('Developer','developer@example.com',${quote(hash)},'Developer');`);
  pass('Registration stores valid hashes, accepts 254-character email and rejects duplicates/plaintext');

  async function number(value) { return Number(await sql(`SELECT LotteryNumberID FROM LotteryNumber WHERE DrawID=${draw} AND TicketNumber=${quote(value)};`)); }
  const first = await number('000001');
  const second = await number('123456');
  assert.equal(await sql('SELECT COUNT(*) FROM CartItem;'), '0');
  await sql(`INSERT INTO CartItem (UserID, LotteryNumberID, Quantity)
    VALUES (${a}, ${first}, 1), (${b}, ${first}, 5);`);
  await expectError(`INSERT INTO CartItem (UserID, LotteryNumberID, Quantity)
    VALUES (${a}, ${first}, 1);`, 'uq_cartitem_user_number');
  for (const quantity of [0, 6]) {
    await expectError(`INSERT INTO CartItem (UserID, LotteryNumberID, Quantity)
      VALUES (${a}, ${second}, ${quantity});`, 'chk_cartitem_quantity');
  }
  await expectError(`INSERT INTO CartItem (UserID, LotteryNumberID, Quantity)
    VALUES (0, ${first}, 1);`, 'fk_cartitem_user');
  await expectError(`INSERT INTO CartItem (UserID, LotteryNumberID, Quantity)
    VALUES (${a}, 2147483647, 1);`, 'fk_cartitem_number');
  await sql(`UPDATE CartItem SET Quantity=5 WHERE UserID=${a} AND LotteryNumberID=${first};`);
  const cartItemId = Number(await sql(`SELECT CartItemID FROM CartItem
    WHERE UserID=${a} AND LotteryNumberID=${first};`));
  assert.equal(await sql(`DELETE FROM CartItem WHERE UserID=${b}
    AND CartItemID=${cartItemId}; SELECT ROW_COUNT();`), '0');
  await sql(`DELETE FROM CartItem WHERE UserID=${a} AND LotteryNumberID=${first};`);
  assert.equal(await sql(`SELECT Quantity FROM CartItem WHERE UserID=${b} AND LotteryNumberID=${first};`), '5');
  await sql(`DELETE FROM CartItem WHERE UserID=${b} AND LotteryNumberID=${first};`);
  assert.equal(await sql(`SELECT AvailableQuantity FROM LotteryNumber WHERE LotteryNumberID=${first};`), '5');
  assert.equal(await sql('SELECT (SELECT COUNT(*) FROM LotteryTicket), (SELECT COUNT(*) FROM Payment);'), '0\t0');
  pass('CartItem enforces references, unique selections and quantities 1-5; cart edits never change stock or purchases');

  function checkout(user, items, drawId = draw) {
    return `CALL sp_checkout(${user}, ${drawId}, ${quote(JSON.stringify(items))});`;
  }
  const cart = [{ lotteryNumberId: first, quantity: 2 }, { lotteryNumberId: second, quantity: 1 }];
  await expectError(checkout(a, cart), 'DRAW_CLOSED');
  await sql(`UPDATE LotteryDraw SET DrawStatus='Open', InitializationStatus='Pending' WHERE DrawID=${draw};`);
  await expectError(checkout(a, cart), 'DRAW_NOT_READY');
  await sql(`UPDATE LotteryDraw SET InitializationStatus='Ready' WHERE DrawID=${draw};`);
  const receipt = rows(await sql(checkout(a, cart)));
  const payment = Number(receipt[0][0]);
  assert.equal(receipt[0][2], '300.00');
  assert.equal(receipt.length, 4);
  assert.equal(await sql(`SELECT AvailableQuantity FROM LotteryNumber WHERE LotteryNumberID=${first};`), '3');
  assert.equal(await sql(`SELECT COUNT(*) FROM LotteryTicket WHERE PaymentID=${payment};`), '3');
  assert.equal(await sql(`CALL sp_admin_dashboard_summary(${draw});`), '3\t3\t300.00');
  pass('Checkout expands copies, deducts stock once and avoids dashboard double counts');

  for (const invalid of [[], [{ lotteryNumberId: first, quantity: 0 }], [{ lotteryNumberId: first, quantity: 1.5 }],
    [{ lotteryNumberId: String(first), quantity: 1 }], [{ lotteryNumberId: first, quantity: '1' }],
    [{ lotteryNumberId: first, quantity: 1, role: 'Admin' }], [{ lotteryNumberId: first, quantity: 1 }, { lotteryNumberId: first, quantity: 1 }]]) {
    await expectError(checkout(a, invalid), 'INVALID_INPUT');
  }
  await expectError(checkout(c, cart), 'ACCOUNT_DISABLED');
  const admin = Number(await sql("SELECT UserID FROM `User` WHERE Role='Admin';"));
  await expectError(checkout(admin, cart), 'FORBIDDEN');
  const beforeInvalid = await sql('SELECT COUNT(*), SUM(Amount) FROM Payment;');
  await expectError(checkout(a, [{ lotteryNumberId: first, quantity: 4 }]), 'INSUFFICIENT_STOCK');
  assert.equal(await sql('SELECT COUNT(*), SUM(Amount) FROM Payment;'), beforeInvalid);
  pass('Invalid JSON item types, duplicate IDs, inactive accounts and insufficient stock are rejected');

  // Fault injection verifies rollback after the first purchased copy was written.
  const faultA = await number('000007');
  const faultB = await number('000008');
  await sql(`DELIMITER $$
CREATE TRIGGER trg_test_insert_failure BEFORE INSERT ON LotteryTicket FOR EACH ROW
BEGIN
  IF NEW.LotteryNumberID=${Math.max(faultA, faultB)} THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='FORCED_TEST_FAILURE';
  END IF;
END$$
DELIMITER ;`);
  const countsBefore = await sql('SELECT (SELECT COUNT(*) FROM Payment), (SELECT COUNT(*) FROM LotteryTicket);');
  await expectError(checkout(a, [{ lotteryNumberId: faultA, quantity: 1 }, { lotteryNumberId: faultB, quantity: 1 }]), 'FORCED_TEST_FAILURE');
  await sql('DROP TRIGGER trg_test_insert_failure;');
  assert.equal(await sql('SELECT (SELECT COUNT(*) FROM Payment), (SELECT COUNT(*) FROM LotteryTicket);'), countsBefore);
  assert.equal(await sql(`SELECT SUM(AvailableQuantity) FROM LotteryNumber WHERE LotteryNumberID IN (${faultA},${faultB});`), '10');
  pass('A ticket-insert failure rolls back the payment, tickets and inventory');

  await sql("INSERT INTO LotteryDraw (DrawDate,SalesCloseAt,DrawAt) VALUES ('2098-11-30','2098-11-30 10:00:00','2098-11-30 11:00:00'); INSERT INTO LotteryNumber (DrawID,TicketNumber) SELECT DrawID,'000001' FROM LotteryDraw WHERE DrawDate='2098-11-30';");
  const foreignNumber = Number(await sql("SELECT n.LotteryNumberID FROM LotteryNumber n JOIN LotteryDraw d ON d.DrawID=n.DrawID WHERE d.DrawDate='2098-11-30';"));
  await expectError(checkout(a, [{ lotteryNumberId: foreignNumber, quantity: 1 }]), 'INVALID_NUMBER');
  await expectError(`INSERT INTO LotteryTicket (UserID,LotteryNumberID,PaymentID) VALUES (${b},${first},${payment});`, 'PAYMENT_OWNER_MISMATCH');
  await expectError(`DELETE FROM \`User\` WHERE UserID=${a};`, 'fk_');
  pass('Cross-draw inventory, mismatched payment owners and destructive account deletion fail');

  // Stored-program NOW() is fixed at CALL start; the wall-clock expression must advance.
  await sql(`DELIMITER $$
CREATE PROCEDURE sp_test_clock()
BEGIN
  DECLARE started DATETIME(6);
  SET started=UTC_TIMESTAMP(6);
  DO SLEEP(1.1);
  SELECT TIMESTAMPDIFF(MICROSECOND, started,
    DATE_ADD(UTC_TIMESTAMP(6), INTERVAL TIMESTAMPDIFF(MICROSECOND,NOW(6),SYSDATE(6)) MICROSECOND)) >= 1000000;
END$$
DELIMITER ;`);
  assert.equal(await sql("SET SESSION time_zone='+07:00'; CALL sp_test_clock();"), '1');
  await sql('DROP PROCEDURE sp_test_clock;');
  pass('Cutoff clock advances inside a long CALL even with a non-UTC session timezone');

  const last = await number('000010');
  await sql(checkout(a, [{ lotteryNumberId: last, quantity: 4 }]));
  const racing = await Promise.allSettled([
    sql(checkout(a, [{ lotteryNumberId: last, quantity: 1 }])),
    sql(checkout(b, [{ lotteryNumberId: last, quantity: 1 }])),
  ]);
  assert.equal(racing.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(racing.find(r => r.status === 'rejected').reason.message, /INSUFFICIENT_STOCK/);
  assert.equal(await sql(`SELECT AvailableQuantity FROM LotteryNumber WHERE LotteryNumberID=${last};`), '0');
  const repeatedNumber = await number('000011');
  const repeatedCall = checkout(b, [{ lotteryNumberId: repeatedNumber, quantity: 1 }]);
  const repeated = await Promise.all([sql(repeatedCall), sql(repeatedCall)]);
  assert.notEqual(rows(repeated[0])[0][0], rows(repeated[1])[0][0]);
  assert.equal(await sql(`SELECT AvailableQuantity FROM LotteryNumber WHERE LotteryNumberID=${repeatedNumber};`), '3');
  pass('Stock cannot oversell; repeated demo checkouts create independent purchases');

  const many = rows(await sql(`SELECT LotteryNumberID FROM LotteryNumber WHERE DrawID=${draw} AND TicketNumber BETWEEN '001000' AND '001020' ORDER BY TicketNumber;`)).map(r => Number(r[0]));
  await sql(checkout(a, many.slice(0,20).map(id => ({ lotteryNumberId: id, quantity: 5 }))));
  await expectError(checkout(a, many.map(id => ({ lotteryNumberId: id, quantity: 5 }))), 'INVALID_INPUT');
  pass('A 100-copy checkout succeeds and more than 100 copies fails');

  const closeNumber = await number('000013');
  const closing = await Promise.allSettled([
    sql(checkout(b, [{ lotteryNumberId: closeNumber, quantity: 1 }])),
    sql(`CALL sp_close_draw(${draw});`),
  ]);
  assert.equal(closing[1].status, 'fulfilled');
  if (closing[0].status === 'rejected') assert.match(closing[0].reason.message, /DRAW_CLOSED/);
  assert.equal(await sql(`SELECT DrawStatus FROM LotteryDraw WHERE DrawID=${draw};`), 'Closed');
  await expectError(checkout(a, cart), 'DRAW_CLOSED');
  await expectError(checkout(a, cart), 'DRAW_CLOSED');
  await expectError(`DELETE FROM LotteryTicket WHERE PaymentID=${payment};`, 'PURCHASED_TICKET_DELETE_BLOCKED');
  await expectError(`INSERT INTO LotteryTicket (UserID,LotteryNumberID,PaymentID) VALUES (${a},${first},${payment});`, 'DRAW_CLOSED');
  const beforeSeed = await sql(`SELECT SUM(AvailableQuantity) FROM LotteryNumber WHERE DrawID=${draw};`);
  await seed(seedDate);
  assert.equal(await sql(`SELECT SUM(AvailableQuantity) FROM LotteryNumber WHERE DrawID=${draw};`), beforeSeed);
  assert.equal(await sql(`SELECT DrawStatus FROM LotteryDraw WHERE DrawID=${draw};`), 'Closed');
  pass('Closure races are safe; closed checkouts fail; triggers and reseeding protect purchases');

  // Advance this isolated fixture to a past draw, without changing the server clock.
  await sql(`UPDATE LotteryDraw SET DrawDate='2000-01-31', SalesCloseAt='2000-01-31 10:00:00', DrawAt='2000-01-31 11:00:00', DrawStatus='Open' WHERE DrawID=${draw};`);
  await expectError(checkout(b, [{ lotteryNumberId: closeNumber, quantity: 1 }]), 'DRAW_CLOSED');
  await expectError(`INSERT INTO LotteryTicket (UserID,LotteryNumberID,PaymentID) VALUES (${a},${first},${payment});`, 'DRAW_CLOSED');
  await expectError(checkout(a, cart), 'DRAW_CLOSED');
  await sql(`CALL sp_close_draw(${draw});`);
  pass('Actual cutoff is enforced even when a late timer leaves the draw marked Open');

  const ticket = Number(await sql(`SELECT MIN(TicketID) FROM LotteryTicket WHERE PaymentID=${payment} AND LotteryNumberID=${first};`));
  const loser = Number(await sql(`SELECT MIN(TicketID) FROM LotteryTicket WHERE PaymentID=${payment} AND LotteryNumberID=${second};`));
  assert.equal(rows(await sql(`CALL sp_check_ticket(${ticket});`))[0][3], 'pending');
  const prizes = rows(await sql(`SELECT PrizeID,PrizeType FROM Prize WHERE DrawID=${draw} ORDER BY PrizeID;`));
  const winning = ['888888','777777','666666','000001','900001','900002','900003','900004','900005','900006','900007','900008','900009'];
  for (let i=0; i<prizes.length; i++) await sql(`UPDATE Prize SET WinningNumber=${quote(winning[i])} WHERE PrizeID=${Number(prizes[i][0])};`);
  assert.equal(rows(await sql(`CALL sp_check_ticket(${ticket});`))[0][3], 'pending');
  await sql(`UPDATE LotteryDraw SET ResultsPublishedAt=UTC_TIMESTAMP(6) WHERE DrawID=${draw};`);
  assert.deepEqual(rows(await sql(`CALL sp_check_ticket(${ticket});`))[0].slice(3), ['win','4th','2000.00']);
  assert.deepEqual(rows(await sql(`CALL sp_check_ticket(${loser});`))[0].slice(3), ['loss','NULL','0.00']);
  assert.equal(await sql(`SELECT COUNT(*) FROM LotteryTicket WHERE PaymentID=${payment} AND LotteryNumberID=${first};`), '2');
  pass('Unpublished results stay pending; each winning copy earns one prize and unsold numbers can win');

  const prize = Number(prizes[3][0]);
  await expectError(`UPDATE Prize SET WinningNumber='888888' WHERE PrizeID=${prize};`, 'uq_prize_draw_winning');
  await seed('2000-01-31');
  assert.equal(await sql(`SELECT WinningNumber FROM Prize WHERE PrizeID=${prize};`), '000001');
  assert.equal(await sql(`SELECT DrawStatus,ResultsPublishedAt IS NOT NULL FROM LotteryDraw WHERE DrawID=${draw};`), 'Closed\t1');
  assert.equal(await sql(`SELECT COUNT(*) FROM LotteryNumber n WHERE n.DrawID=${draw} AND n.AvailableQuantity + (SELECT COUNT(*) FROM LotteryTicket t WHERE t.LotteryNumberID=n.LotteryNumberID) <> 5;`), '0');
  pass('Reseeding preserves published results and stock invariants');

  await sql("INSERT INTO LotteryDraw (DrawDate,SalesCloseAt,DrawAt) VALUES ('2098-12-31','2098-12-31 10:00:00','2098-12-31 11:00:00'); INSERT INTO Prize (DrawID,PrizeType,PrizeAmount) SELECT DrawID,'1st',6000000 FROM LotteryDraw WHERE DrawDate='2098-12-31';");
  await assert.rejects(() => seed('2098-12-31'), /SEED_PRIZES_INVALID/);
  await sql('DROP PROCEDURE IF EXISTS sp_seed_demo;');
  await expectError("INSERT INTO LotteryDraw (DrawDate,SalesCloseAt,DrawAt) VALUES ('2098-12-30','2098-12-30 10:00:00','2098-12-30 11:00:00');", 'chk_draw_month_end');
  await expectError(`INSERT INTO LotteryNumber (DrawID,TicketNumber) VALUES (${draw},'000001');`, 'uq_lotterynumber_draw_number');
  await expectError(`UPDATE LotteryNumber SET AvailableQuantity=6 WHERE LotteryNumberID=${first};`, 'chk_lotterynumber_available');
  pass('Partial prize configurations, non-month-end draws, duplicate numbers and invalid stock are rejected');
  await source('schema.sql');
  assert.equal(await sql('SELECT (SELECT COUNT(*) FROM `User`), (SELECT COUNT(*) FROM LotteryNumber), (SELECT COUNT(*) FROM Payment);'), '0\t0\t0');
  pass('Schema reset recreates empty tables inside the disposable container');
  console.log(`Completed ${passed} SQL integration groups against MySQL ${version}.`);
}
async function cleanup() {
  if (created) {
    created = false;
    await exec('docker', ['rm', '-f', container]).catch(() => {});
  }
}
process.on('SIGINT', () => { cleanup().finally(() => process.exit(130)); });
process.on('SIGTERM', () => { cleanup().finally(() => process.exit(143)); });
check().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(cleanup);
