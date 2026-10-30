-- Deworming & vaccines by disease group / track, date order, confirm step (migration 060). Rolled back.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000ce101', 'tr-doc@tr.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000ce102', 'tr-recep@tr.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@tr.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000ce101', id from public.roles where key = 'senior_doctor';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000ce102', id from public.roles where key = 'reception';
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
create or replace function pg_temp.at(days_ago int) returns timestamptz language sql as $$
  select (private.clinic_today() - days_ago + time '12:00') at time zone 'Asia/Karachi' $$;
create or replace function pg_temp.pending(pet uuid, k text) returns text language sql security definer as $$
  select coalesce(string_agg(array_to_string(groups, '+') || '@' || (due_on - private.clinic_today()), ' | ' order by due_on), '')
    from public.due_items where pet_id = pet and kind = k::public.due_kind and status = 'pending' $$;
set local role authenticated;
select pg_temp.as_('00000000-0000-0000-0000-0000000ce101');

with c as (insert into public.customers (full_name) values ('TR Owner') returning id) insert into fx select 'c', id from c;
with p as (insert into public.pets (name, species_id) select 'TR Cat', id from public.species where name = 'Cat' returning id) insert into fx select 'cat', id from p;
insert into public.pet_owners (pet_id, customer_id, is_primary) values (pg_temp.g('cat'), pg_temp.g('c'), true);
insert into fx select 'rabies', id from public.vaccines where name = 'Rabies';
insert into fx select 'pchr', id from public.vaccines where name ilike 'PCHR%';
insert into fx select 'pch', id from public.vaccines where name ilike 'PCH (%';

select pg_temp.check((select covers = '{cat_core,rabies}' from public.vaccines where id = pg_temp.g('pchr')), 'PCHR covers cat core + rabies');

-- 1) Disease groups: a combined vaccine closes the separate rabies reminder (no duplicates)
insert into public.vaccinations (pet_id, vaccine_id, vaccine_name, administered_at, next_due_date, next_due_label)
values (pg_temp.g('cat'), pg_temp.g('rabies'), 'Rabies', pg_temp.at(300), private.clinic_today() + 65, 'Rabies booster');
insert into public.vaccinations (pet_id, vaccine_id, vaccine_name, administered_at, next_due_date, next_due_label)
values (pg_temp.g('cat'), pg_temp.g('pch'), 'PCH', pg_temp.at(300), private.clinic_today() + 65, 'PCH booster');
select pg_temp.check(pg_temp.pending(pg_temp.g('cat'), 'vaccination') = 'rabies@65 | cat_core@65', 'two reminders: rabies and cat core');
insert into public.vaccinations (pet_id, vaccine_id, vaccine_name, administered_at, next_due_date, next_due_label)
values (pg_temp.g('cat'), pg_temp.g('pchr'), 'PCHR', pg_temp.at(0), private.clinic_today() + 365, 'Yearly booster');
select pg_temp.check(pg_temp.pending(pg_temp.g('cat'), 'vaccination') = 'cat_core+rabies@365', 'PCHR today closes both, one reminder for both a year later');

-- 2) Date order: an older history entry doesn't move the current reminder
insert into public.vaccinations (pet_id, vaccine_id, vaccine_name, administered_at, next_due_date, next_due_label)
values (pg_temp.g('cat'), pg_temp.g('rabies'), 'Rabies', pg_temp.at(700), private.clinic_today() - 335, 'Old booster');
select pg_temp.check(pg_temp.pending(pg_temp.g('cat'), 'vaccination') = 'cat_core+rabies@365', 'adding a 2-year-old rabies record leaves today''s reminder alone');

-- 3) Deworming tracks: internal worms and fleas/ticks are separate
insert into fx select 'praferan', id from public.dewormers where name = 'Praferan';
with d as (insert into public.dewormers (name, tracks, covers, adult_interval_days) values ('TR Spot-on', '{external}', '{fleas,ticks}', 30) returning id) insert into fx select 'spot', id from d;
with d as (insert into public.dewormers (name, tracks, covers, adult_interval_days) values ('TR Combo', '{internal,external}', '{roundworm,fleas}', 30) returning id) insert into fx select 'combo', id from d;
insert into public.dewormings (pet_id, product, dewormer_id, tracks, given_at, next_due_date) values (pg_temp.g('cat'), 'Praferan', pg_temp.g('praferan'), '{internal}', pg_temp.at(0), private.clinic_today() + 90);
insert into public.dewormings (pet_id, product, dewormer_id, tracks, given_at, next_due_date) values (pg_temp.g('cat'), 'TR Spot-on', pg_temp.g('spot'), '{external}', pg_temp.at(0), private.clinic_today() + 30);
select pg_temp.check(pg_temp.pending(pg_temp.g('cat'), 'deworming') = 'external@30 | internal@90', 'worm tablet and flea/tick product keep separate reminders');
insert into public.dewormings (pet_id, product, dewormer_id, tracks, given_at, next_due_date) values (pg_temp.g('cat'), 'TR Combo', pg_temp.g('combo'), '{internal,external}', pg_temp.at(0) + interval '1 hour', private.clinic_today() + 31);
select pg_temp.check(pg_temp.pending(pg_temp.g('cat'), 'deworming') = 'internal@31 | external@31', 'a combined product closes both and resets both');
insert into public.dewormings (pet_id, product, tracks, given_at, next_due_date) values (pg_temp.g('cat'), 'Old tablet', '{internal}', pg_temp.at(400), private.clinic_today() - 310);
select pg_temp.check(pg_temp.pending(pg_temp.g('cat'), 'deworming') = 'internal@31 | external@31', 'an old deworming from history changes nothing');

-- 4) Bills: recorded "to confirm" with the linked product; doctor confirms or marks not given
with p as (insert into public.pets (name, species_id) select 'TR Cat 2', id from public.species where name = 'Cat' returning id) insert into fx select 'cat2', id from p;
insert into public.pet_owners (pet_id, customer_id, is_primary) values (pg_temp.g('cat2'), pg_temp.g('c'), true);
with v as (insert into public.visits (pet_id, customer_id, doctor_id) values (pg_temp.g('cat2'), pg_temp.g('c'), '00000000-0000-0000-0000-0000000ce101') returning id) insert into fx select 'v', id from v;
select pg_temp.as_('00000000-0000-0000-0000-0000000ce102');
with i as (insert into public.invoices (customer_id, pet_id, visit_id) values (pg_temp.g('c'), pg_temp.g('cat2'), pg_temp.g('v')) returning id) insert into fx select 'bill', id from i;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) select pg_temp.g('bill'), id, 1, 600 from public.catalog_items where name = 'Deworming (Praferan)';
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) select pg_temp.g('bill'), id, 1, 1500 from public.catalog_items where vaccine_id = pg_temp.g('pchr') limit 1;
select public.checkout_invoice(pg_temp.g('bill'), '[]', jsonb_build_object('reason', 'later'), 'tr-bill');
select pg_temp.check((select not confirmed and dewormer_id = pg_temp.g('praferan') and product = 'Praferan' from public.dewormings where pet_id = pg_temp.g('cat2')),
  'billed deworming recorded as "to confirm" with the product linked to the price-list item');
select pg_temp.check(pg_temp.pending(pg_temp.g('cat2'), 'deworming') = 'internal@90', 'provisional reminder set so nobody is missed');
select pg_temp.as_('00000000-0000-0000-0000-0000000ce101');
select pg_temp.check(exists (select 1 from public.notifications where staff_id = '00000000-0000-0000-0000-0000000ce101' and kind = 'treatment_confirm'), 'the visit doctor is asked to confirm');
select pg_temp.as_('00000000-0000-0000-0000-0000000ce102');
do $$ begin
  perform public.confirm_treatment('deworming', (select id from public.dewormings where pet_id = pg_temp.g('cat2')));
  raise exception 'FAIL: reception confirmed';
exception when insufficient_privilege then raise notice 'OK only clinical staff confirm'; end $$;
select pg_temp.as_('00000000-0000-0000-0000-0000000ce101');
select public.confirm_treatment('deworming', (select id from public.dewormings where pet_id = pg_temp.g('cat2')));
select pg_temp.check((select confirmed and confirmed_by = '00000000-0000-0000-0000-0000000ce101' from public.dewormings where pet_id = pg_temp.g('cat2')), 'doctor confirms the deworming');
select public.treatment_not_given('vaccination', (select id from public.vaccinations where pet_id = pg_temp.g('cat2')), 'Owner refused');
select pg_temp.check((select voided_at is not null and void_reason = 'Not given — Owner refused' from public.vaccinations where pet_id = pg_temp.g('cat2'))
  and pg_temp.pending(pg_temp.g('cat2'), 'vaccination') = '', 'vaccine marked not given: removed from history and its reminder cancelled');
reset role;
select 'ALL TREATMENTS CHECKS PASSED' as result;
rollback;
