// One-time bootstrap: creates (or promotes) the first Owner/Admin account.
// After this, add every other staff member from the app (Staff → Add staff).
//
// Usage:  npm run create-owner
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local.
import { createInterface } from 'node:readline';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local', quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY missing in .env.local');

const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
const ask = (q) => new Promise((res) => rl.question(q, res));
const askHidden = (q) =>
  new Promise((res) => {
    const write = rl._writeToOutput.bind(rl);
    rl._writeToOutput = (s) => write(s.startsWith(q) ? s : '*');
    rl.question(q, (a) => { rl._writeToOutput = write; process.stdout.write('\n'); res(a); });
  });

const email = (await ask('Owner email: ')).trim().toLowerCase();
const fullName = (await ask('Full name (e.g. Dr. Musab Bin Dawood): ')).trim();
const password = await askHidden('Password (min 8 chars, leave blank if the account already exists): ');
rl.close();

const admin = createClient(url, secret, { auth: { autoRefreshToken: false, persistSession: false } });

// Find or create the auth user.
let userId;
for (let page = 1; !userId; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) throw error;
  userId = data.users.find((u) => u.email?.toLowerCase() === email)?.id;
  if (data.users.length < 200) break;
}
if (!userId) {
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { full_name: fullName },
  });
  if (error) throw error;
  userId = data.user.id;
  console.log('✓ Login created');
} else {
  console.log('• Login already exists — promoting to Owner');
}

const { error: staffErr } = await admin.from('staff')
  .upsert({ id: userId, email, full_name: fullName, is_active: true, is_doctor: true });
if (staffErr) throw staffErr;

const { data: role, error: roleErr } = await admin.from('roles').select('id').eq('key', 'owner').single();
if (roleErr) throw roleErr;
const { error: grantErr } = await admin.from('staff_roles').upsert({ staff_id: userId, role_id: role.id });
if (grantErr) throw grantErr;

console.log(`✓ ${fullName || email} is now Owner / Admin. Sign in at http://localhost:3000/login`);
