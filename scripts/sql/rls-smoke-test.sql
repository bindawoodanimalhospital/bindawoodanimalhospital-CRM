-- Run inside a transaction that is rolled back. Verifies RLS + helpers.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'recep@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'stray@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000d', 'store@test.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email <> 'stray@test.local';
insert into public.staff_roles (staff_id, role_id)
select '00000000-0000-0000-0000-00000000000a'::uuid, id from public.roles where key = 'owner' union all
select '00000000-0000-0000-0000-00000000000b'::uuid, id from public.roles where key = 'reception' union all
select '00000000-0000-0000-0000-00000000000d'::uuid, id from public.roles where key = 'store_staff';

set local role authenticated;
-- reception creates a customer + pet
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}', true);
insert into public.customers (full_name, phone, area) values ('Ahmed Raza', '+923001234567', 'Johar Town');
insert into public.pets (name, species_id) select 'Tiger', id from public.species where name = 'Dog';
insert into public.pet_owners (pet_id, customer_id, is_primary)
  select p.id, c.id, true from public.pets p, public.customers c;
select 'reception sees customers' as t, count(*) from public.customers;
select 'search by 0300 phone' as t, kind, title, subtitle from public.global_search('0300 1234567');
select 'search fuzzy name' as t, kind, title from public.global_search('ahmad');
select 'dupe check' as t, full_name, reason, score from public.find_customer_duplicates('+923001234567', 'Ahmad Raza');
select 'reception audit rows visible' as t, count(*) from public.audit_logs;
do $$ begin
  perform public.merge_customers(gen_random_uuid(), gen_random_uuid(), 'x');
  raise exception 'merge should have failed';
exception when insufficient_privilege then raise notice 'OK reception cannot merge';
end $$;

-- stray sign-up sees nothing
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000c","role":"authenticated"}', true);
select 'stray customers' as t, count(*) from public.customers;
select 'stray staff' as t, count(*) from public.staff;
select 'stray roles' as t, count(*) from public.roles;
do $$ begin
  update public.staff set is_active = true where id = auth.uid();
  raise exception 'self-activation should have failed';
exception when insufficient_privilege then raise notice 'OK stray cannot self-activate';
end $$;

-- store staff can see customers but not clinical perms
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000d","role":"authenticated"}', true);
select 'store perms' as t, string_agg(p, ',') from public.my_permissions() p;

-- owner sees audit trail
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}', true);
select 'owner audit' as t, action, table_name, count(*) from public.audit_logs group by 1,2,3 order by 3;
select 'owner perms count' as t, count(*) from public.my_permissions();
do $$ begin
  delete from public.audit_logs;
  raise exception 'audit delete should fail';
exception when insufficient_privilege then raise notice 'OK audit log is append-only';
end $$;
-- owner merges a duplicate: pets move over, source is marked merged
insert into public.customers (full_name, phone) values ('Ahmad Raza', '+923331234567');
select public.merge_customers(
  (select id from public.customers where phone = '+923331234567'),
  (select id from public.customers where phone = '+923001234567'),
  'same person, registered twice');
select 'after merge' as t, full_name, status, (select count(*) from public.pet_owners po where po.customer_id = c.id) as pets
from public.customers c order by created_at;
rollback;
