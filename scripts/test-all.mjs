// Runs every SQL test in scripts/sql/tests (each one rolls itself back), then resets
// sequences the tests touched. Stops at the first failing file.
// Usage: npm run db:test
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = readdirSync('scripts/sql/tests').filter((f) => f.endsWith('.sql')).sort()
  .map((f) => `scripts/sql/tests/${f}`)
  .concat('scripts/sql/reset-empty-sequences.sql');

for (const f of files) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, ['scripts/run-sql.mjs', f], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`\nFAILED: ${f}`); process.exit(1); }
}
console.log(`\nAll ${files.length - 1} test files passed.`);
