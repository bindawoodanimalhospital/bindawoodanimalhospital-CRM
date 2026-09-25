// Applies supabase/migrations/*.sql in order, each in its own transaction.
// History is kept in supabase_migrations.schema_migrations (same table the Supabase CLI uses).
// Usage: npm run db:migrate            (reads DATABASE_URL from .env.local)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: '.env.local', quiet: true });
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL missing in .env.local');

const dir = join(process.cwd(), 'supabase', 'migrations');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
await client.query(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (
    version text primary key, statements text[], name text);`);

const applied = new Set((await client.query('select version from supabase_migrations.schema_migrations')).rows.map((r) => r.version));
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
let count = 0;
for (const file of files) {
  const [version, ...rest] = file.replace(/\.sql$/, '').split('_');
  if (applied.has(version)) continue;
  const sql = readFileSync(join(dir, file), 'utf8');
  process.stdout.write(`→ ${file} ... `);
  try {
    await client.query('begin');
    await client.query(sql);
    await client.query('insert into supabase_migrations.schema_migrations (version, name, statements) values ($1, $2, $3)',
      [version, rest.join('_'), [sql]]);
    await client.query('commit');
    console.log('ok');
    count++;
  } catch (e) {
    await client.query('rollback');
    console.log('FAILED');
    console.error(e.message, e.position ? `(at char ${e.position})` : '', e.where ?? '');
    process.exitCode = 1;
    break;
  }
}
console.log(count ? `${count} migration(s) applied.` : 'Database is up to date.');
await client.end();
