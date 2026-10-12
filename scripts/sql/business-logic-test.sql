-- Business-logic audit regressions (2026-10-12). One transaction, rolled back.
-- Each block is a real-world scenario that was wrong before migrations 030–032.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000bb001', 'bl-owner@bl.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@bl.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000bb001', id from public.roles where key = 'owner';

create temp table fx (k text primary key, v uuid) on commit drop;
grant all on fx to authenticated;
create or replace function pg_temp.g(key text) returns uuid language sql as $$ select v from fx where k = key $$;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'OK %', label;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000bb001","role":"authenticated"}', true);

with c as (insert into public.customers (full_name) values ('BL A') returning id) insert into fx select 'a', id from c;
with c as (insert into public.customers (full_name) values ('BL B') returning id) insert into fx select 'b', id from c;
insert into fx select 'svc', id from public.catalog_items where name = 'Other charge';

-- 1) bill-wide discount: full return works and refunds what was paid
with i as (insert into public.invoices (customer_id, invoice_discount, discount_reason) values (pg_temp.g('a'), 200, 'loyal') returning id) insert into fx select 'd1', id from i;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) values (pg_temp.g('d1'), pg_temp.g('svc'), 1, 1000);
select public.checkout_invoice(pg_temp.g('d1'), '[{"method":"cash","amount":800}]', null, 'bl-d1');
select public.return_items(pg_temp.g('d1'), jsonb_build_array(jsonb_build_object('invoice_item_id', (select id from public.invoice_items where invoice_id = pg_temp.g('d1')), 'qty', 1)), 'changed mind', 'cash', 'bl-d1r');
select pg_temp.check((select returned_amount = 800 and amount_paid = 0 and balance = 0 from public.invoices where id = pg_temp.g('d1')),
  'full return on a discounted bill: credited Rs. 800 (what was paid), not blocked');

-- 2) bill-wide discount: returning one of two items refunds its fair share
with i as (insert into public.invoices (customer_id, invoice_discount, discount_reason) values (pg_temp.g('a'), 200, 'loyal') returning id) insert into fx select 'd2', id from i;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price, sort_order) values (pg_temp.g('d2'), pg_temp.g('svc'), 1, 1000, 1), (pg_temp.g('d2'), pg_temp.g('svc'), 1, 1000, 2);
select public.checkout_invoice(pg_temp.g('d2'), '[{"method":"cash","amount":1800}]', null, 'bl-d2');
select public.return_items(pg_temp.g('d2'), jsonb_build_array(jsonb_build_object('invoice_item_id', (select id from public.invoice_items where invoice_id = pg_temp.g('d2') and sort_order = 1), 'qty', 1)), 'one back', 'cash', 'bl-d2r');
select pg_temp.check((select sum(amount) = 900 from public.payments where kind = 'refund' and idempotency_key like 'bl-d2r%'),
  'returning 1 of 2 items on a Rs. 200-discount bill refunds Rs. 900, not Rs. 1,000');
select public.return_items(pg_temp.g('d2'), jsonb_build_array(jsonb_build_object('invoice_item_id', (select id from public.invoice_items where invoice_id = pg_temp.g('d2') and sort_order = 2), 'qty', 1)), 'other back', 'cash', 'bl-d2r2');
select pg_temp.check((select returned_amount = total and amount_paid = 0 from public.invoices where id = pg_temp.g('d2')),
  'returning the rest: total refunded = Rs. 1,800 exactly (no rounding leak)');

-- 3) refund without a return is visible in Data checks
with i as (insert into public.invoices (customer_id) values (pg_temp.g('b')) returning id) insert into fx select 'r', id from i;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) values (pg_temp.g('r'), pg_temp.g('svc'), 1, 1000);
select public.checkout_invoice(pg_temp.g('r'), '[{"method":"cash","amount":1000}]', null, 'bl-r');
select public.refund_payment(pg_temp.g('r'), 300, 'cash', 'goodwill', 'bl-rr');
select pg_temp.check((select (x->>'count')::int >= 1 from jsonb_array_elements(public.report_data_quality()) x where x->>'key' = 'balance_no_promise'),
  'Data checks flag a bill left owing with no promised date');

-- 4) merging customers moves their tasks, messages and reminder tracks
with t as (insert into public.tasks (title, customer_id) values ('call B', pg_temp.g('b')) returning id) insert into fx select 'task', id from t;
with m as (insert into public.messages (customer_id, channel, body, created_by) values (pg_temp.g('b'), 'whatsapp', 'hi', '00000000-0000-0000-0000-0000000bb001') returning id) insert into fx select 'msg', id from m;
select public.merge_customers(pg_temp.g('b'), pg_temp.g('a'), 'same person');
select pg_temp.check((select customer_id = pg_temp.g('a') from public.tasks where id = pg_temp.g('task'))
  and (select customer_id = pg_temp.g('a') from public.messages where id = pg_temp.g('msg')), 'merge moves tasks and messages to the kept customer');

-- 5) voiding a vaccination reopens the reminder it closed
with p as (insert into public.pets (name, species_id) select 'BL Pet', id from public.species order by sort_order limit 1 returning id) insert into fx select 'pet', id from p;
insert into public.pet_owners (pet_id, customer_id, is_primary) values (pg_temp.g('pet'), pg_temp.g('a'), true);
insert into fx select 'vx', id from public.vaccines order by name limit 1;
with d as (insert into public.due_items (pet_id, kind, title, due_on, vaccine_id) values (pg_temp.g('pet'), 'vaccination', 'Dose 2', private.clinic_today() + 5, pg_temp.g('vx')) returning id) insert into fx select 'due', id from d;
with v as (insert into public.vaccinations (pet_id, vaccine_id, vaccine_name) values (pg_temp.g('pet'), pg_temp.g('vx'), 'X') returning id) insert into fx select 'vac', id from v;
select pg_temp.check((select status = 'done' from public.due_items where id = pg_temp.g('due')), 'recording the dose closes the reminder');
update public.vaccinations set voided_at = now(), void_reason = 'wrong pet' where id = pg_temp.g('vac');
select pg_temp.check((select status = 'pending' and completed_at is null from public.due_items where id = pg_temp.g('due')), 'voiding it reopens the reminder');

-- 6) appointment check-in for a pet already in today's queue reuses that visit
with v as (insert into public.visits (pet_id, customer_id, reason) values (pg_temp.g('pet'), pg_temp.g('a'), 'walked in early') returning id) insert into fx select 'visit', id from v;
with a as (insert into public.appointments (customer_id, pet_id, appointment_type_id, starts_at, ends_at)
  select pg_temp.g('a'), pg_temp.g('pet'), id, now() + interval '1 hour', now() + interval '75 min' from public.appointment_types limit 1 returning id) insert into fx select 'appt', id from a;
select pg_temp.check(public.check_in_appointment(pg_temp.g('appt')) = pg_temp.g('visit'), 'appointment check-in links to the existing visit');
select pg_temp.check((select count(*) = 1 from public.visits where pet_id = pg_temp.g('pet') and visit_date = private.clinic_today() and status not in ('completed','cancelled')),
  'still one open visit (one token, one bill)');

-- 7) cash on delivery: no payment reminder until delivered
with i as (insert into public.catalog_items (kind, name, unit, sale_price, is_retail) values ('product', 'BL Food', 'bag', 1000, true) returning id) insert into fx select 'food', id from i;
insert into fx select 'cod', public.pos_checkout('bl-cod', pg_temp.g('a'), null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('food'), 'quantity', 1)),
  '[]', 0, null, jsonb_build_object('promised_date', private.clinic_today(), 'reason', 'Cash on delivery'), '{"address":"House 1"}');
reset role;
select private.run_reminders() is not null;
select pg_temp.check(not exists (select 1 from public.messages m join public.dues d on d.id = m.source_id where d.invoice_id = pg_temp.g('cod')),
  'no "payment due" message while the order is out for delivery');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000bb001","role":"authenticated"}', true);
select public.update_delivery(pg_temp.g('cod'), 'delivered');
reset role;
select private.run_reminders() is not null;
select pg_temp.check(exists (select 1 from public.messages m join public.dues d on d.id = m.source_id where d.invoice_id = pg_temp.g('cod')),
  'payment reminder starts once delivered and still unpaid');

select 'ALL BUSINESS-LOGIC CHECKS PASSED' as result;
rollback;
