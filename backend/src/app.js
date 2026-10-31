const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { rateLimit } = require('express-rate-limit');
const routes = require('./routes');
const db = require('./config/db');
const { notFound, errorHandler } = require('./middleware/errors');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }));
app.get('/healthz', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ data: { status: 'ok', database: 'connected' } });
  } catch (_error) {
    res.status(503).json({ error: 'DATABASE_UNAVAILABLE', message: 'PostgreSQL is not connected; configure DATABASE_URL and run migrations.', field: null });
  }
});
app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);
module.exports = app;
