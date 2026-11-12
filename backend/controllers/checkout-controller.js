const { validateCheckout } = require('../utils/checkout');
const { sqlError } = require('../utils/api');

async function checkout(req, res) {
  const input = validateCheckout(req.body);
  try {
    // sp_checkout owns payment, tickets, stock deduction and cart cleanup in one transaction.
    const [results] = await require('../db').execute('CALL sp_checkout(?, ?, ?)', [
      req.user.userId, input.drawId, JSON.stringify(input.items),
    ]);
    const receipt = results[0][0];
    res.status(201).json({ data: {
      paymentId: receipt.paymentId, drawId: receipt.drawId, amount: receipt.amount,
      paymentDate: receipt.paymentDate, tickets: results[1],
    } });
  } catch (error) { sqlError(error); }
}

module.exports = { checkout };
