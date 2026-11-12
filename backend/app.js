const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const dotenv = require('dotenv');
const { notFound, errorHandler } = require('./middleware/error-handler');

// Absolute paths make startup independent of the terminal folder.
const projectRoot = path.resolve(__dirname, '..');
const environment = dotenv.config({
  path: path.join(projectRoot, '.env'),
  quiet: true,
});

if (environment.error && environment.error.code !== 'ENOENT') {
  throw new Error('Cannot read the project-root .env file. Check its permissions.');
}

const app = express();
app.disable('x-powered-by');
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
app.use(express.json());

const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

app.get('/api/health', (req, res) => {
  res.json({ data: { status: 'ok' } });
});

// Private handlers use the session identity and apply record ownership checks.
const { sessions } = require('./middleware/session');
const { requireLogin, requireRole } = require('./middleware/auth');
const { requireCsrf } = require('./middleware/csrf');
app.use('/api/admin', sessions, requireLogin, requireRole('Admin'), requireCsrf);
app.use('/api/developer', sessions, requireLogin, requireRole('Developer'));
app.use('/api/me', sessions, requireLogin, requireRole('Customer'), requireCsrf);
app.use('/api/checkout', sessions, requireLogin, requireRole('Customer'), requireCsrf);
app.use('/api/draws', require('./routes/draws'));
app.get('/api/pricing', (req, res) => res.json({ data: { unitPrice: '100.00', maxCopiesPerCheckout: 100 } }));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/developer', require('./routes/developer'));
app.use('/api/me', require('./routes/me'));
app.use('/api/checkout', require('./routes/checkout'));

// Unmatched API paths return JSON errors before frontend serving.
app.use('/api', notFound);
const frontendBuild = path.join(projectRoot, 'frontend', 'dist');
app.use(express.static(frontendBuild));

// React Router needs the same HTML when opening or refreshing a known UI page.
// Only known page routes use the HTML fallback; missing assets remain 404.
const frontendRoutes = [
  '/', '/results', '/login', '/register', '/profile', '/buy-lottery', '/cart',
  '/checkout', '/admin', '/admin/draw', '/admin/live-draw', '/developer',
];
app.get(frontendRoutes, (req, res, next) => {
  const index = path.join(frontendBuild, 'index.html');
  if (!fs.existsSync(index)) {
    if (req.path === '/') {
      return res.type('text').send('LOTTO backend is running. Check /api/health.');
    }
    return next();
  }
  res.sendFile(index);
});

app.use(notFound);
app.use(errorHandler);

// Direct execution starts the server; importing exports the app without listening.
if (require.main === module) {
  const configuredPort = process.env.PORT ?? '3000';
  const port = Number(configuredPort);

  if (!/^\d+$/.test(configuredPort) || !Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('Cannot start LOTTO: PORT must be a whole number from 1 to 65535.');
    process.exitCode = 1;
  } else {
    const server = app.listen(port);

    server.on('listening', () => {
      console.log(`LOTTO server running at http://localhost:${port}`);
      // Database credentials enable the monthly background check; static startup is independent.
      if (process.env.DB_USER && process.env.DB_PASSWORD !== undefined) {
        const stopSalesCloser = require('./utils/close-sales').startSalesCloser();
        server.once('close', stopSalesCloser);
      }
    });

    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        console.error(`Cannot start LOTTO: port ${port} is already in use. Choose another PORT.`);
      } else {
        console.error('Cannot start LOTTO: unable to listen on the configured port.');
      }
      process.exitCode = 1;
    });
  }
}

module.exports = app;
