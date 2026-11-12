const { test, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { validateCheckout } = require('../utils/checkout');
const { generateWinners, validPrizes } = require('../utils/draw');
const { drawDate, page, sqlError } = require('../utils/api');
const { errorHandler } = require('../middleware/error-handler');
const checkout = require('../controllers/checkout-controller').checkout;
const dbPath = require.resolve('../db');
const original = require.cache[dbPath];
let execute;
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true,
  exports: { execute: (...args) => execute(...args) } };
beforeEach(() => { execute = async () => assert.fail('Unexpected database call'); });
after(() => { if (original) require.cache[dbPath] = original; else delete require.cache[dbPath]; });
const input = () => ({ drawId: 1, items: [{ lotteryNumberId: 2, quantity: 2 }] });

test('checkout rejects forged identity/prices, mixed types, duplicate IDs and totals over 100', () => {
  for (const body of [undefined, { ...input(), userId: 3 }, { ...input(), amount: 1 },
    { ...input(), drawId: '1' }, { drawId: 1, items: [] },
    { drawId: 1, items: [{ lotteryNumberId: 1, quantity: 6 }] },
    { drawId: 1, items: [{ lotteryNumberId: '1', quantity: 1 }] },
    { drawId: 1, items: [{ lotteryNumberId: 1, quantity: 1 }, { lotteryNumberId: 1, quantity: 2 }] },
    { drawId: 1, items: Array.from({ length: 21 }, (_, i) => ({ lotteryNumberId: i + 1, quantity: 5 })) }]) {
    assert.throws(() => validateCheckout(body), { code: 'VALIDATION_ERROR' });
  }
  assert.deepEqual(validateCheckout(input()), input());
});

test('checkout needs no retry header and returns a new trusted receipt using the authenticated buyer', async () => {
  execute = async (sql, values) => {
    assert.equal(sql, 'CALL sp_checkout(?, ?, ?)');
    assert.deepEqual(values, [17, 1, JSON.stringify(input().items)]);
    return [[[{ paymentId: 4, drawId: 1, amount: '200.00' }],
      [{ ticketId: 8 }, { ticketId: 9 }], {}]];
  };
  const res = { status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } };
  await checkout({ body: input(), user: { userId: 17 } }, res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.data.amount, '200.00');
  assert.equal(res.body.data.tickets.length, 2);
});

test('only known SQL signals become public errors; unexpected database details stay private', () => {
  for (const [code, status] of [['DRAW_NOT_CURRENT', 409], ['DRAW_NOT_FOUND', 404], ['CART_CHANGED', 409]]) {
    assert.throws(() => sqlError({ sqlState: '45000', sqlMessage: code }), { code, status });
  }
  const privateError = new Error('PRIVATE_SQL_PASSWORD');
  assert.throws(() => sqlError(privateError), error => error === privateError);
  const res = { headersSent: false, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; } };
  errorHandler(privateError, {}, res, () => assert.fail());
  assert.equal(res.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE/);
});

test('draw dates and pagination reject invalid calendar dates and excessive pages', () => {
  for (const value of ['2026-02-29', '2026-04-31', '2026-11-01', 'bad']) assert.throws(() => drawDate(value));
  assert.equal(drawDate('2028-02-29'), '2028-02-29');
  assert.throws(() => page({ pageSize: '101' }));
  assert.throws(() => page({ page: ['1', '2'] }));
  assert.deepEqual(page({ page: '2' }), { page: 2, pageSize: 20, offset: 20 });
});

test('winner selection rejects duplicate samples and preserves all six digits across the full pool', () => {
  const samples = [0, 0, 999999, ...Array.from({ length: 11 }, (_, i) => i + 1)];
  const result = generateWinners(max => { assert.equal(max, 1000000); return samples.shift(); });
  assert.equal(result.length, 13);
  assert.equal(new Set(result).size, 13);
  assert.equal(result[0], '000000');
  assert.equal(result[1], '999999');
  for (let i = 0; i < 50; i++) assert.equal(new Set(generateWinners()).size, 13);
});

test('prize validation checks amounts, exact tier counts and unique winners', () => {
  const prizes = ['1st', '2nd', '3rd', ...Array(10).fill('4th')].map((prizeType, i) => ({
    prizeType, prizeAmount: { '1st': '6000000.00', '2nd': '200000.00', '3rd': '80000.00', '4th': '2000.00' }[prizeType],
    winningNumber: String(i).padStart(6, '0'),
  }));
  assert.equal(validPrizes(prizes, true), true);
  assert.equal(validPrizes(prizes), false);
  assert.equal(validPrizes(prizes.map(p => ({ ...p, winningNumber: null }))), true);
  assert.equal(validPrizes(prizes.map(p => ({ ...p, winningNumber: '000000' })), true), false);
  assert.equal(validPrizes(prizes.slice(1), true), false);
});
