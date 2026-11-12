const path = require('node:path');
const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

// Root settings also support direct pool/script use without importing app.js.
const environment = dotenv.config({
  path: path.resolve(__dirname, '..', '.env'),
  quiet: true,
});
if (environment.error && environment.error.code !== 'ENOENT') {
  throw new Error('Cannot read the project-root .env file. Check its permissions.');
}

const configuredPort = process.env.DB_PORT ?? '3306';
const port = Number(configuredPort);
if (!/^\d+$/.test(configuredPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('DB_PORT must be a whole number from 1 to 65535.');
}
if (!process.env.DB_USER || process.env.DB_PASSWORD === undefined) {
  throw new Error('Set DB_USER and DB_PASSWORD in the project-root .env file.');
}

// Controllers share this pool. Connections open only when a query is made.
const pool = mysql.createPool({
  host: process.env.DB_HOST ?? '127.0.0.1',
  port,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME ?? 'lotto',
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 10000,
  charset: 'utf8mb4',
  timezone: 'Z', // Stored UTC DATETIME values map to UTC JavaScript dates.
});

module.exports = pool;

// Direct execution checks the selected database without changing records.
if (require.main === module) {
  pool.query('SELECT DATABASE() AS databaseName')
    .then(([rows]) => console.log(`MySQL connection OK: ${rows[0].databaseName}`))
    .catch((error) => {
      console.error(`Cannot connect to MySQL (${error.code || 'UNKNOWN'}). Check the server, database and root .env settings.`);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
