const { fail, fields, id, page, list, transaction, sqlError } = require('../utils/api');
const { getDraw, validPrizes, generateWinners, prizesFor } = require('../utils/draw');
const db = () => require('../db');

async function initialize(req, res) {
  fields(req.body, []);
  const drawId = id(req.params.drawId);
  try {
    const [results] = await db().execute('CALL sp_initialize_draw(?)', [drawId]);
    res.json({ data: results[0][0] });
  } catch (error) { sqlError(error); }
}

async function initialization(req, res) {
  fields(req.query, []);
  const drawId = id(req.params.drawId);
  const draw = await getDraw(db(), drawId);
  const [[count]] = await db().execute('SELECT COUNT(*) AS initializedNumbers FROM LotteryNumber WHERE DrawID = ?', [drawId]);
  res.json({ data: { drawId, initializationStatus: draw.initializationStatus,
    initializedNumbers: Number(count.initializedNumbers) } });
}

async function close(req, res) {
  fields(req.body, []);
  try {
    const [results] = await db().execute('CALL sp_close_draw(?)', [id(req.params.drawId)]);
    res.json({ data: results[0][0] });
  } catch (error) { sqlError(error); }
}

async function generate(req, res) {
  fields(req.body, []);
  const drawId = id(req.params.drawId);
  const data = await transaction(async connection => {
    const [rows] = await connection.execute('SELECT DrawID FROM LotteryDraw WHERE DrawID = ? FOR UPDATE', [drawId]);
    if (!rows.length) fail(404, 'DRAW_NOT_FOUND', 'Draw not found.');
    const [[draw]] = await connection.execute(`SELECT DrawStatus, InitializationStatus, ResultsPublishedAt,
      DrawAt <= UTC_TIMESTAMP(6) AS scheduled FROM LotteryDraw WHERE DrawID = ?`, [drawId]);
    if (draw.ResultsPublishedAt !== null) fail(409, 'RESULTS_ALREADY_PUBLISHED', 'Published results are final and cannot be changed or generated again.');
    if (draw.DrawStatus !== 'Closed' || !draw.scheduled) fail(409, 'DRAW_NOT_DUE', 'Close sales and wait until the scheduled 18:00 Thailand draw.');
    const prizes = await prizesFor(connection, drawId, true);
    if (draw.InitializationStatus !== 'Ready' || !validPrizes(prizes)) fail(409, 'DRAW_NOT_READY', 'The prize configuration is not ready.');
    const winners = generateWinners();
    for (let i = 0; i < prizes.length; i++) {
      await connection.execute('UPDATE Prize SET WinningNumber = ? WHERE PrizeID = ?', [winners[i], prizes[i].prizeId]);
      prizes[i].winningNumber = winners[i];
    }
    await connection.execute('UPDATE LotteryDraw SET ResultsPublishedAt = UTC_TIMESTAMP(6) WHERE DrawID = ?', [drawId]);
    return { drawId, status: 'published', algorithm: 'crypto-random-int-v1', items: prizes };
  });
  res.status(201).json({ data });
}

async function dashboard(req, res) {
  fields(req.query, ['drawId']);
  const drawId = req.query.drawId === undefined ? null : id(req.query.drawId);
  try {
    const [results] = await db().execute('CALL sp_admin_dashboard_summary(?)', [drawId]);
    res.json({ data: results[0][0] });
  } catch (error) { sqlError(error); }
}

async function winners(req, res) {
  const drawId = id(req.params.drawId);
  const pagination = page(req.query);
  const draw = await getDraw(db(), drawId);
  if (!draw.published) return list(res, [], pagination, 0);
  const from = `FROM LotteryTicket t JOIN LotteryNumber n ON n.LotteryNumberID = t.LotteryNumberID
    JOIN Prize p ON p.DrawID = n.DrawID AND p.WinningNumber = n.TicketNumber
    JOIN \`User\` u ON u.UserID = t.UserID WHERE n.DrawID = ?`;
  const [[total]] = await db().execute(`SELECT COUNT(*) AS total ${from}`, [drawId]);
  const [items] = await db().query(`SELECT t.TicketID AS ticketId, t.UserID AS userId, u.Name AS name,
    n.TicketNumber AS ticketNumber, p.PrizeType AS prizeType, p.PrizeAmount AS prizeAmount
    ${from} ORDER BY t.TicketID LIMIT ? OFFSET ?`, [drawId, pagination.pageSize, pagination.offset]);
  list(res, items, pagination, total.total);
}


async function customers(req, res) {
  const pagination = page(req.query);
  const [[total]] = await db().execute("SELECT COUNT(*) AS total FROM `User` WHERE Role = 'Customer'");
  const [items] = await db().query(`SELECT UserID AS userId, Name AS name, Phone AS phone,
    Email AS email, AccountStatus AS accountStatus FROM \`User\` WHERE Role = 'Customer'
    ORDER BY UserID LIMIT ? OFFSET ?`, [pagination.pageSize, pagination.offset]);
  list(res, items, pagination, total.total);
}

async function deactivateCustomer(req, res) {
  fields(req.body, []);
  const customerId = id(req.params.customerId, 'customerId');
  const [rows] = await db().execute('SELECT UserID, Role FROM `User` WHERE UserID = ?', [customerId]);
  if (!rows.length || rows[0].Role !== 'Customer') fail(404, 'NOT_FOUND', 'Customer not found.');

  await db().execute("UPDATE `User` SET AccountStatus = 'Deactivated' WHERE UserID = ? AND Role = 'Customer'", [customerId]);
  res.json({ data: { userId: customerId, accountStatus: 'Deactivated' } });
}

module.exports = { initialize, initialization, close, generate, dashboard, winners,
  customers, deactivateCustomer };
