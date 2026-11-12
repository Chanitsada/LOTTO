// The SQL cutoff remains authoritative even if this timer stops or starts late.
async function closeExpiredSales() {
  await require('../db').execute(`UPDATE LotteryDraw SET SalesStarted = TRUE, DrawStatus = 'Closed'
    WHERE DrawStatus = 'Open' AND SalesCloseAt <= UTC_TIMESTAMP(6)`);
}

function startSalesCloser() {
  let running = false;
  let warned = false;
  async function tick() {
    if (running) return;
    running = true;
    try {
      await closeExpiredSales();
      await require('./monthly-draw').prepareCurrentDraw();
      warned = false;
    }
    catch {
      if (!warned) console.error('Monthly draw check failed. Check MySQL and the monthly-draw SQL update; checkout still enforces the cutoff.');
      warned = true;
    } finally { running = false; }
  }
  // The initial tick catches up on closure/monthly setup after downtime.
  tick();
  const timer = setInterval(tick, 30000);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { closeExpiredSales, startSalesCloser };
