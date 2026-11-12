const { fields, fail } = require('./api');

function validateCheckout(body) {
  fields(body, ['drawId', 'items'], ['drawId', 'items']);
  if (!Number.isInteger(body.drawId) || body.drawId < 1 || body.drawId > 2147483647 ||
      !Array.isArray(body.items) || !body.items.length || body.items.length > 100) {
    fail(400, 'VALIDATION_ERROR', 'Supply a drawId and 1-100 number selections.');
  }
  let copies = 0;
  for (const item of body.items) {
    fields(item, ['lotteryNumberId', 'quantity'], ['lotteryNumberId', 'quantity']);
    if (!Number.isInteger(item.lotteryNumberId) || item.lotteryNumberId < 1 || item.lotteryNumberId > 2147483647 ||
        !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 5) {
      fail(400, 'VALIDATION_ERROR', 'Each number needs an integer ID and 1-5 copies.');
    }
    copies += item.quantity;
  }
  if (copies > 100 || new Set(body.items.map(item => item.lotteryNumberId)).size !== body.items.length) {
    fail(400, 'VALIDATION_ERROR', 'Use distinct number IDs and at most 100 copies.');
  }
  return { drawId: body.drawId, items: body.items.map(item => ({ ...item })) };
}

module.exports = { validateCheckout };
