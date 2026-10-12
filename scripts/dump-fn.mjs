// Dev helper: write live function / view definitions to files. Usage: node scripts/dump-fn.mjs outdir name1 name2 …
import { mkdirSync, writeFileSync } from 'node:fs';
import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config({ path: '.env.local' });
const [out, ...names] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
for (const n of names) {
  const r = await client.query(
    `select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname || '.' || p.proname = $1`, [n]);
  const v = r.rows.length ? null : await client.query(`select 'create or replace view ' || $1 || ' as ' || pg_get_viewdef($1::regclass) d`, [n]).catch(() => null);
  const rows = r.rows.length ? r.rows : v?.rows ?? [];
  writeFileSync(`${out}/${n}.sql`, rows.map((x) => x.d.replace(/\r\n/g, '\n')).join('\n\n'));
  console.log(n, rows.length);
}
await client.end();
