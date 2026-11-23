-- Billing a deworming / vaccine records it on the pet with a reminder (migration 059). Rolled back.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000bd101', 'bt-recep@bt.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000bd102', 'bt-owner@bt.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@bt.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000bd101', id from public.roles where key = 'reception';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000bd102', id from public.roles where key = 'owner';
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
select pg_temp.as_('00000000-0000-0000-0000-0000000bd101');

with c as (insert into public.customers (full_name) values ('BT Owner') returning id) insert into fx select 'c', id from c;
-- a 10-week-old kitten
with p as (insert into public.pets (name, species_id, date_of_birth) select 'BT Kitten', id, private.clinic_today() - 70 from public.species where name = 'Cat' returning id) insert into fx select 'kit', id from p;
-- an adult cat with unknown age
with p as (insert into public.pets (name, species_id) select 'BT Adult', id from public.species where name = 'Cat' returning id) insert into fx select 'adult', id from p;
insert into public.pet_owners (pet_id, customer_id, is_primary) values (pg_temp.g('kit'), pg_temp.g('c'), true), (pg_temp.g('adult'), pg_temp.g('c'), true);
select pg_temp.check((select is_deworming from public.catalog_items where name = 'Deworming (Praferan)'), 'deworming price-list items are marked');
insert into fx select 'vacitem', id from public.catalog_items where vaccine_id is not null and is_active order by name limit 1;

-- Kitten visit: deworming + vaccine billed, nothing recorded on the visit tab
with v as (insert into public.visits (pet_id, customer_id) values (pg_temp.g('kit'), pg_temp.g('c')) returning id) insert into fx select 'kv', id from v;
with i as (insert into public.invoices (customer_id, pet_id, visit_id) values (pg_temp.g('c'), pg_temp.g('kit'), pg_temp.g('kv')) returning id) insert into fx select 'kb', id from i;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) select pg_temp.g('kb'), id, 1, 600 from public.catalog_items where name = 'Deworming (Praferan)';
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) select pg_temp.g('kb'), pg_temp.g('vacitem'), 1, 1500;
select public.checkout_invoice(pg_temp.g('kb'), '[]', jsonb_build_object('reason', 'Pay later'), 'bt-1');
select pg_temp.check((select product = 'Praferan' and next_due_date = private.clinic_today() + 14 and visit_id = pg_temp.g('kv')
  from public.dewormings where pet_id = pg_temp.g('kit')), 'billed deworming is on the kitten''s profile, next due in 2 weeks (under 12 weeks old)');
select pg_temp.check(exists (select 1 from public.due_items where pet_id = pg_temp.g('kit') and kind = 'deworming' and status = 'pending' and due_on = private.clinic_today() + 14),
  '…and the deworming reminder is set');
select pg_temp.check((select next_due_date = private.clinic_today() + 21 from public.vaccinations where pet_id = pg_temp.g('kit')),
  'billed vaccine recorded too, next dose in 3 weeks for a kitten');

-- Adult cat: deworming already recorded by the doctor on the visit → billing doesn't add a second one
with v as (insert into public.visits (pet_id, customer_id) values (pg_temp.g('adult'), pg_temp.g('c')) returning id) insert into fx select 'av', id from v;
select pg_temp.as_('00000000-0000-0000-0000-0000000bd102');
insert into public.dewormings (pet_id, visit_id, product, next_due_date) values (pg_temp.g('adult'), pg_temp.g('av'), 'Drontal Cat', private.clinic_today() + 90);
select pg_temp.as_('00000000-0000-0000-0000-0000000bd101');
with i as (insert into public.invoices (customer_id, pet_id, visit_id) values (pg_temp.g('c'), pg_temp.g('adult'), pg_temp.g('av')) returning id) insert into fx select 'ab', id from i;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) select pg_temp.g('ab'), id, 1, 950 from public.catalog_items where name = 'Deworming (Drontal Cat)';
select public.checkout_invoice(pg_temp.g('ab'), '[{"method":"cash","amount":950}]', null, 'bt-2');
select pg_temp.check((select count(*) = 1 from public.dewormings where pet_id = pg_temp.g('adult')), 'no duplicate when the doctor already recorded it');

-- Voiding the kitten's bill voids what it recorded
select pg_temp.as_('00000000-0000-0000-0000-0000000bd102');
select public.void_invoice(pg_temp.g('kb'), 'Entered on the wrong pet');
select pg_temp.check((select voided_at is not null from public.dewormings where pet_id = pg_temp.g('kit'))
  and (select voided_at is not null from public.vaccinations where pet_id = pg_temp.g('kit')), 'voiding the bill voids the records it created');
reset role;
select 'ALL BILL-TREATMENTS CHECKS PASSED' as result;
rollback;
