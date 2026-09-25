-- Phase 4 money & stock safety tests. One transaction, rolled back.
begin;

insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000000c1', 'owner4@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c4', 'recep4@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c5', 'store4@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%4@t.local';
insert into public.staff_roles (staff_id, role_id)
select u.id::uuid, r.id from (values ('00000000-0000-0000-0000-0000000000c1', 'owner'),
  ('00000000-0000-0000-0000-0000000000c4', 'reception'), ('00000000-0000-0000-0000-0000000000c5', 'store_staff')) u(id, key)
join public.roles r on r.key = u.key;

create temp table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to authenticated;
create or replace function pg_temp.act(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.g(key text) returns uuid language sql as $$ select v from ctx where k = key $$;
set local role authenticated;

-- ============================================================ setup (owner): price list, supplier, stock
select pg_temp.act('00000000-0000-0000-0000-0000000000c1');
update public.catalog_items set sale_price = 1000 where name = 'Consultation fee';
with i as (insert into public.catalog_items (kind, name, category, unit, sale_price, track_stock, is_retail, reorder_level)
  values ('product', 'Dog food 1kg', 'Food', 'bag', 1500, true, true, 5) returning id) insert into ctx select 'food', id from i;
with s as (insert into public.suppliers (name, phone) values ('Test Pharma', '03001112223') returning id) insert into ctx select 'sup', id from s;
with p as (insert into public.purchases (supplier_id, supplier_invoice_no) values (pg_temp.g('sup'), 'INV-77') returning id) insert into ctx select 'po', id from p;
insert into public.purchase_lines (purchase_id, item_id, location_id, batch_no, expiry_date, qty, unit_cost)
select pg_temp.g('po'), pg_temp.g('food'), id, 'A', current_date + 30, 5, 1000 from public.inventory_locations where name = 'Pet store';
insert into public.purchase_lines (purchase_id, item_id, location_id, batch_no, expiry_date, qty, unit_cost)
select pg_temp.g('po'), pg_temp.g('food'), id, 'B', current_date + 200, 10, 1100 from public.inventory_locations where name = 'Pet store';
select public.receive_purchase(pg_temp.g('po'));
select 'stock after receiving' as t, usable_qty from public.stock_levels where item_id = pg_temp.g('food');
select 'purchase total' as t, total from public.purchases where id = pg_temp.g('po');

do $$ begin
  update public.product_batches set qty_on_hand = 999 where item_id = pg_temp.g('food');
  raise exception 'FAIL: stock edited directly';
exception when insufficient_privilege then raise notice 'OK stock changes only through movements';
end $$;
do $$ begin
  insert into public.purchase_lines (purchase_id, item_id, location_id, qty, unit_cost)
  select pg_temp.g('po'), pg_temp.g('food'), id, 1, 1 from public.inventory_locations limit 1;
  raise exception 'FAIL: line added to received purchase';
exception when insufficient_privilege then raise notice 'OK received purchase is locked';
end $$;
-- An expired batch that must never be sold
insert into public.product_batches (item_id, location_id, batch_no, expiry_date)
select pg_temp.g('food'), id, 'OLD', current_date - 1 from public.inventory_locations where name = 'Pet store';
insert into ctx select 'oldbatch', id from public.product_batches where batch_no = 'OLD' and item_id = pg_temp.g('food');
select public.adjust_stock(pg_temp.g('oldbatch'), 3, 'adjust', 'Found on shelf');
insert into ctx select 'batchB', id from public.product_batches where batch_no = 'B' and item_id = pg_temp.g('food');

-- ============================================================ reception: clinic bill
select pg_temp.act('00000000-0000-0000-0000-0000000000c4');
with c as (insert into public.customers (full_name, phone) values ('Billing Owner', '+923334445566') returning id) insert into ctx select 'cust', id from c;
select 'reception sees costs' as t, (select count(*) from public.batch_costs) as batch_costs, (select count(*) from public.catalog_costs) as item_costs;

with i as (insert into public.invoices (customer_id) values (pg_temp.g('cust')) returning id) insert into ctx select 'inv', id from i;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price)
select pg_temp.g('inv'), id, 1, 1 from public.catalog_items where name = 'Consultation fee';       -- tries Rs. 1
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) values (pg_temp.g('inv'), pg_temp.g('food'), 2, 0);
select 'draft total (price list enforced)' as t, subtotal, total from public.invoices where id = pg_temp.g('inv');

do $$ begin
  update public.invoice_items set discount_amount = 500 where invoice_id = pg_temp.g('inv') and kind = 'service';
  raise exception 'FAIL: reception gave a discount';
exception when insufficient_privilege then raise notice 'OK reception cannot give discounts';
end $$;
do $$ begin
  update public.invoices set status = 'issued', amount_paid = 4000 where id = pg_temp.g('inv');
  raise exception 'FAIL: invoice marked paid directly';
exception when insufficient_privilege then raise notice 'OK invoices can''t be issued/paid by direct edit';
end $$;
do $$ begin
  perform public.checkout_invoice(pg_temp.g('inv'), '[{"method":"cash","amount":1000}]', null, 'k-inv-1');
  raise exception 'FAIL: partial payment without a due';
exception when others then raise notice 'OK unpaid balance needs a promised date & reason (%)', left(sqlerrm, 50);
end $$;
select public.checkout_invoice(pg_temp.g('inv'), '[{"method":"cash","amount":1000}]',
  jsonb_build_object('promised_date', current_date + 7, 'reason', 'Will pay on salary day'), 'k-inv-1') is not null as issued;
select public.checkout_invoice(pg_temp.g('inv'), '[{"method":"cash","amount":1000}]',
  jsonb_build_object('promised_date', current_date + 7, 'reason', 'Will pay on salary day'), 'k-inv-1') is not null as double_submit;
select 'after checkout' as t, number is not null as numbered, total, amount_paid, balance,
  (select count(*) from public.payments where customer_id = pg_temp.g('cust')) as payments,
  (select status || '/' || approval_status from public.dues where invoice_id = pg_temp.g('inv')) as due
from public.invoices where id = pg_temp.g('inv');
select 'FEFO took from batch A' as t, b.batch_no, -m.qty as qty from public.inventory_movements m join public.product_batches b on b.id = m.batch_id
where m.ref_table = 'invoice_items' and m.kind = 'dispense';

do $$ begin
  update public.invoice_items set quantity = 1 where invoice_id = pg_temp.g('inv');
  raise exception 'FAIL: issued line edited';
exception when others then raise notice 'OK issued invoice lines are locked';
end $$;
do $$ begin
  delete from public.invoices where id = pg_temp.g('inv');
  if found then raise exception 'FAIL: issued invoice deleted'; end if;
  raise notice 'OK issued invoice cannot be deleted';
exception when insufficient_privilege then raise notice 'OK issued invoice cannot be deleted';
end $$;
do $$ begin
  perform public.record_payment(pg_temp.g('cust'), 3000, 'jazzcash', 'k-pay-1');
  raise exception 'FAIL: wallet payment without reference';
exception when others then raise notice 'OK JazzCash needs a transaction reference';
end $$;
select public.record_payment(pg_temp.g('cust'), 3000, 'jazzcash', 'k-pay-2', null, 'TX998877') is not null;
select public.record_payment(pg_temp.g('cust'), 3000, 'jazzcash', 'k-pay-2', null, 'TX998877') is not null;   -- double submit
select 'paid off → due closed' as t, balance, (select status from public.dues where invoice_id = pg_temp.g('inv')) as due,
  (select count(*) from public.payments where customer_id = pg_temp.g('cust')) as payments
from public.invoices where id = pg_temp.g('inv');
do $$ begin
  perform public.void_invoice(pg_temp.g('inv'), 'test');
  raise exception 'FAIL: reception voided';
exception when insufficient_privilege then raise notice 'OK reception cannot void invoices';
end $$;
select 'reception sees expenses' as t, count(*) from public.expenses;

-- Big due → needs manager approval
with i as (insert into public.invoices (customer_id) values (pg_temp.g('cust')) returning id) insert into ctx select 'inv2', id from i;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) values (pg_temp.g('inv2'), pg_temp.g('food'), 5, 0);
select public.checkout_invoice(pg_temp.g('inv2'), '[]', jsonb_build_object('promised_date', current_date + 3, 'reason', 'Owner forgot wallet'), 'k-inv-2') is not null;
select 'big due flagged' as t, original_amount, approval_status from public.dues where invoice_id = pg_temp.g('inv2');
select public.update_due_promise((select id from public.dues where invoice_id = pg_temp.g('inv2')), current_date + 10, 'Owner called, will come Friday');
select 'promise history kept' as t, count(*) from public.due_promises where due_id = (select id from public.dues where invoice_id = pg_temp.g('inv2'));
do $$ begin
  perform public.write_off_due((select id from public.dues where invoice_id = pg_temp.g('inv2')), 'bad debt', 'k-wo');
  raise exception 'FAIL: reception wrote off';
exception when insufficient_privilege then raise notice 'OK only a manager can write off';
end $$;

-- ============================================================ store staff: POS
select pg_temp.act('00000000-0000-0000-0000-0000000000c5');
do $$ begin
  perform public.pos_checkout('k-pos-0', null, null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('food'), 'quantity', 50)), '[{"method":"cash","amount":75000}]');
  raise exception 'FAIL: sold more than stock';
exception when others then raise notice 'OK cannot sell more than is in stock (%)', left(sqlerrm, 45);
end $$;
do $$ begin
  perform public.pos_checkout('k-pos-1', null, null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('food'), 'quantity', 1, 'batch_id', pg_temp.g('oldbatch'))), '[{"method":"cash","amount":1500}]');
  raise exception 'FAIL: sold expired stock';
exception when others then raise notice 'OK expired batch can never be sold';
end $$;
do $$ begin
  perform public.pos_checkout('k-pos-2', null, null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('food'), 'quantity', 1, 'batch_id', pg_temp.g('batchB'))), '[{"method":"cash","amount":1500}]');
  raise exception 'FAIL: skipped FEFO without reason';
exception when others then raise notice 'OK picking a later-expiry batch needs a reason';
end $$;
do $$ begin
  perform public.pos_checkout('k-pos-3', null, null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('food'), 'quantity', 1)), '[{"method":"cash","amount":500}]');
  raise exception 'FAIL: walk-in left unpaid';
exception when others then raise notice 'OK walk-in sale must be paid in full';
end $$;
do $$ begin
  perform public.pos_checkout('k-pos-4', null, null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('food'), 'quantity', 1, 'discount_amount', 200)), '[{"method":"cash","amount":1300}]');
  raise exception 'FAIL: store staff discounted';
exception when insufficient_privilege then raise notice 'OK store staff cannot discount';
end $$;
with s as (select public.pos_checkout('k-pos-5', null, null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('food'), 'quantity', 1)), '[{"method":"cash","amount":1500}]') id)
insert into ctx select 'sale', id from s;
select 'double tap Pay → same sale' as t, public.pos_checkout('k-pos-5', null, null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('food'), 'quantity', 1)), '[{"method":"cash","amount":1500}]') = pg_temp.g('sale') as same;
select 'store sale' as t, kind, total, balance from public.invoices where id = pg_temp.g('sale');
select 'store sees clinic bills' as t, count(*) from public.invoices where kind = 'clinic';

-- ============================================================ owner: returns, refunds, voids, write-off, approval
select pg_temp.act('00000000-0000-0000-0000-0000000000c1');
select public.pos_checkout('k-pos-6', null, null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('food'), 'quantity', 1, 'batch_id', pg_temp.g('batchB'), 'batch_override_reason', 'Customer wants later expiry')), '[{"method":"cash","amount":1500}]') is not null as fefo_override_with_reason;
select public.return_items(pg_temp.g('sale'), jsonb_build_array(jsonb_build_object('invoice_item_id', (select id from public.invoice_items where invoice_id = pg_temp.g('sale')), 'qty', 1)), 'Bag torn', 'cash', 'k-ret-1') is not null;
select public.return_items(pg_temp.g('sale'), jsonb_build_array(jsonb_build_object('invoice_item_id', (select id from public.invoice_items where invoice_id = pg_temp.g('sale')), 'qty', 1)), 'Bag torn', 'cash', 'k-ret-1') is not null as double_return_ignored;
select 'after return' as t, total, returned_amount, amount_paid, balance from public.invoices where id = pg_temp.g('sale');

select public.approve_due((select id from public.dues where invoice_id = pg_temp.g('inv2')), true, 'Regular client');
select public.write_off_due((select id from public.dues where invoice_id = pg_temp.g('inv2')), 'Agreed by owner', 'k-wo-2');
select 'written off' as t, d.status, i.balance from public.dues d join public.invoices i on i.id = d.invoice_id where d.invoice_id = pg_temp.g('inv2');

do $$ begin
  perform public.void_invoice(pg_temp.g('inv'), 'Wrong customer');
  raise exception 'FAIL: voided a paid invoice';
exception when others then raise notice 'OK paid invoice must be refunded before voiding';
end $$;
select public.refund_payment(pg_temp.g('inv'), 4000, 'cash', 'Billed wrong customer', 'k-ref-1') is not null;
select public.void_invoice(pg_temp.g('inv'), 'Billed wrong customer');
select 'void restored stock' as t, (select usable_qty from public.stock_levels where item_id = pg_temp.g('food')) as usable_now;

insert into public.expenses (category_id, amount, method, description) select id, 45000, 'bank', 'September rent' from public.expense_categories where name = 'Rent';
update public.expenses set amount = 1 where description = 'September rent';
select 'expense not editable' as t, amount from public.expenses where description = 'September rent';

select 'ledger balance (customer)' as t, balance from public.customer_balances where customer_id = pg_temp.g('cust');
select 'stock reconciles' as t,
  (select sum(qty_on_hand) from public.product_batches where item_id = pg_temp.g('food')) as on_hand,
  (select sum(qty) from public.inventory_movements where item_id = pg_temp.g('food')) as movements_sum;
rollback;
