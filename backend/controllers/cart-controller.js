const { fields, id, fail, transaction } = require('../utils/api');
const { getDraw, currentDrawIdSql } = require('../utils/draw');

async function lockCustomer(connection, userId) {
  const [rows] = await connection.execute('SELECT Role, AccountStatus FROM `User` WHERE UserID = ? FOR UPDATE', [userId]);
  if (!rows.length || rows[0].Role !== 'Customer' || rows[0].AccountStatus !== 'Active') {
    fail(403, 'FORBIDDEN', 'An active Customer account is required.');
  }
}

function quantity(value) {
  if (!Number.isInteger(value) || value < 1 || value > 5) fail(400, 'VALIDATION_ERROR', 'quantity must be an integer from 1 to 5.');
  return value;
}

async function read(req, res) {
  fields(req.query, []);
  const [items] = await require('../db').execute(`SELECT c.CartItemID AS cartItemId,
    n.LotteryNumberID AS lotteryNumberId, n.TicketNumber AS ticketNumber,
    c.Quantity AS quantity, n.AvailableQuantity AS availableQuantity, n.DrawID AS drawId,
    DATE_FORMAT(d.DrawDate, '%Y-%m-%d') AS drawDate,
    (d.DrawID = ${currentDrawIdSql} AND d.DrawStatus = 'Open' AND d.InitializationStatus = 'Ready'
      AND d.ResultsPublishedAt IS NULL AND d.SalesCloseAt > UTC_TIMESTAMP(6)
      AND n.AvailableQuantity >= c.Quantity) AS available
    FROM CartItem c JOIN LotteryNumber n ON n.LotteryNumberID = c.LotteryNumberID
    JOIN LotteryDraw d ON d.DrawID = n.DrawID WHERE c.UserID = ? ORDER BY c.CartItemID`, [req.user.userId]);
  res.json({ data: { items: items.map(item => ({ ...item, available: Boolean(item.available), unitPrice: '100.00' })),
    totalCopies: items.reduce((total, item) => total + item.quantity, 0) } });
}

async function save(req, res, editing) {
  fields(req.body, editing ? ['quantity'] : ['lotteryNumberId', 'quantity'],
    editing ? ['quantity'] : ['lotteryNumberId', 'quantity']);
  const requested = quantity(req.body.quantity);
  const cartItemId = editing ? id(req.params.cartItemId) : null;
  if (!editing && !Number.isInteger(req.body.lotteryNumberId)) fail(400, 'VALIDATION_ERROR', 'lotteryNumberId must be an integer.');
  const data = await transaction(async connection => {
    // Same lock order as sp_checkout: customer, draw, then number/cart writes.
    await lockCustomer(connection, req.user.userId);
    const [existing] = await connection.execute(`SELECT c.CartItemID AS cartItemId, c.Quantity AS quantity,
      c.LotteryNumberID AS lotteryNumberId, n.DrawID AS drawId FROM CartItem c
      JOIN LotteryNumber n ON n.LotteryNumberID = c.LotteryNumberID WHERE c.UserID = ?`, [req.user.userId]);
    const item = editing ? existing.find(value => value.cartItemId === cartItemId) : null;
    if (editing && !item) fail(404, 'NOT_FOUND', 'Cart selection not found.');
    const lotteryNumberId = editing ? item.lotteryNumberId : id(req.body.lotteryNumberId);
    const [numbers] = await connection.execute('SELECT DrawID AS drawId FROM LotteryNumber WHERE LotteryNumberID = ?', [lotteryNumberId]);
    if (!numbers.length) fail(404, 'NOT_FOUND', 'Lottery number not found.');
    const drawId = numbers[0].drawId;
    await connection.execute('SELECT DrawID FROM LotteryDraw WHERE DrawID = ? FOR UPDATE', [drawId]);
    // A locking read sees a closure committed while this transaction waited,
    // even if its earlier cart read already established a repeatable-read snapshot.
    const draw = await getDraw(connection, drawId, true);
    if (!draw.purchasable) fail(409, 'DRAW_CLOSED', 'Add or edit selections only for the current open draw before cutoff.');
    if (existing.some(value => value.drawId !== drawId)) fail(409, 'CART_DRAW_CONFLICT', 'Remove selections from the previous draw first.');
    if (!editing && existing.some(value => value.lotteryNumberId === lotteryNumberId)) fail(409, 'CART_ITEM_EXISTS', 'This number is already saved. Update its quantity instead.');
    const total = existing.reduce((sum, value) => sum + value.quantity, 0) - (item?.quantity ?? 0) + requested;
    if (total > 100) fail(409, 'CART_LIMIT', 'A cart can contain at most 100 copies.');
    if (editing) {
      await connection.execute('UPDATE CartItem SET Quantity = ? WHERE CartItemID = ? AND UserID = ?', [requested, cartItemId, req.user.userId]);
      return { cartItemId, lotteryNumberId, quantity: requested };
    }
    const [inserted] = await connection.execute('INSERT INTO CartItem (UserID, LotteryNumberID, Quantity) VALUES (?, ?, ?)', [req.user.userId, lotteryNumberId, requested]);
    return { cartItemId: inserted.insertId, lotteryNumberId, quantity: requested };
  });
  res.status(editing ? 200 : 201).json({ data });
}

async function remove(req, res) {
  // DELETE has no body. Old/closed-draw selections can still be removed.
  if (req.body !== undefined) fields(req.body, []);
  const cartItemId = id(req.params.cartItemId);
  await transaction(async connection => {
    await lockCustomer(connection, req.user.userId);
    const [result] = await connection.execute('DELETE FROM CartItem WHERE CartItemID = ? AND UserID = ?', [cartItemId, req.user.userId]);
    if (!result.affectedRows) fail(404, 'NOT_FOUND', 'Cart selection not found.');
  });
  res.json({ data: { message: 'Cart selection removed.' } });
}

module.exports = { read, add: (req, res) => save(req, res, false), update: (req, res) => save(req, res, true), remove };
