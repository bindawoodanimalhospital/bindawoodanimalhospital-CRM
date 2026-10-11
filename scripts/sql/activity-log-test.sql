-- Activity log covers sign-ins, page views, prints and every table (rolled back).
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000dd001', 'act@a.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000dd002', 'act-rec@a.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@a.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000dd001', id from public.roles where key = 'owner';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000dd002', id from public.roles where key = 'receptionist';
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'OK %', label;
end $$;

-- sign-in / sign-out
insert into auth.sessions (id, user_id, created_at, updated_at, user_agent, ip)
values ('00000000-0000-0000-0000-0000000dd0aa', '00000000-0000-0000-0000-0000000dd002', now(), now(), 'Mozilla/5.0 (Windows NT 10.0) Chrome/130', '39.45.1.2');
delete from auth.sessions where id = '00000000-0000-0000-0000-0000000dd0aa';
select pg_temp.check((select count(*) = 2 from public.audit_logs where record_id = '00000000-0000-0000-0000-0000000dd0aa'
  and actor_id = '00000000-0000-0000-0000-0000000dd002' and action in ('auth.sign_in', 'auth.sign_out') and context ->> 'ip' = '39.45.1.2'),
  'receptionist sign-in and sign-out logged with IP and device');

-- every table that holds business data has a change trigger
select pg_temp.check(not exists (
  select 1 from pg_tables t where t.schemaname = 'public'
     and t.tablename not in ('audit_logs', 'invoice_counters', 'visit_token_counters', 'notifications')
     and not exists (select 1 from information_schema.triggers g where g.event_object_schema = 'public'
                       and g.event_object_table = t.tablename and g.action_statement ilike '%audit_row%')),
  'every business table records its changes');

-- page views and prints (as the receptionist)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000dd002","role":"authenticated"}', true);
select public.log_activity('view', '/customers', 'Pet owners · Bin Dawood Animal Hospital');
select public.log_activity('view', '/customers', 'Pet owners · Bin Dawood Animal Hospital');
select public.log_activity('print', '/print/invoice/x', 'Bill');
select public.log_activity('view', 'https://evil.example', null);
select public.log_activity('call', '/customers/x', null, '{"to":"03001234567"}');
select public.log_activity('whatsapp', '/customers/x', null, '{"to":"923001234567"}');
select public.log_activity('search', '/dashboard', null, '{"q":"tiger","results":2,"opened":"Tiger"}');
select public.log_activity('idle', '/queue', null, null);
select public.log_activity('active', '/queue', null, '{"away_minutes":25}');
select public.log_activity('closed', '/queue', null, null);
select public.log_activity('denied', '/dashboard', null, '{"permission":"audit.view"}');
select public.log_activity('copy', '/customers/x', null, '{"chars":11}');
select public.log_activity('copy', '/customers/x', null, '{"chars":11}');
select public.log_activity('hack_the_planet', '/x', null, null);
-- a receptionist can write activity but cannot read or tamper with the log
select pg_temp.check((select count(*) = 0 from public.audit_logs), 'receptionist cannot read the log');
do $$ begin
  begin delete from public.audit_logs; raise exception 'FAIL: receptionist could delete log rows';
  exception when insufficient_privilege then raise notice 'OK receptionist cannot delete log rows'; end;
end $$;
-- the owner sees it
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000dd001","role":"authenticated"}', true);
select pg_temp.check((select count(*) = 1 from public.audit_logs where actor_id = '00000000-0000-0000-0000-0000000dd002' and action = 'page.view'),
  'page view logged once (repeat within 30 s ignored)');
select pg_temp.check((select count(*) = 1 from public.audit_logs where actor_id = '00000000-0000-0000-0000-0000000dd002' and action = 'page.print'),
  'print logged');
select pg_temp.check(not exists (select 1 from public.audit_logs where record_id like 'http%'), 'outside links are not logged');
select pg_temp.check((select count(*) = 8 from public.audit_logs where actor_id = '00000000-0000-0000-0000-0000000dd002'
  and action in ('contact.call','contact.whatsapp','search.used','session.idle','session.active','session.closed','access.denied','data.copied')),
  'calls, WhatsApp, searches, idle/back, tab closed, blocked page and copying are logged (copy repeat ignored)');
select pg_temp.check((select context ->> 'to' = '03001234567' from public.audit_logs where action = 'contact.call' and actor_id = '00000000-0000-0000-0000-0000000dd002'),
  'the number that was called is recorded');
select pg_temp.check(not exists (select 1 from public.audit_logs where record_id = '/x'), 'unknown kinds of action are ignored');
select pg_temp.check((select last_sign_in is not null from public.staff_last_seen() where staff_id = '00000000-0000-0000-0000-0000000dd002'),
  'owner sees when the receptionist last signed in');
-- minor changes are logged too (a weight)
with p as (insert into public.pets (name, species_id) select 'Act Pet', id from public.species order by sort_order limit 1 returning id)
insert into public.pet_weights (pet_id, weight_kg) select id, 4.2 from p;
select pg_temp.check(exists (select 1 from public.audit_logs where table_name = 'pet_weights' and action = 'insert'), 'a weight entry is logged');
reset role;
select 'ALL ACTIVITY-LOG CHECKS PASSED' as result;
rollback;
