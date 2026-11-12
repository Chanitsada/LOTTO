const { fields, id, page, number, list, fail } = require('../utils/api');
const { currentDrawIdSql, currentMonthEndSql, publicDrawWhereSql, drawColumns, formatDraw, prizesFor } = require('../utils/draw');
const db = () => require('../db');
const adminDrawWhereSql = `d.DrawDate <= ${currentMonthEndSql} AND (
  d.ResultsPublishedAt IS NOT NULL OR NOT EXISTS (SELECT 1 FROM LotteryDraw previous
    WHERE previous.DrawDate = LAST_DAY(DATE_SUB(d.DrawDate, INTERVAL 1 MONTH))
      AND (previous.ResultsPublishedAt IS NULL OR previous.ResultsPublishedAt > UTC_TIMESTAMP(6))))`;

async function draws(req, res, admin) {
  const pagination = page(req.query, ['month']);
  let where = admin ? adminDrawWhereSql : publicDrawWhereSql;
  const values = [];
  if (req.query.month !== undefined) {
    if (typeof req.query.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(req.query.month)) {
      fail(400, 'VALIDATION_ERROR', 'month must be YYYY-MM.');
    }
    where += " AND DATE_FORMAT(d.DrawDate, '%Y-%m') = ?";
    values.push(req.query.month);
  }
  const [[total]] = await db().execute(`SELECT COUNT(*) AS total FROM LotteryDraw d WHERE ${where}`, values);
  const [rows] = await db().query(`SELECT ${drawColumns},
    (SELECT COUNT(*) FROM LotteryDraw earlier WHERE earlier.DrawDate <= d.DrawDate) AS drawNumber
    FROM LotteryDraw d WHERE ${where}
    ORDER BY d.DrawDate DESC LIMIT ? OFFSET ?`, [...values, pagination.pageSize, pagination.offset]);
  list(res, rows.map(row => ({ ...formatDraw(row), drawNumber: Number(row.drawNumber) })), pagination, total.total);
}

async function current(req, res) {
  fields(req.query, []);
  const [rows] = await db().execute(`SELECT ${drawColumns} FROM LotteryDraw d WHERE d.DrawID = ${currentDrawIdSql}`);
  if (!rows.length) fail(404, 'DRAW_NOT_FOUND', 'The current monthly draw is not ready yet.');
  res.json({ data: formatDraw(rows[0]) });
}

async function publicDraw(drawId) {
  const [rows] = await db().execute(`SELECT ${drawColumns} FROM LotteryDraw d
    WHERE d.DrawID = ? AND ${publicDrawWhereSql}`, [drawId]);
  if (!rows.length) fail(404, 'DRAW_NOT_FOUND', 'Draw not available. Only the current draw and the previous 12 months of published results are public.');
  return formatDraw(rows[0]);
}

async function adminDraw(drawId) {
  const [rows] = await db().execute(`SELECT ${drawColumns} FROM LotteryDraw d
    WHERE d.DrawID = ? AND ${adminDrawWhereSql}`, [drawId]);
  if (!rows.length) fail(404, 'DRAW_NOT_FOUND', 'Draw not available.');
  return formatDraw(rows[0]);
}

async function detail(req, res, admin) {
  fields(req.query, []);
  const drawId = id(req.params.drawId);
  res.json({ data: await (admin ? adminDraw(drawId) : publicDraw(drawId)) });
}

async function numbers(req, res) {
  const drawId = id(req.params.drawId);
  const pagination = page(req.query, ['ticketNumber']);
  const draw = await publicDraw(drawId);
  if (!draw.isCurrent) fail(404, 'DRAW_NOT_CURRENT', 'Ticket selection is available only for the current draw.');
  const values = [drawId];
  let where = 'DrawID = ?';
  if (req.query.ticketNumber !== undefined) {
    where += ' AND TicketNumber = ?';
    values.push(number(req.query.ticketNumber));
  }
  const [[total]] = await db().execute(`SELECT COUNT(*) AS total FROM LotteryNumber WHERE ${where}`, values);
  const [items] = await db().query(`SELECT LotteryNumberID AS lotteryNumberId, TicketNumber AS ticketNumber,
    AvailableQuantity AS availableQuantity FROM LotteryNumber WHERE ${where}
    ORDER BY TicketNumber LIMIT ? OFFSET ?`, [...values, pagination.pageSize, pagination.offset]);
  res.json({ data: { drawId, purchasable: draw.purchasable, items }, meta: {
    page: pagination.page, pageSize: pagination.pageSize, totalItems: Number(total.total),
  } });
}

async function prizes(req, res) {
  fields(req.query, []);
  const drawId = id(req.params.drawId);
  await publicDraw(drawId);
  // The prize configuration is public, but pending winning numbers are private.
  const [rows] = await db().execute(`SELECT PrizeType AS prizeType, COUNT(*) AS winningNumbers,
    MIN(PrizeAmount) AS prizeAmount FROM Prize WHERE DrawID = ? GROUP BY PrizeType ORDER BY PrizeType`, [drawId]);
  res.json({ data: { drawId, items: rows } });
}

async function results(req, res, admin) {
  fields(req.query, []);
  const drawId = id(req.params.drawId);
  const draw = await (admin ? adminDraw(drawId) : publicDraw(drawId));
  if (!draw.published) return res.json({ data: { drawId, status: 'pending', items: [] } });
  const items = await prizesFor(db(), drawId);
  res.json({ data: { drawId, status: 'published', publishedAt: draw.resultsPublishedAt, items } });
}

async function check(req, res) {
  fields(req.query, ['ticketNumber'], ['ticketNumber']);
  const ticketNumber = number(req.query.ticketNumber);
  const drawId = id(req.params.drawId);
  const draw = await publicDraw(drawId);
  if (!draw.published) return res.json({ data: { drawId, ticketNumber, status: 'pending', prizeAmount: null, prizeType: null } });
  const [winners] = await db().execute(`SELECT PrizeType AS prizeType, PrizeAmount AS prizeAmount
    FROM Prize WHERE DrawID = ? AND WinningNumber = ?`, [drawId, ticketNumber]);
  res.json({ data: { drawId, ticketNumber, status: winners.length ? 'win' : 'loss',
    prizeType: winners[0]?.prizeType ?? null, prizeAmount: winners[0]?.prizeAmount ?? '0.00' } });
}

module.exports = {
  draws: (req, res) => draws(req, res, false), current,
  detail: (req, res) => detail(req, res, false), numbers, prizes,
  results: (req, res) => results(req, res, false), check,
  adminDraws: (req, res) => draws(req, res, true),
  adminDetail: (req, res) => detail(req, res, true),
  adminResults: (req, res) => results(req, res, true),
};
