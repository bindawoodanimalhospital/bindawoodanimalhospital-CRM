-- Deworming records and reminders (migrations 043–044). Rolled back.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000dd201', 'dw-doc@dw.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000dd202', 'dw-store@dw.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@dw.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000dd201', id from public.roles where key = 'senior_doctor';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000dd202', id from public.roles where key = 'store_staff';
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

with c as (insert into public.customers (full_name, preferred_language) values ('DW Owner', 'en') returning id) insert into fx select 'cust', id from c;
insert into public.customer_contacts (customer_id, phone) values (pg_temp.g('cust'), '+923001112299');
with p as (insert into public.pets (name, species_id) select 'DW Pup', id from public.species where name = 'Dog' returning id) insert into fx select 'pet', id from p;
insert into public.pet_owners (pet_id, customer_id, is_primary) values (pg_temp.g('pet'), pg_temp.g('cust'), true);
set local role authenticated;

-- Store staff can't record treatments
select pg_temp.as_('00000000-0000-0000-0000-0000000dd202');
do $$ begin
  begin
    insert into public.dewormings (pet_id, product) values (pg_temp.g('pet'), 'Drontal Plus');
    raise exception 'FAIL: store staff recorded a deworming';
  exception when insufficient_privilege then raise notice 'OK only clinical staff record deworming';
  end;
end $$;

-- Doctor records deworming → next reminder
select pg_temp.as_('00000000-0000-0000-0000-0000000dd201');
with d as (insert into public.dewormings (pet_id, product, dose, weight_kg, next_due_date)
  values (pg_temp.g('pet'), 'Drontal Plus', '1 tablet', 6.5, private.clinic_today() + 3) returning id) insert into fx select 'd1', id from d;
select pg_temp.check((select count(*) = 1 from public.due_items where pet_id = pg_temp.g('pet') and kind = 'deworming' and status = 'pending'
  and due_on = private.clinic_today() + 3), 'recording a deworming creates the next-dose reminder');

-- The reminder engine prepares the WhatsApp message (3 days before)
reset role;
select private.run_reminders() is not null;
select pg_temp.check(exists (select 1 from public.messages where customer_id = pg_temp.g('cust') and template_key = 'deworming_due' and status = 'to_send'
  and body like '%deworming is due%'), 'the reminder engine prepares a "deworming due" WhatsApp message 3 days before');
set local role authenticated;
select pg_temp.as_('00000000-0000-0000-0000-0000000dd201');

-- Giving the next dose closes the reminder and makes a new one
with d as (insert into public.dewormings (pet_id, product, next_due_date) values (pg_temp.g('pet'), 'Drontal Plus', private.clinic_today() + 90) returning id)
insert into fx select 'd2', id from d;
select pg_temp.check((select status = 'done' from public.due_items where source_id = pg_temp.g('d1')), 'the next dose closes the old reminder');
select pg_temp.check((select count(*) = 1 from public.due_items where pet_id = pg_temp.g('pet') and kind = 'deworming' and status = 'pending'
  and due_on = private.clinic_today() + 90), 'and the new reminder is 3 months away');

-- Entered by mistake → old reminder reopens
update public.dewormings set voided_at = now(), void_reason = 'wrong pet' where id = pg_temp.g('d2');
select pg_temp.check((select status = 'pending' from public.due_items where source_id = pg_temp.g('d1')), 'marking it a mistake reopens the previous reminder');
select pg_temp.check((select status = 'cancelled' from public.due_items where source_id = pg_temp.g('d2')), 'and cancels the one it created');
do $$ begin
  begin
    insert into public.dewormings (pet_id, product, next_due_date, given_at) values (pg_temp.g('pet'), 'X', private.clinic_today() - 1, now());
    raise exception 'FAIL: next date in the past accepted';
  exception when check_violation then raise notice 'OK the next due date must be after today';
  end;
end $$;
reset role;
select pg_temp.check((select count(*) = 2 from public.message_templates where key = 'deworming_due') and exists (select 1 from public.reminder_rules where key = 'deworming_due' and is_active),
  'deworming has its own message (English + Urdu) and reminder rule');
select 'ALL DEWORMING CHECKS PASSED' as result;
rollback;
