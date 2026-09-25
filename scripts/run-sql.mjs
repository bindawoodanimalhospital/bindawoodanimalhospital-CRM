// Runs a .sql file against DATABASE_URL and prints every result set + notices.
// Usage: node scripts/run-sql.mjs path/to/file.sql
import { readFileSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config({ path: '.env.local', quiet: true });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
client.on('notice', (n) => console.log('NOTICE:', n.message));
await client.connect();
try {
  const res = await client.query(readFileSync(process.argv[2], 'utf8'));
  for (const r of [res].flat()) if (r.rows?.length) console.table(r.rows);
} catch (e) { console.error('ERROR:', e.message); process.exitCode = 1; await client.query('rollback').catch(() => {}); }
await client.end();
