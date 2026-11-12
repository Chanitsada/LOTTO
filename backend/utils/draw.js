const { randomInt } = require('node:crypto');
const { fail } = require('./api');

// MySQL selects the current month's actual row; prepared future rows stay hidden.
const currentMonthEndSql = 'LAST_DAY(DATE(DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 7 HOUR)))';
const currentDrawIdSql = `(SELECT current_draw.DrawID FROM LotteryDraw current_draw
  WHERE current_draw.DrawDate = ${currentMonthEndSql} LIMIT 1)`;
const publicDrawWhereSql = `(d.DrawID = ${currentDrawIdSql} OR (
  d.DrawDate >= LAST_DAY(DATE_SUB(${currentMonthEndSql}, INTERVAL 12 MONTH))
  AND d.DrawDate < ${currentMonthEndSql} AND d.ResultsPublishedAt IS NOT NULL
  AND d.ResultsPublishedAt <= UTC_TIMESTAMP(6) AND d.DrawAt <= UTC_TIMESTAMP(6)))`;
const drawColumns = `d.DrawID AS drawId, DATE_FORMAT(d.DrawDate, '%Y-%m-%d') AS drawDate,
  d.SalesCloseAt AS salesCloseAt, d.DrawAt AS drawAt, UTC_TIMESTAMP(6) AS serverNow,
  CASE WHEN d.SalesCloseAt <= UTC_TIMESTAMP(6) THEN 'Closed' ELSE d.DrawStatus END AS drawStatus,
  d.InitializationStatus AS initializationStatus, d.ResultsPublishedAt AS resultsPublishedAt,
  (d.ResultsPublishedAt IS NOT NULL AND d.ResultsPublishedAt <= UTC_TIMESTAMP(6)
    AND d.DrawAt <= UTC_TIMESTAMP(6)) AS published,
  (d.DrawID = ${currentDrawIdSql}) AS isCurrent,
  (d.DrawStatus = 'Open' AND d.DrawID = ${currentDrawIdSql}
    AND d.SalesCloseAt > UTC_TIMESTAMP(6) AND d.InitializationStatus = 'Ready'
    AND d.ResultsPublishedAt IS NULL AND
    (SELECT COUNT(*) = 13 AND SUM(p.PrizeType = '1st') = 1 AND SUM(p.PrizeType = '2nd') = 1
      AND SUM(p.PrizeType = '3rd') = 1 AND SUM(p.PrizeType = '4th') = 10
      AND SUM(p.WinningNumber IS NOT NULL) = 0 FROM Prize p WHERE p.DrawID = d.DrawID)) AS purchasable`;

function formatDraw(row) {
  return { ...row, published: Boolean(row.published), isCurrent: Boolean(row.isCurrent),
    purchasable: Boolean(row.purchasable), unitPrice: '100.00' };
}

async function getDraw(db, drawId, lock = false) {
  const [rows] = await db.execute(`SELECT ${drawColumns} FROM LotteryDraw d WHERE d.DrawID = ?${lock ? ' FOR UPDATE' : ''}`, [drawId]);
  if (!rows.length) fail(404, 'DRAW_NOT_FOUND', 'Draw not found.');
  return formatDraw(rows[0]);
}

function validPrizes(prizes, winners = false) {
  const amounts = { '1st': '6000000.00', '2nd': '200000.00', '3rd': '80000.00', '4th': '2000.00' };
  return prizes.length === 13 && ['1st', '2nd', '3rd', '4th'].every(tier =>
    prizes.filter(p => p.prizeType === tier).length === (tier === '4th' ? 10 : 1)) &&
    prizes.every(p => p.prizeAmount === amounts[p.prizeType] &&
      (winners ? /^\d{6}$/.test(p.winningNumber) : p.winningNumber === null)) &&
    (!winners || new Set(prizes.map(p => p.winningNumber)).size === 13);
}

// Cryptographic samples cover the full number pool; duplicates are rejected.
// This algorithm has no public commitment/reveal or replay proof.
function generateWinners(pick = randomInt) {
  const values = new Set();
  while (values.size < 13) values.add(String(pick(1000000)).padStart(6, '0'));
  return [...values];
}

async function prizesFor(db, drawId, lock = false) {
  const [prizes] = await db.execute(`SELECT PrizeID AS prizeId, PrizeType AS prizeType,
    PrizeAmount AS prizeAmount, WinningNumber AS winningNumber FROM Prize
    WHERE DrawID = ? ORDER BY FIELD(PrizeType, '1st', '2nd', '3rd', '4th'), PrizeID${lock ? ' FOR UPDATE' : ''}`, [drawId]);
  return prizes;
}

module.exports = { currentMonthEndSql, currentDrawIdSql, publicDrawWhereSql, drawColumns, formatDraw, getDraw, validPrizes, generateWinners, prizesFor };
