-- Cancelling pet-store / delivery orders (migration 042). Rolled back.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000cc101', 'cx-owner@cx.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000cc102', 'cx-store@cx.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@cx.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000cc101', id from public.roles where key = 'owner';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000cc102', id from public.roles where key = 'store_staff';
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
create or replace function pg_temp.qty(item uuid) returns numeric language sql as $$
  select coalesce(sum(qty_on_hand), 0) from public.product_batches where item_id = item $$;
set local role authenticated;

-- setup (owner): a tracked store product with 10 in stock, a customer
select pg_temp.as_('00000000-0000-0000-0000-0000000cc101');
with i as (insert into public.catalog_items (kind, name, unit, sale_price, is_retail) values ('product', 'CX Litter 10L', 'bag', 1000, true) returning id) insert into fx select 'item', id from i;
select public.add_stock(pg_temp.g('item'), 10);
with c as (insert into public.customers (full_name, house_no) values ('CX Buyer', '5') returning id) insert into fx select 'cust', id from c;

-- 1) Paid delivery (JazzCash), cancelled by store staff with no reason
select pg_temp.as_('00000000-0000-0000-0000-0000000cc102');
insert into fx select 'paid', public.pos_checkout('cx-1', pg_temp.g('cust'), null,
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('item'), 'quantity', 2)),
  '[{"method":"jazzcash","amount":2050,"reference":"TX-1"}]', 0, null, null, '{"address":"House 5","charge":50}');
select pg_temp.check(pg_temp.qty(pg_temp.g('item')) = 8, 'the order took 2 bags (8 left)');
select public.cancel_order(pg_temp.g('paid'));
select pg_temp.check((select status = 'void' and void_reason = 'Cancelled: Order cancelled' from public.invoices where id = pg_temp.g('paid')),
  'store staff cancel a delivery order without typing a reason ("Order cancelled")');
select pg_temp.check(pg_temp.qty(pg_temp.g('item')) = 10, 'the 2 bags go back on the shelf');
select pg_temp.check((select count(*) = 1 from public.payments where kind = 'refund' and method = 'jazzcash' and amount = 2050 and idempotency_key = 'cancel-' || pg_temp.g('paid')),
  'the Rs. 2,050 JazzCash payment is refunded to JazzCash');
select public.cancel_order(pg_temp.g('paid'));
select pg_temp.check((select count(*) = 1 from public.payments where idempotency_key = 'cancel-' || pg_temp.g('paid')), 'cancelling twice changes nothing');

-- 2) Cash-on-delivery order (unpaid) with a reason: the unpaid balance is closed
insert into fx select 'cod', public.pos_checkout('cx-2', pg_temp.g('cust'), null,
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('item'), 'quantity', 1)), '[]', 0, null,
  jsonb_build_object('promised_date', private.clinic_today(), 'reason', 'Cash on delivery'), '{"address":"House 5","charge":50}');
select public.cancel_order(pg_temp.g('cod'), 'Customer not home, cancelled on phone');
select pg_temp.check((select void_reason = 'Cancelled: Customer not home, cancelled on phone' from public.invoices where id = pg_temp.g('cod')), 'the reason is kept when given');
select pg_temp.check(not exists (select 1 from public.dues where invoice_id = pg_temp.g('cod') and status = 'open'), 'the unpaid balance of a cancelled COD order is closed');

-- 3) Delivered order: store staff can't cancel it, the owner can
insert into fx select 'deliv', public.pos_checkout('cx-3', pg_temp.g('cust'), null,
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('item'), 'quantity', 1)), '[{"method":"cash","amount":1050}]', 0, null, null, '{"address":"House 5","charge":50}');
select public.update_delivery(pg_temp.g('deliv'), 'delivered');
do $$ begin
  begin perform public.cancel_order(pg_temp.g('deliv')); raise exception 'FAIL: store staff cancelled a delivered order';
  exception when insufficient_privilege then raise notice 'OK store staff cannot cancel a delivered order (use a return)'; end;
end $$;
select pg_temp.as_('00000000-0000-0000-0000-0000000cc101');
select public.cancel_order(pg_temp.g('deliv'), 'Wrong item delivered', 'cash');
select pg_temp.check((select status = 'void' from public.invoices where id = pg_temp.g('deliv')), 'the owner can cancel a delivered order');

-- 4) In-store sale made today: store staff can cancel it
select pg_temp.as_('00000000-0000-0000-0000-0000000cc102');
insert into fx select 'counter', public.pos_checkout('cx-4', null, null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('item'), 'quantity', 1)), '[{"method":"cash","amount":1000}]');
select public.cancel_order(pg_temp.g('counter'), 'Changed mind');
select pg_temp.check((select status = 'void' from public.invoices where id = pg_temp.g('counter')), 'a counter sale from today can be cancelled');
select pg_temp.check(pg_temp.qty(pg_temp.g('item')) = 10, 'stock is back to 10 after all cancellations');

-- 5) Clinic bills are not cancelled this way, and everything is logged
select pg_temp.as_('00000000-0000-0000-0000-0000000cc101');
with i as (insert into public.invoices (customer_id) values (pg_temp.g('cust')) returning id) insert into fx select 'clinic', id from i;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) select pg_temp.g('clinic'), id, 1, 500 from public.catalog_items where name = 'Other charge';
select public.checkout_invoice(pg_temp.g('clinic'), '[{"method":"cash","amount":500}]', null, 'cx-clinic');
do $$ begin
  begin perform public.cancel_order(pg_temp.g('clinic')); raise exception 'FAIL: clinic bill cancelled as an order';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK clinic bills keep using Void'; end;
end $$;
reset role;
select pg_temp.check((select count(*) = 4 from public.audit_logs where action = 'order.cancelled' and record_id in
  (pg_temp.g('paid')::text, pg_temp.g('cod')::text, pg_temp.g('deliv')::text, pg_temp.g('counter')::text)), 'each cancellation is in the activity log with its reason');
select 'ALL CANCEL CHECKS PASSED' as result;
rollback;
