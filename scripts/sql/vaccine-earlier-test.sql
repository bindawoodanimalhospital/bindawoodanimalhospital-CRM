-- Vaccines given earlier (before the CRM / elsewhere) and vaccines without batch details. Rolled back.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000ac101', 've-doc@ve.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@ve.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000ac101', id from public.roles where key = 'senior_doctor';
create temp table fx (k text primary key, v uuid) on commit drop;
grant all on fx to authenticated;
create or replace function pg_temp.g(key text) returns uuid language sql as $$ select v from fx where k = key $$;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'OK %', label;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000ac101","role":"authenticated"}', true);
with c as (insert into public.customers (full_name) values ('VE Owner') returning id) insert into fx select 'c', id from c;
with p as (insert into public.pets (name, species_id) select 'VE Cat', id from public.species where name = 'Cat' returning id) insert into fx select 'pet', id from p;
insert into public.pet_owners (pet_id, customer_id, is_primary) values (pg_temp.g('pet'), pg_temp.g('c'), true);
insert into fx select 'vac', id from public.vaccines where is_active order by name limit 1;

-- Given earlier, no visit, next dose already passed → the pet is overdue
insert into public.vaccinations (pet_id, visit_id, vaccine_id, vaccine_name, administered_at, administered_by, next_due_date, next_due_label, notes)
select pg_temp.g('pet'), null, pg_temp.g('vac'), name, (private.clinic_today() - 400 + time '12:00') at time zone 'Asia/Karachi', null,
       private.clinic_today() - 35, 'Yearly booster', 'Given earlier (before the CRM or elsewhere)' from public.vaccines where id = pg_temp.g('vac');
select pg_temp.check(exists (select 1 from public.due_items where pet_id = pg_temp.g('pet') and kind = 'vaccination' and status = 'pending' and due_on = private.clinic_today() - 35),
  'earlier vaccine saved without a visit; its overdue booster shows in Due & follow-ups');

-- Given today in a visit without batch / vial expiry → still saved
with v as (insert into public.visits (pet_id, customer_id) values (pg_temp.g('pet'), pg_temp.g('c')) returning id) insert into fx select 'visit', id from v;
insert into public.vaccinations (pet_id, visit_id, vaccine_id, vaccine_name, next_due_date)
select pg_temp.g('pet'), pg_temp.g('visit'), pg_temp.g('vac'), name, private.clinic_today() + 365 from public.vaccines where id = pg_temp.g('vac');
select pg_temp.check((select count(*) = 2 from public.vaccinations where pet_id = pg_temp.g('pet')), 'vaccine without batch / expiry saved');
select pg_temp.check(not exists (select 1 from public.due_items where pet_id = pg_temp.g('pet') and kind = 'vaccination' and status = 'pending' and due_on = private.clinic_today() - 35)
  and exists (select 1 from public.due_items where pet_id = pg_temp.g('pet') and kind = 'vaccination' and status = 'pending' and due_on = private.clinic_today() + 365),
  'today''s dose closes the overdue reminder and sets the next one');
reset role;
select 'ALL VACCINE-EARLIER CHECKS PASSED' as result;
rollback;
