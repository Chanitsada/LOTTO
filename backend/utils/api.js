// Shared validation and safe errors for the feature controllers.
function fail(status, code, message) {
  throw Object.assign(new Error(message), { status, code, publicError: true });
}

function fields(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key)) ||
      required.some(key => !Object.hasOwn(value, key))) {
    fail(400, 'VALIDATION_ERROR', `Use only these fields: ${allowed.join(', ') || 'none'}.`);
  }
  return value;
}

function id(value, name = 'ID') {
  if ((typeof value !== 'number' && typeof value !== 'string') ||
      !/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) > 2147483647) {
    fail(400, 'VALIDATION_ERROR', `${name} must be a positive integer.`);
  }
  return Number(value);
}

function page(query, extra = []) {
  fields(query, ['page', 'pageSize', ...extra]);
  const current = query.page === undefined ? 1 : id(query.page, 'page');
  const size = query.pageSize === undefined ? 20 : id(query.pageSize, 'pageSize');
  if (size > 100) fail(400, 'VALIDATION_ERROR', 'pageSize cannot exceed 100.');
  return { page: current, pageSize: size, offset: (current - 1) * size };
}

function number(value) {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value)) {
    fail(400, 'VALIDATION_ERROR', 'ticketNumber must be a six-digit string.');
  }
  return value;
}

function drawDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(400, 'VALIDATION_ERROR', 'drawDate must be YYYY-MM-DD.');
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ||
      parsed.getUTCFullYear() < 2000 ||
      new Date(parsed.getTime() + 86400000).getUTCDate() !== 1) {
    fail(400, 'VALIDATION_ERROR', 'drawDate must be the last day of a month, year 2000 or later.');
  }
  return value;
}

function list(res, items, pagination, total) {
  return res.json({ data: { items }, meta: {
    page: pagination.page, pageSize: pagination.pageSize, totalItems: Number(total),
  } });
}

async function transaction(work) {
  const connection = await require('../db').getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// Only explicitly known stored-procedure messages become public errors.
const sqlErrors = {
  INVALID_INPUT: [400, 'Invalid request fields.'],
  FORBIDDEN: [403, 'Access is not allowed.'],
  ACCOUNT_DISABLED: [403, 'This account is deactivated.'],
  DRAW_NOT_FOUND: [404, 'Draw not found.'],
  TICKET_NOT_FOUND: [404, 'Ticket not found.'],
  DRAW_CLOSED: [409, 'Sales are closed.'],
  DRAW_NOT_CURRENT: [409, 'Only the current monthly draw can be purchased.'],
  DRAW_NOT_READY: [409, 'Draw inventory or prizes are not ready.'],
  INVALID_NUMBER: [409, 'A selected number does not belong to this draw.'],
  INSUFFICIENT_STOCK: [409, 'Not enough copies are available.'],
  CART_DRAW_CONFLICT: [409, 'Remove saved selections from the previous draw first.'],
  CART_CHANGED: [409, 'The saved quantity changed. Review the cart before paying.'],
  SEED_RESULT_EXISTS: [409, 'A draw with results cannot be initialized again.'],
  SEED_PRIZES_INVALID: [409, 'The prize configuration is invalid.'],
  SEED_PURCHASES_EXIST: [409, 'A draw with purchases cannot be initialized again.'],
  SEED_STOCK_INVALID: [409, 'Inventory quantities are invalid.'],
  SEED_INVENTORY_INCOMPLETE: [409, 'The draw inventory is incomplete.'],
};

function sqlError(error) {
  const known = error.sqlState === '45000' && sqlErrors[error.sqlMessage];
  if (known) fail(known[0], error.sqlMessage, known[1]);
  if (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT') {
    fail(409, 'PLEASE_RETRY', 'A concurrent change occurred. Review the cart and try again.');
  }
  throw error;
}

module.exports = { fail, fields, id, page, number, drawDate, list, transaction, sqlError };
