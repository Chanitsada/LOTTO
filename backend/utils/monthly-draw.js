// Monthly creation requires the preceding month's published result.
// The optional connection lets SQL tests use a session clock without changing the server clock.
async function prepareCurrentDraw(connection) {
  const owned = !connection;
  connection ??= await require('../db').getConnection();
  try {
    const [[dates]] = await connection.execute(`SELECT
      DATE_FORMAT(LAST_DAY(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR))), '%Y-%m-%d') AS currentDate,
      DATE_FORMAT(LAST_DAY(DATE_SUB(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR)), INTERVAL 1 MONTH)), '%Y-%m-%d') AS previousDate,
      UTC_TIMESTAMP(6) < TIMESTAMP(LAST_DAY(DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 HOUR))), '10:00:00') AS beforeCutoff`);
    const [previous] = await connection.execute(`SELECT DrawID FROM LotteryDraw
      WHERE DrawDate = ? AND DrawStatus = 'Closed' AND ResultsPublishedAt IS NOT NULL
        AND ResultsPublishedAt <= UTC_TIMESTAMP(6) AND DrawAt <= UTC_TIMESTAMP(6)`, [dates.previousDate]);
    if (!previous.length) return;
    let [[draw]] = await connection.execute('SELECT DrawID, InitializationStatus, SalesStarted FROM LotteryDraw WHERE DrawDate = ?', [dates.currentDate]);
    if (draw?.InitializationStatus === 'Ready' && (draw.SalesStarted || !dates.beforeCutoff)) return;
    if (!draw) {
      try {
        await connection.execute(`INSERT INTO LotteryDraw (DrawDate, SalesCloseAt, DrawAt)
          VALUES (?, TIMESTAMP(?, '10:00:00'), TIMESTAMP(?, '11:00:00'))`,
        [dates.currentDate, dates.currentDate, dates.currentDate]);
      } catch (error) { if (error.code !== 'ER_DUP_ENTRY') throw error; }
      [[draw]] = await connection.execute('SELECT DrawID FROM LotteryDraw WHERE DrawDate = ?', [dates.currentDate]);
    }
    // The procedure locks the draw, initializes inventory and records first opening
    // atomically. Concurrent checks and later reruns cannot replenish sold stock.
    await connection.execute('CALL sp_initialize_draw(?)', [draw.DrawID]);
  } finally { if (owned) connection.release(); }
}

module.exports = { prepareCurrentDraw };
