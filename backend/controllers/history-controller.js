const { fields, id, page, list, fail, sqlError } = require('../utils/api');
const db = () => require('../db');

// Optional predicates are code-defined SQL fragments; request values are bound separately.
async function ticketList(req, res, admin = false) {
  const pagination = page(req.query, admin ? ['drawId', 'customerId'] : ['drawId']);
  const values = [];
  const filters = [];
  if (!admin) { filters.push('t.UserID = ?'); values.push(req.user.userId); }
  if (admin && req.query.customerId !== undefined) { filters.push('t.UserID = ?'); values.push(id(req.query.customerId)); }
  if (req.query.drawId !== undefined) { filters.push('n.DrawID = ?'); values.push(id(req.query.drawId)); }
  const from = `FROM LotteryTicket t JOIN LotteryNumber n ON n.LotteryNumberID = t.LotteryNumberID
    JOIN LotteryDraw d ON d.DrawID = n.DrawID WHERE ${filters.join(' AND ') || '1 = 1'}`;
  const [[total]] = await db().execute(`SELECT COUNT(*) AS total ${from}`, values);
  const [items] = await db().query(`SELECT t.TicketID AS ticketId, t.UserID AS userId,
    t.PaymentID AS paymentId, n.DrawID AS drawId, n.TicketNumber AS ticketNumber,
    t.PurchaseDate AS purchaseDate, DATE_FORMAT(d.DrawDate, '%Y-%m-%d') AS drawDate
    ${from} ORDER BY t.TicketID DESC LIMIT ? OFFSET ?`, [...values, pagination.pageSize, pagination.offset]);
  list(res, items, pagination, total.total);
}

async function paymentList(req, res, admin = false) {
  const pagination = page(req.query, admin ? ['drawId', 'customerId'] : []);
  const values = [];
  const filters = [];
  if (!admin) { filters.push('p.UserID = ?'); values.push(req.user.userId); }
  if (admin && req.query.customerId !== undefined) { filters.push('p.UserID = ?'); values.push(id(req.query.customerId)); }
  if (admin && req.query.drawId !== undefined) {
    filters.push(`EXISTS (SELECT 1 FROM LotteryTicket t JOIN LotteryNumber n
      ON n.LotteryNumberID = t.LotteryNumberID WHERE t.PaymentID = p.PaymentID AND n.DrawID = ?)`);
    values.push(id(req.query.drawId));
  }
  const from = `FROM Payment p WHERE ${filters.join(' AND ') || '1 = 1'}`;
  const [[total]] = await db().execute(`SELECT COUNT(*) AS total ${from}`, values);
  const [items] = await db().query(`SELECT p.PaymentID AS paymentId, p.UserID AS userId,
    p.Amount AS amount, p.PaymentDate AS paymentDate ${from}
    ORDER BY p.PaymentID DESC LIMIT ? OFFSET ?`, [...values, pagination.pageSize, pagination.offset]);
  list(res, items, pagination, total.total);
}

async function payment(req, res) {
  fields(req.query, []);
  const paymentId = id(req.params.paymentId);
  const [rows] = await db().execute(`SELECT PaymentID AS paymentId, Amount AS amount, PaymentDate AS paymentDate
    FROM Payment WHERE PaymentID = ? AND UserID = ?`, [paymentId, req.user.userId]);
  if (!rows.length) fail(404, 'NOT_FOUND', 'Receipt not found.');
  const [tickets] = await db().execute(`SELECT t.TicketID AS ticketId, n.LotteryNumberID AS lotteryNumberId,
    n.TicketNumber AS ticketNumber, n.DrawID AS drawId,
    DATE_FORMAT(d.DrawDate, '%Y-%m-%d') AS drawDate FROM LotteryTicket t
    JOIN LotteryNumber n ON n.LotteryNumberID = t.LotteryNumberID
    JOIN LotteryDraw d ON d.DrawID = n.DrawID
    WHERE t.PaymentID = ? AND t.UserID = ? ORDER BY t.TicketID`, [paymentId, req.user.userId]);
  res.json({ data: { ...rows[0], drawDate: tickets[0]?.drawDate, tickets } });
}

async function ticketResult(req, res) {
  fields(req.query, []);
  const ticketId = id(req.params.ticketId);
  const [owned] = await db().execute('SELECT TicketID FROM LotteryTicket WHERE TicketID = ? AND UserID = ?', [ticketId, req.user.userId]);
  if (!owned.length) fail(404, 'NOT_FOUND', 'Ticket not found.');
  try {
    const [results] = await db().execute('CALL sp_check_ticket(?)', [ticketId]);
    res.json({ data: results[0][0] });
  } catch (error) { sqlError(error); }
}

async function winnings(req, res) {
  fields(req.query, []);
  const [[data]] = await db().execute(`SELECT COALESCE(SUM(p.PrizeAmount), 0.00) AS totalWinnings,
    COUNT(*) AS winningCopies FROM LotteryTicket t
    JOIN LotteryNumber n ON n.LotteryNumberID = t.LotteryNumberID
    JOIN LotteryDraw d ON d.DrawID = n.DrawID
    JOIN Prize p ON p.DrawID = n.DrawID AND p.WinningNumber = n.TicketNumber
    WHERE t.UserID = ? AND d.ResultsPublishedAt IS NOT NULL
      AND d.ResultsPublishedAt <= UTC_TIMESTAMP(6) AND d.DrawAt <= UTC_TIMESTAMP(6)`, [req.user.userId]);
  res.json({ data });
}

module.exports = { tickets: (req, res) => ticketList(req, res),
  payments: (req, res) => paymentList(req, res),
  adminTickets: (req, res) => ticketList(req, res, true),
  adminPayments: (req, res) => paymentList(req, res, true), payment, ticketResult, winnings };
