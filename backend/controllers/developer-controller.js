const { page, number, fail } = require('../utils/api');
const { currentDrawIdSql } = require('../utils/draw');

// Grouped purchased-copy counts join to inventory; unsold numbers contribute zero.
const inventoryFrom = `FROM LotteryNumber n LEFT JOIN (
  SELECT t.LotteryNumberID, COUNT(*) AS purchasedCopies
  FROM LotteryTicket t JOIN LotteryNumber purchased ON purchased.LotteryNumberID = t.LotteryNumberID
  WHERE purchased.DrawID = ? GROUP BY t.LotteryNumberID
) sold ON sold.LotteryNumberID = n.LotteryNumberID WHERE n.DrawID = ?`;
const consistentSql = '(n.AvailableQuantity + COALESCE(sold.purchasedCopies, 0) = 5)';

async function inventory(req, res) {
  const pagination = page(req.query, ['ticketNumber', 'inconsistentOnly']);
  const ticketNumber = req.query.ticketNumber === undefined ? null : number(req.query.ticketNumber);
  if (req.query.inconsistentOnly !== undefined && !['true', 'false'].includes(req.query.inconsistentOnly)) {
    fail(400, 'VALIDATION_ERROR', 'inconsistentOnly must be true or false.');
  }
  const connection = await require('../db').getConnection();
  try {
    // No row locks or writes. All totals and rows see the same committed checkout state.
    await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const [[draw]] = await connection.execute(`SELECT d.DrawID AS drawId,
      DATE_FORMAT(d.DrawDate, '%Y-%m-%d') AS drawDate, d.InitializationStatus AS initializationStatus
      FROM LotteryDraw d WHERE d.DrawID = ${currentDrawIdSql}`);
    if (!draw) fail(404, 'DRAW_NOT_FOUND', 'The current monthly draw is missing.');
    const values = [draw.drawId, draw.drawId];
    const [[totals]] = await connection.execute(`SELECT COUNT(*) AS numberCount,
      COALESCE(SUM(n.AvailableQuantity), 0) AS availableCopies,
      COALESCE(SUM(COALESCE(sold.purchasedCopies, 0)), 0) AS purchasedCopies,
      COALESCE(SUM(NOT ${consistentSql}), 0) AS inconsistentNumbers ${inventoryFrom}`, values);
    const summary = Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Number(value)]));
    summary.expectedNumbers = 1000000;
    summary.missingNumbers = Math.max(0, summary.expectedNumbers - summary.numberCount);
    const consistent = draw.initializationStatus === 'Ready' && summary.numberCount === summary.expectedNumbers && summary.inconsistentNumbers === 0;
    let filteredFrom = inventoryFrom;
    if (ticketNumber !== null) { filteredFrom += ' AND n.TicketNumber = ?'; values.push(ticketNumber); }
    if (req.query.inconsistentOnly === 'true') filteredFrom += ` AND NOT ${consistentSql}`;
    let totalItems = summary.numberCount;
    if (filteredFrom !== inventoryFrom) {
      const [[count]] = await connection.execute(`SELECT COUNT(*) AS total ${filteredFrom}`, values);
      totalItems = Number(count.total);
    }
    const [rows] = await connection.query(`SELECT n.LotteryNumberID AS lotteryNumberId,
      n.TicketNumber AS ticketNumber, n.AvailableQuantity AS availableQuantity,
      COALESCE(sold.purchasedCopies, 0) AS purchasedCopies, ${consistentSql} AS consistent
      ${filteredFrom} ORDER BY n.TicketNumber LIMIT ? OFFSET ?`, [...values, pagination.pageSize, pagination.offset]);
    await connection.commit();
    res.json({ data: { draw, summary: { ...summary, consistent }, items: rows.map(row => ({
      ...row, purchasedCopies: Number(row.purchasedCopies), consistent: Boolean(row.consistent),
    })) }, meta: { page: pagination.page, pageSize: pagination.pageSize, totalItems } });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

module.exports = { inventory };
