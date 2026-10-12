-- Owners' phone numbers and email are private to staff with customers.contact (Owner by default). Rolled back.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000ee001', 'cp-owner@cp.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000ee002', 'cp-recep@cp.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000ee003', 'cp-doc@cp.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@cp.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000ee001', id from public.roles where key = 'owner';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000ee002', id from public.roles where key = 'reception';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000ee003', id from public.roles where key = 'senior_doctor';
create temp table fx (k text primary key, v uuid) on commit drop;
grant all on fx to authenticated;
create or replace function pg_temp.g(key text) returns uuid language sql as $$ select v from fx where k = key $$;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'OK %', label;
end $$;
create or replace function pg_temp.as_(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;

-- Reception registers an owner without any number (phone is optional now)
select pg_temp.as_('00000000-0000-0000-0000-0000000ee002');
with c as (insert into public.customers (full_name, area) values ('CP Sana Tariq', 'Gulberg') returning id) insert into fx select 'c', id from c;
select pg_temp.check(pg_temp.g('c') is not null, 'reception can register an owner with no phone number');
do $$ begin
  begin
    insert into public.customer_contacts (customer_id, phone) values (pg_temp.g('c'), '+923001239876');
    raise exception 'FAIL: reception added a phone number';
  exception when insufficient_privilege then raise notice 'OK reception cannot add a phone number';
  end;
end $$;

-- Owner adds the number
select pg_temp.as_('00000000-0000-0000-0000-0000000ee001');
insert into public.customer_contacts (customer_id, phone, whatsapp, email) values (pg_temp.g('c'), '+923001239876', '+923001239876', 'sana@example.com');
select pg_temp.check((select phone = '+923001239876' from public.customer_contacts where customer_id = pg_temp.g('c')), 'owner adds and sees the number');
update public.customer_contacts set alt_phone = '+923214440000' where customer_id = pg_temp.g('c');
select pg_temp.check((select alt_phone is not null from public.customer_contacts where customer_id = pg_temp.g('c')), 'owner can update it');
select pg_temp.check(exists (select 1 from public.smart_search('9876') where kind = 'customer' and id = pg_temp.g('c') and subtitle like '%+923001239876%'),
  'owner finds by the last digits and sees the number in search');
select pg_temp.check(exists (select 1 from public.smart_search('sana@example.com') where id = pg_temp.g('c')), 'owner finds by email');
select pg_temp.check((select phone from public.find_customer_duplicates('+923001239876', null) where id = pg_temp.g('c')) = '+923001239876',
  'owner duplicate check matches the number');

-- Reception: nothing about the number is visible
select pg_temp.as_('00000000-0000-0000-0000-0000000ee002');
select pg_temp.check((select count(*) from public.customer_contacts) = 0, 'reception cannot read any contact row');
update public.customer_contacts set phone = '+923000000000' where customer_id = pg_temp.g('c');
delete from public.customer_contacts where customer_id = pg_temp.g('c');
select pg_temp.check(not exists (select 1 from public.customers where search_text like '%923%' or search_text like '%sana@%'),
  'owner record keeps no number or email in its search text');
select pg_temp.check(exists (select 1 from public.smart_search('0300 1239876') where id = pg_temp.g('c')), 'reception finds the owner by the complete number…');
select pg_temp.check(not exists (select 1 from public.smart_search('0300 1239876') where subtitle ~ '[0-9]{4}'), '…but the number is not shown');
select pg_temp.check(not exists (select 1 from public.smart_search('9876') where id = pg_temp.g('c')), 'reception cannot fish with part of a number');
select pg_temp.check(not exists (select 1 from public.smart_search('sana@example.com') where id = pg_temp.g('c')), 'reception cannot search by email');
select pg_temp.check(not exists (select 1 from public.find_customer_duplicates('+923001239876', null) where phone is not null),
  'reception duplicate check never returns a number');
select pg_temp.check(not exists (select 1 from public.customers c where c.id = pg_temp.g('c') and to_jsonb(c)::text ~ '1239876'),
  'the owner row itself holds no number');

-- Doctors are the same as reception
select pg_temp.as_('00000000-0000-0000-0000-0000000ee003');
select pg_temp.check((select count(*) from public.customer_contacts) = 0, 'doctor cannot read contact rows');

-- Owner check: the attempted reception edit and delete did nothing
select pg_temp.as_('00000000-0000-0000-0000-0000000ee001');
select pg_temp.check((select phone = '+923001239876' from public.customer_contacts where customer_id = pg_temp.g('c')), 'reception edit / delete had no effect');

-- Messages never store a number
with m as (insert into public.messages (customer_id, channel, body, to_phone, created_by)
  values (pg_temp.g('c'), 'whatsapp', 'hi', '+923001239876', '00000000-0000-0000-0000-0000000ee001') returning id) insert into fx select 'm', id from m;
select pg_temp.check((select to_phone is null from public.messages where id = pg_temp.g('m')), 'a message never keeps the phone number');

-- The owner can give the permission to another role, and take it back
reset role;
insert into public.role_permissions (role_id, permission_key) select id, 'customers.contact' from public.roles where key = 'reception';
set local role authenticated;
select pg_temp.as_('00000000-0000-0000-0000-0000000ee002');
select pg_temp.check((select count(*) from public.customer_contacts where customer_id = pg_temp.g('c')) = 1, 'granting the permission lets reception see numbers');
reset role;
delete from public.role_permissions where permission_key = 'customers.contact' and role_id = (select id from public.roles where key = 'reception');
set local role authenticated;
select pg_temp.as_('00000000-0000-0000-0000-0000000ee002');
select pg_temp.check((select count(*) from public.customer_contacts) = 0, 'removing it hides them again');

-- Every change to a number is in the activity log
reset role;
select pg_temp.check((select count(*) >= 2 from public.audit_logs where table_name = 'customer_contacts' and record_id = pg_temp.g('c')::text),
  'adding and changing a number is recorded in the activity log');
select pg_temp.check((select array_agg(r.key order by r.key) = '{owner}' from public.role_permissions rp join public.roles r on r.id = rp.role_id
  where rp.permission_key = 'customers.contact'), 'by default only the Owner role has the permission');
-- Even if reception were allowed to read the activity log, number changes stay hidden
insert into public.role_permissions (role_id, permission_key) select id, 'audit.view' from public.roles where key = 'reception' on conflict do nothing;
set local role authenticated;
select pg_temp.as_('00000000-0000-0000-0000-0000000ee002');
select pg_temp.check(not exists (select 1 from public.audit_logs where table_name = 'customer_contacts'), 'activity-log entries about numbers stay hidden from others');
reset role;
select 'ALL CONTACT-PRIVACY CHECKS PASSED' as result;
rollback;
