-- Phase 5 reminder-engine tests. One transaction, rolled back.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'owner5@t.local',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d2', 'senior5@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d3', 'intern5@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d4', 'recep5@t.local',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d5', 'store5@t.local',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%5@t.local';
insert into public.staff_roles (staff_id, role_id)
select u.id::uuid, r.id from (values ('00000000-0000-0000-0000-0000000000d1', 'owner'), ('00000000-0000-0000-0000-0000000000d2', 'senior_doctor'),
  ('00000000-0000-0000-0000-0000000000d3', 'intern'), ('00000000-0000-0000-0000-0000000000d4', 'reception'), ('00000000-0000-0000-0000-0000000000d5', 'store_staff')) u(id, key)
join public.roles r on r.key = u.key;

create temp table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to authenticated;
create or replace function pg_temp.act(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.g(key text) returns uuid language sql as $$ select v from ctx where k = key $$;

-- ------------------------------------------------ setup as superuser (dates in the past need it)
with c as (insert into public.customers (full_name, phone, whatsapp, preferred_language) values ('Reminder Owner', '+923451112233', '+923451112233', 'en') returning id)
insert into ctx select 'cust', id from c;
with p as (insert into public.pets (name, species_id, date_of_birth) select 'Bravo', id, (current_date - interval '3 years')::date from public.species where name = 'Dog' returning id)
insert into ctx select 'pet', id from p;
insert into public.pet_owners (pet_id, customer_id, is_primary) values (pg_temp.g('pet'), pg_temp.g('cust'), true);
with d as (insert into public.due_items (pet_id, kind, title, due_on, assigned_to, vaccine_id)
  select pg_temp.g('pet'), 'vaccination', 'Rabies booster', current_date, '00000000-0000-0000-0000-0000000000d2', id from public.vaccines where name = 'Rabies' returning id)
insert into ctx select 'vacc', id from d;
with d as (insert into public.due_items (pet_id, kind, title, due_on) values (pg_temp.g('pet'), 'follow_up', 'Wound recheck', current_date - 5) returning id)
insert into ctx select 'fu', id from d;
with i as (insert into public.invoices (customer_id) values (pg_temp.g('cust')) returning id) insert into ctx select 'inv', id from i;
update public.catalog_items set sale_price = 1000 where name = 'Consultation fee';
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) select pg_temp.g('inv'), id, 2, 0 from public.catalog_items where name = 'Consultation fee';
select set_config('request.jwt.claims', json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);
select public.checkout_invoice(pg_temp.g('inv'), '[]', jsonb_build_object('promised_date', current_date, 'reason', 'Salary day'), 'rem-k1') is not null as billed;
update public.dues set promised_date = current_date - 7 where invoice_id = pg_temp.g('inv');     -- simulate a missed promise
insert into public.appointments (customer_id, pet_id, appointment_type_id, starts_at, ends_at)
select pg_temp.g('cust'), pg_temp.g('pet'), id, (current_date + 1 + time '11:00') at time zone 'Asia/Karachi', (current_date + 1 + time '11:15') at time zone 'Asia/Karachi'
from public.appointment_types where name = 'Consultation';
with t as (insert into public.tasks (title, assigned_to, due_at, created_by) values ('Call owner about lab report', '00000000-0000-0000-0000-0000000000d3', now() - interval '1 day', '00000000-0000-0000-0000-0000000000d1') returning id)
insert into ctx select 'task', id from t;

set local role authenticated;

-- ------------------------------------------------ run the engine (owner) — twice to prove idempotence
select pg_temp.act('00000000-0000-0000-0000-0000000000d1');
select 'engine run 1' as t, public.run_reminders_now() - 'ran_at' as result;
select 'engine run 2 (idempotent)' as t, public.run_reminders_now() - 'ran_at' as result;
select 'messages to send' as t, template_key, left(body, 60) as preview from public.messages where customer_id = pg_temp.g('cust') order by template_key;
select 'escalation levels' as t, rule_key, escalation_level from public.reminder_tracks where customer_id = pg_temp.g('cust') or rule_key = 'task_overdue' order by rule_key;
select 'owner notified of escalations' as t, count(*) from public.notifications where kind = 'escalation';

-- ------------------------------------------------ who sees what
select pg_temp.act('00000000-0000-0000-0000-0000000000d2');
select 'senior sees own alerts' as t, string_agg(kind, ',' order by kind) from public.notifications;
select pg_temp.act('00000000-0000-0000-0000-0000000000d3');
select 'intern sees own alerts' as t, string_agg(kind, ',' order by kind) from public.notifications;
select pg_temp.act('00000000-0000-0000-0000-0000000000d5');
select 'store sees' as t, (select count(*) from public.messages) as messages, (select count(*) from public.open_alerts) as alerts, (select count(*) from public.notifications) as inbox;
select pg_temp.act('00000000-0000-0000-0000-0000000000d4');
select 'reception alert centre' as t, string_agg(kind || ':' || severity, ', ' order by kind) from public.open_alerts where customer_id = pg_temp.g('cust') or kind = 'task';

-- ------------------------------------------------ outbox handling
do $$ begin
  perform public.mark_message((select id from public.messages where template_key = 'payment_due' limit 1), 'not_reached', null);
  raise exception 'FAIL: not reached without note';
exception when others then raise notice 'OK "not reached" needs a note';
end $$;
select public.mark_message((select id from public.messages where template_key = 'payment_due' limit 1), 'sent');
do $$ begin
  perform public.mark_message((select id from public.messages where template_key = 'payment_due' limit 1), 'sent');
  raise exception 'FAIL: marked twice';
exception when others then raise notice 'OK a message can only be marked once';
end $$;
do $$ begin
  perform public.pause_reminder((select id from public.reminder_tracks where rule_key = 'payment_due' and customer_id = pg_temp.g('cust')), current_date + 5, '');
  raise exception 'FAIL: paused without reason';
exception when others then raise notice 'OK pausing reminders needs a reason';
end $$;
select public.pause_reminder((select id from public.reminder_tracks where rule_key = 'payment_due' and customer_id = pg_temp.g('cust')), current_date + 5, 'Owner in hospital, will pay next week');

-- ------------------------------------------------ task rules
select pg_temp.act('00000000-0000-0000-0000-0000000000d3');
do $$ begin
  update public.tasks set due_at = now() + interval '3 days' where id = pg_temp.g('task');
  raise exception 'FAIL: assignee moved own deadline';
exception when insufficient_privilege then raise notice 'OK assignee can''t move the deadline';
end $$;
do $$ begin
  update public.tasks set status = 'done' where id = pg_temp.g('task');
  raise exception 'FAIL: done without outcome';
exception when check_violation then raise notice 'OK "done" needs an outcome';
end $$;
update public.tasks set status = 'done', outcome = 'Called — owner will come Saturday' where id = pg_temp.g('task');

-- ------------------------------------------------ resolving the source stops reminders
select pg_temp.act('00000000-0000-0000-0000-0000000000d2');
insert into public.vaccinations (pet_id, vaccine_id, vaccine_name, batch_no, expiry_date)
select pg_temp.g('pet'), id, name, 'R1', current_date + 300 from public.vaccines where name = 'Rabies';
select pg_temp.act('00000000-0000-0000-0000-0000000000d1');
select 'engine after work done' as t, public.run_reminders_now() - 'ran_at' as result;
select 'tracks closed' as t, rule_key, closed_at is not null as closed from public.reminder_tracks where rule_key in ('vaccination_due', 'task_overdue') and (customer_id = pg_temp.g('cust') or rule_key = 'task_overdue') order by rule_key;
select 'unsent vaccine message cancelled' as t, status from public.messages where template_key = 'vaccination_due' and customer_id = pg_temp.g('cust');

-- ------------------------------------------------ campaigns respect opt-in
select 'birthday audience (not opted in)' as t, count(*) from public.campaign_audience('birthdays_this_month') where customer_id = pg_temp.g('cust');
reset role;
update public.customers set marketing_opt_in = true where id = pg_temp.g('cust');
update public.pets set date_of_birth = make_date(2023, extract(month from current_date)::int, 1) where id = pg_temp.g('pet');
set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000000d1');
select 'birthday audience (opted in)' as t, count(*) from public.campaign_audience('birthdays_this_month') where customer_id = pg_temp.g('cust');
select pg_temp.act('00000000-0000-0000-0000-0000000000d4');
do $$ begin
  perform public.create_campaign('Birthdays', 'birthdays_this_month', 'pet_birthday');
  raise exception 'FAIL: reception ran a campaign';
exception when insufficient_privilege then raise notice 'OK only campaign managers can send promotions';
end $$;
rollback;
