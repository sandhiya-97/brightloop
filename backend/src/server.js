require('dotenv').config();
const app = require('./app');
const db = require('./config/db');
const { startBillingJob } = require('./jobs/billingJob');

if (!process.env.DATABASE_URL) console.warn('DATABASE_URL is not set; API routes needing data will fail until .env is configured.');
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith('replace-with-')) {
  throw new Error('JWT_SECRET must be a non-placeholder random value of at least 32 characters.');
}
const port = Number(process.env.PORT || 4000);
let stopBillingJob;
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Brightloop API listening on http://localhost:${port}`);
  if (process.env.DATABASE_URL) stopBillingJob = startBillingJob();
});

async function shutdown(signal) {
  console.log(`${signal} received; closing API and PostgreSQL pool`);
  stopBillingJob?.();
  server.close(async () => {
    try { await db.close(); process.exit(0); }
    catch (error) { console.error(error); process.exit(1); }
  });
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
