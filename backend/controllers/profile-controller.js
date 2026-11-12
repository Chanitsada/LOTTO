const { fail, fields } = require('../utils/api');
const db = () => require('../db');

const profileSql = `SELECT UserID AS userId, Name AS name, Phone AS phone, Email AS email FROM \`User\` WHERE UserID = ?`;

// Column identifiers come only from this allowlist; submitted values use placeholders.
const columns = { name: ['Name', 100], phone: ['Phone', 20] };

async function readProfile(userId) {
  const [rows] = await db().execute(profileSql, [userId]);
  if (!rows.length) fail(404, 'NOT_FOUND', 'Account not found.');
  return rows[0];
}

async function getProfile(req, res) {
  res.json({ data: await readProfile(req.user.userId) });
}

async function updateProfile(req, res) {
  const body = fields(req.body, Object.keys(columns));
  const keys = Object.keys(body);
  if (!keys.length) fail(400, 'VALIDATION_ERROR', 'Send name, phone or both.');

  const assignments = [];
  const values = [];
  for (const key of keys) {
    const [column, max] = columns[key];
    const value = typeof body[key] === 'string' ? body[key].trim() : '';
    if (!value || [...value].length > max) {
      fail(400, 'VALIDATION_ERROR', `${key} must contain 1 to ${max} characters.`);
    }
    assignments.push(`${column} = ?`);
    values.push(value);
  }

  // The account always comes from the session, never from the request body.
  await db().execute(`UPDATE \`User\` SET ${assignments.join(', ')} WHERE UserID = ?`,
    [...values, req.user.userId]);
  res.json({ data: await readProfile(req.user.userId) });
}

module.exports = { getProfile, updateProfile };
