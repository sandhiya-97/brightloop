require('dotenv').config();
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; copy .env.example to .env and set your PostgreSQL password.');
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY, checksum TEXT, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
    await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT');
    const filename='schema.sql';
    const sql=await fs.readFile(path.join(__dirname,'../../database/schema.sql'),'utf8');
    const checksum=crypto.createHash('sha256').update(sql).digest('hex');
    const found=await client.query('SELECT checksum FROM schema_migrations WHERE filename=$1',[filename]);
    if(found.rowCount&&found.rows[0].checksum===checksum){console.log(`${filename} is already at the current checksum.`);return;}
    await client.query(sql);
    if(found.rowCount){
      await client.query('UPDATE schema_migrations SET checksum=$1,applied_at=NOW() WHERE filename=$2',[checksum,filename]);
      console.log(`Updated ${filename} to its current checksum.`);
    } else {
      await client.query('INSERT INTO schema_migrations(filename,checksum) VALUES($1,$2)',[filename,checksum]);
      console.log(`Applied ${filename}.`);
    }
  } finally { await client.end(); }
}
main().catch((error)=>{console.error('Migration failed:',error.message);process.exitCode=1;});
