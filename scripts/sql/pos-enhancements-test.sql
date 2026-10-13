-- POS enhancements safety tests: address, home delivery & charge, service location, stock loans.
-- One transaction, rolled back. Every check prints "OK …"; any "FAIL" aborts the run.
begin;

insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'owner8@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e4', 'recep8@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e5', 'store8@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%8@t.local';
insert into public.staff_roles (staff_id, role_id)
select u.id::uuid, r.id from (values ('00000000-0000-0000-0000-0000000000e1', 'owner'),
  ('00000000-0000-0000-0000-0000000000e4', 'reception'), ('00000000-0000-0000-0000-0000000000e5', 'store_staff')) u(id, key)
join public.roles r on r.key = u.key;

create temp table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to authenticated;
create or replace function pg_temp.act(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.g(key text) returns uuid language sql as $$ select v from ctx where k = key $$;
create or replace function pg_temp.due_amount(inv uuid) returns numeric language sql security definer as $$
  select original_amount from public.dues where invoice_id = inv $$;   -- store staff can't read dues (RLS); tests can
create or replace function pg_temp.due_status(inv uuid) returns text language sql security definer as $$
  select status from public.dues where invoice_id = inv $$;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'OK %', label;
end $$;
set local role authenticated;

-- ============================================================ setup (owner): stock item, customer
select pg_temp.act('00000000-0000-0000-0000-0000000000e1');
with i as (insert into public.catalog_items (kind, name, category, unit, sale_price, track_stock, is_retail)
  values ('product', 'Cat litter 5kg', 'Litter', 'bag', 1000, true, true) returning id) insert into ctx select 'litter', id from i;
with s as (insert into public.suppliers (name) values ('Loan Test Supplier') returning id) insert into ctx select 'sup', id from s;
with p as (insert into public.purchases (supplier_id) values (pg_temp.g('sup')) returning id) insert into ctx select 'po', id from p;
insert into public.purchase_lines (purchase_id, item_id, location_id, batch_no, expiry_date, qty, unit_cost)
select pg_temp.g('po'), pg_temp.g('litter'), id, 'OWN', private.clinic_today() + 300, 20, 700 from public.inventory_locations where is_default;
select public.receive_purchase(pg_temp.g('po'));

-- §1 address
with c as (insert into public.customers (full_name, house_no, block, address, area)
  values ('Delivery Owner', '12', 'Block C', 'Street 4', 'DHA Phase 5') returning id) insert into ctx select 'cust', id from c;
select pg_temp.check(public.customer_address_line(pg_temp.g('cust')) = 'House 12, Block C, Street 4, DHA Phase 5, Lahore',
  'customer address line = house, block, full address, area, city');

-- system items are protected
do $$ begin
  update public.catalog_items set is_active = false where system_role = 'delivery_charge';
  raise exception 'FAIL: delivery charge item switched off';
exception when insufficient_privilege then raise notice 'OK system price-list items cannot be switched off';
end $$;
select pg_temp.check((select sale_price from public.catalog_items where system_role = 'delivery_charge') = 50, 'default delivery charge is Rs. 50 (from the price list)');

-- ============================================================ §2/§3 home delivery (store staff)
select pg_temp.act('00000000-0000-0000-0000-0000000000e5');
do $$ begin
  perform public.pos_checkout('k-d0', null, null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('litter'), 'quantity', 1)),
    '[{"method":"cash","amount":1050}]', 0, null, null, '{"address":"House 1"}');
  raise exception 'FAIL: delivery without customer';
exception when others then perform pg_temp.check(sqlerrm like '%choose the customer%', 'home delivery needs a customer'); end $$;
do $$ begin
  perform public.pos_checkout('k-d0b', pg_temp.g('cust'), null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('litter'), 'quantity', 1)),
    '[{"method":"cash","amount":1000}]', 0, null, null, '{"address":"House 1","charge":0}');
  raise exception 'FAIL: store staff waived delivery';
exception when insufficient_privilege then raise notice 'OK store staff cannot waive the delivery charge'; end $$;

-- Cash on delivery: nothing paid now, Rs. 120 charge for a far area
insert into ctx select 'cod', public.pos_checkout('k-cod', pg_temp.g('cust'), null,
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('litter'), 'quantity', 2)), '[]', 0, null,
  jsonb_build_object('promised_date', private.clinic_today(), 'reason', 'Cash on delivery'),
  jsonb_build_object('address', public.customer_address_line(pg_temp.g('cust')), 'charge', 120));
select pg_temp.check((select total = 2120 and balance = 2120 and fulfilment = 'home_delivery' and delivery_status = 'pending'
  from public.invoices where id = pg_temp.g('cod')), 'COD order: total = products + delivery, pending');
select pg_temp.check((select count(*) = 1 and sum(line_total) = 120 from public.invoice_items where invoice_id = pg_temp.g('cod') and line_role = 'delivery_charge'),
  'delivery charge is ONE separate line');
select pg_temp.check(pg_temp.due_amount(pg_temp.g('cod')) = 2120, 'COD creates a due for the full amount');

-- charge can change while pending & unpaid
select public.update_delivery(pg_temp.g('cod'), null, 200, null, null, 'Farther than expected');
select pg_temp.check((select total = 2200 and balance = 2200 from public.invoices where id = pg_temp.g('cod')), 'charge re-priced once: total 2200 (not 2320)');
select pg_temp.check(pg_temp.due_amount(pg_temp.g('cod')) = 2200, 'due follows the new total');
do $$ begin
  perform public.update_delivery(pg_temp.g('cod'), null, 0, null, null, null);
  raise exception 'FAIL: store staff waived after sale';
exception when insufficient_privilege then raise notice 'OK waiving after the sale also needs discount permission'; end $$;
select public.update_delivery(pg_temp.g('cod'), 'dispatched', null, null, 'Ali (rider)', null);
do $$ begin
  perform public.update_delivery(pg_temp.g('cod'), null, 150, null, null, null);
  raise exception 'FAIL: charge changed after dispatch';
exception when others then perform pg_temp.check(sqlerrm like '%locked%', 'charge & address lock once dispatched'); end $$;
-- rider collects cash, order delivered
select public.record_payment(pg_temp.g('cust'), 2200, 'cash', 'k-cod-pay', pg_temp.g('cod'), null, false) is not null;
select public.update_delivery(pg_temp.g('cod'), 'delivered');
select pg_temp.check((select delivery_status = 'delivered' and balance = 0 and delivered_at is not null and dispatched_at is not null
  and delivery_rider = 'Ali (rider)' from public.invoices where id = pg_temp.g('cod')), 'delivered + paid, timestamps & rider saved');
select pg_temp.check(pg_temp.due_status(pg_temp.g('cod')) = 'paid', 'COD due closes when paid');
do $$ begin
  perform public.update_delivery(pg_temp.g('cod'), 'pending');
  raise exception 'FAIL: delivered order reopened';
exception when others then perform pg_temp.check(sqlerrm like '%already delivered%', 'delivered is final'); end $$;

-- Paid now: charge locked even while pending
insert into ctx select 'paid', public.pos_checkout('k-paid', pg_temp.g('cust'), null,
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('litter'), 'quantity', 1)), '[{"method":"cash","amount":1050}]', 0, null, null,
  jsonb_build_object('address', 'House 9, Block A'));
select pg_temp.check((select total = 1050 and balance = 0 from public.invoices where id = pg_temp.g('paid')), 'charge omitted → price-list default Rs. 50');
do $$ begin
  perform public.update_delivery(pg_temp.g('paid'), null, 80, null, null, null);
  raise exception 'FAIL: charge changed on a paid order';
exception when others then perform pg_temp.check(sqlerrm like '%money was already taken%', 'charge locked once money is taken'); end $$;
select public.update_delivery(pg_temp.g('paid'), null, null, 'House 9, Block B (corrected)');
select pg_temp.check((select delivery_address like '%Block B%' from public.invoices where id = pg_temp.g('paid')), 'address can be corrected while pending');

-- In-store sale: no delivery line, no status
insert into ctx select 'instore', public.pos_checkout('k-in', null, null,
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('litter'), 'quantity', 1)), '[{"method":"cash","amount":1000}]');
select pg_temp.check((select fulfilment = 'in_store' and delivery_status is null and total = 1000 from public.invoices where id = pg_temp.g('instore')),
  'in-store sale unchanged');
-- Walk-in name: kept on the bill when no customer is attached; a registered customer always wins
insert into ctx select 'walkin', public.pos_checkout('k-walk', null, null,
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('litter'), 'quantity', 1)), '[{"method":"cash","amount":1000}]',
  0, null, null, null, '  Ali Raza  ');
select pg_temp.check((select walk_in_name = 'Ali Raza' and customer_id is null from public.invoices where id = pg_temp.g('walkin')), 'walk-in name saved on the bill (trimmed)');
insert into ctx select 'walkin2', public.pos_checkout('k-walk2', pg_temp.g('cust'), null,
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('litter'), 'quantity', 1)), '[{"method":"cash","amount":1000}]',
  0, null, null, null, 'Someone else');
select pg_temp.check((select walk_in_name is null from public.invoices where id = pg_temp.g('walkin2')), 'walk-in name ignored when a customer is chosen');
insert into ctx select 'walkin3', public.pos_checkout('k-walk3', null, null,
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('litter'), 'quantity', 1)), '[{"method":"cash","amount":1000}]',
  0, null, null, null, '   ');
select pg_temp.check((select walk_in_name is null from public.invoices where id = pg_temp.g('walkin3')), 'blank walk-in name → none');
do $$ begin
  perform public.update_delivery(pg_temp.g('instore'), 'dispatched');
  raise exception 'FAIL: in-store sale dispatched';
exception when others then perform pg_temp.check(sqlerrm like '%not a home delivery%', 'in-store sales have no delivery status'); end $$;

-- Drafts (owner): delivery line only once, only on delivery orders, required to issue
select pg_temp.act('00000000-0000-0000-0000-0000000000e1');
with i as (insert into public.invoices (kind, customer_id) values ('store', pg_temp.g('cust')) returning id) insert into ctx select 'draft', id from i;
do $$ begin
  insert into public.invoice_items (invoice_id, item_id, quantity, unit_price)
  select pg_temp.g('draft'), id, 1, 50 from public.catalog_items where system_role = 'delivery_charge';
  raise exception 'FAIL: delivery line on in-store bill';
exception when others then perform pg_temp.check(sqlerrm like '%only be added to a home delivery%', 'no delivery charge on in-store bills'); end $$;
update public.invoices set fulfilment = 'home_delivery', delivery_address = 'House 3' where id = pg_temp.g('draft');
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) values (pg_temp.g('draft'), pg_temp.g('litter'), 1, 0);
do $$ begin
  perform public.checkout_invoice(pg_temp.g('draft'), '[{"method":"cash","amount":1000}]', null, 'k-draft-1');
  raise exception 'FAIL: delivery order issued without a charge line';
exception when others then perform pg_temp.check(sqlerrm like '%add the delivery charge%', 'delivery order needs its charge line (Rs. 0 if waived)'); end $$;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price)
select pg_temp.g('draft'), id, 3, 0 from public.catalog_items where system_role = 'delivery_charge';   -- owner may waive; qty forced to 1
do $$ begin
  insert into public.invoice_items (invoice_id, item_id, quantity, unit_price)
  select pg_temp.g('draft'), id, 1, 50 from public.catalog_items where system_role = 'delivery_charge';
  raise exception 'FAIL: second delivery line';
exception when unique_violation then raise notice 'OK delivery charge can appear only once per bill'; end $$;
select pg_temp.check((select quantity = 1 from public.invoice_items where invoice_id = pg_temp.g('draft') and line_role = 'delivery_charge'), 'delivery line quantity forced to 1');
select pg_temp.check(public.checkout_invoice(pg_temp.g('draft'), '[{"method":"cash","amount":1000}]', null, 'k-draft-2') is not null, 'owner issues waived (Rs. 0) delivery order');

-- ============================================================ §4 service location (reception)
select pg_temp.act('00000000-0000-0000-0000-0000000000e4');
with p as (insert into public.pets (name, species_id) select 'Billu', id from public.species order by sort_order limit 1 returning id) insert into ctx select 'pet', id from p;
insert into public.pet_owners (pet_id, customer_id, is_primary) values (pg_temp.g('pet'), pg_temp.g('cust'), true);
do $$ begin
  insert into public.appointments (customer_id, pet_id, appointment_type_id, starts_at, ends_at, service_location)
  select pg_temp.g('cust'), pg_temp.g('pet'), id, now() + interval '1 hour', now() + interval '2 hours', 'home_visit'
    from public.appointment_types where name = 'Grooming';
  raise exception 'FAIL: home visit without address';
exception when check_violation then raise notice 'OK home visit needs an address'; end $$;
with a as (insert into public.appointments (customer_id, pet_id, appointment_type_id, starts_at, ends_at, service_location, service_address)
  select pg_temp.g('cust'), pg_temp.g('pet'), id, now() + interval '1 hour', now() + interval '2 hours', 'home_visit', public.customer_address_line(pg_temp.g('cust'))
    from public.appointment_types where name = 'Grooming' returning id) insert into ctx select 'appt', id from a;
insert into ctx select 'visit', public.check_in_appointment(pg_temp.g('appt'));
select pg_temp.check((select service_location = 'home_visit' and service_address like 'House 12%' from public.visits where id = pg_temp.g('visit')),
  'check-in carries Home Visit + address to the visit');
with i as (insert into public.invoices (customer_id, pet_id, visit_id) values (pg_temp.g('cust'), pg_temp.g('pet'), pg_temp.g('visit')) returning id)
insert into ctx select 'vbill', id from i;
select pg_temp.check((select service_location = 'home_visit' and service_address like 'House 12%' from public.invoices where id = pg_temp.g('vbill')),
  'bill made from the visit inherits Home Visit');
update public.visits set service_location = 'home_visit', service_address = 'Farm house, Bedian Road' where id = pg_temp.g('visit');
select pg_temp.check((select service_address = 'Farm house, Bedian Road' from public.invoices where id = pg_temp.g('vbill')),
  'different visit address flows to the draft bill');
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price)
select pg_temp.g('vbill'), id, 1, 1500 from public.catalog_items where system_role = 'home_visit_charge';
select pg_temp.check((select total = 1500 from public.invoices where id = pg_temp.g('vbill')), 'home visit charge billed (editable price)');
select pg_temp.check(public.checkout_invoice(pg_temp.g('vbill'), '[{"method":"cash","amount":1500}]', null, 'k-vbill') is not null, 'home visit bill issued');
select pg_temp.check((select service_location = 'home_visit' from public.invoices where id = pg_temp.g('vbill')), 'service location saved on the issued bill');

-- ============================================================ §7 stock loans
select pg_temp.act('00000000-0000-0000-0000-0000000000e1');
with p as (insert into public.partner_businesses (name, kind, phone) values ('Pet Care Clinic, Phase 6', 'clinic', '03001234567') returning id)
insert into ctx select 'partner', id from p;
create temp table base on commit drop as
  select (select usable_qty from public.stock_levels where item_id = pg_temp.g('litter')) as qty,
         (select count(*) from public.invoices) as invoices, (select count(*) from public.payments) as payments,
         (select count(*) from public.purchases) as purchases;

select pg_temp.act('00000000-0000-0000-0000-0000000000e5');
do $$ begin
  perform public.record_stock_loan('k-l0', 'borrowed', pg_temp.g('partner'), jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('litter'), 'qty', 1)));
  raise exception 'FAIL: store staff recorded a loan';
exception when insufficient_privilege then raise notice 'OK recording loans needs inventory.manage'; end $$;

select pg_temp.act('00000000-0000-0000-0000-0000000000e1');
-- Borrowed 10 bags (their batch)
insert into ctx select 'borrow', public.record_stock_loan('k-b1', 'borrowed', pg_temp.g('partner'),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('litter'), 'qty', 10, 'batch_no', 'PC-77', 'expiry_date', private.clinic_today() + 150)),
  private.clinic_today(), private.clinic_today() + 7, 'Phone: Dr. Ahmed', 'We ran out');
select pg_temp.check(public.record_stock_loan('k-b1', 'borrowed', pg_temp.g('partner'),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('litter'), 'qty', 10))) = pg_temp.g('borrow'), 'double submit → same record');
select pg_temp.check((select usable_qty from public.stock_levels where item_id = pg_temp.g('litter')) = (select qty from base) + 10,
  'borrowed stock is added once (+10)');
select pg_temp.check((select status = 'pending_return' from public.stock_loans where id = pg_temp.g('borrow')), 'borrowed → pending return');
do $$ begin
  perform public.record_stock_loan('k-b2', 'borrowed', pg_temp.g('partner'),
    jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('litter'), 'qty', 1, 'expiry_date', private.clinic_today() - 1)));
  raise exception 'FAIL: expired borrowed stock accepted';
exception when others then perform pg_temp.check(sqlerrm like '%expired%', 'expired stock is not accepted on loan'); end $$;

-- Lent 4 bags (earliest expiry first)
insert into ctx select 'lend', public.record_stock_loan('k-l1', 'lent', pg_temp.g('partner'),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('litter'), 'qty', 4)), private.clinic_today() - 10, private.clinic_today() - 3);
select pg_temp.check((select usable_qty from public.stock_levels where item_id = pg_temp.g('litter')) = (select qty from base) + 6, 'lent stock leaves (−4)');
do $$ begin
  perform public.record_stock_loan('k-l2', 'lent', pg_temp.g('partner'), jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('litter'), 'qty', 9999)));
  raise exception 'FAIL: lent more than in stock';
exception when others then perform pg_temp.check(sqlerrm like '%not enough%', 'cannot lend more than usable stock'); end $$;

-- Returns: partial, over-return refused, full
insert into ctx select 'bline', id from public.stock_loan_lines where loan_id = pg_temp.g('borrow');
insert into ctx select 'lline', id from public.stock_loan_lines where loan_id = pg_temp.g('lend');
do $$ begin
  perform public.record_stock_loan_return('k-r0', pg_temp.g('borrow'), jsonb_build_array(jsonb_build_object('loan_line_id', pg_temp.g('bline'), 'qty', 11)));
  raise exception 'FAIL: returned more than borrowed';
exception when others then perform pg_temp.check(sqlerrm like '%still outstanding%', 'cannot return more than outstanding'); end $$;
select public.record_stock_loan_return('k-r1', pg_temp.g('borrow'), jsonb_build_array(jsonb_build_object('loan_line_id', pg_temp.g('bline'), 'qty', 6)), null, 'Own stock arrived');
select public.record_stock_loan_return('k-r1', pg_temp.g('borrow'), jsonb_build_array(jsonb_build_object('loan_line_id', pg_temp.g('bline'), 'qty', 6)));  -- double click
select pg_temp.check((select status = 'partially_returned' from public.stock_loans where id = pg_temp.g('borrow'))
  and (select returned_qty = 6 from public.stock_loan_lines where id = pg_temp.g('bline')), 'partial return (6 of 10), double click ignored');
select pg_temp.check((select usable_qty from public.stock_levels where item_id = pg_temp.g('litter')) = (select qty from base) + 0, 'returning borrowed stock reduces stock (−6)');
do $$ begin
  perform public.cancel_stock_loan(pg_temp.g('borrow'), 'oops');
  raise exception 'FAIL: cancelled a loan with returns';
exception when others then perform pg_temp.check(sqlerrm like '%returns were already recorded%', 'loan with returns cannot be cancelled'); end $$;
select public.record_stock_loan_return('k-r2', pg_temp.g('borrow'), jsonb_build_array(jsonb_build_object('loan_line_id', pg_temp.g('bline'), 'qty', 4)));
select pg_temp.check((select status = 'fully_returned' from public.stock_loans where id = pg_temp.g('borrow')), 'second return → fully returned');
do $$ begin
  perform public.record_stock_loan_return('k-r3', pg_temp.g('borrow'), jsonb_build_array(jsonb_build_object('loan_line_id', pg_temp.g('bline'), 'qty', 1)));
  raise exception 'FAIL: returned after fully returned';
exception when others then perform pg_temp.check(sqlerrm like '%already returned%', 'nothing more to return'); end $$;

select pg_temp.act('00000000-0000-0000-0000-0000000000e5');
select pg_temp.check((select count(*) = 1 and bool_and(is_overdue) and sum(outstanding_qty) = 4 from public.stock_loan_outstanding where loan_id = pg_temp.g('lend')),
  'store staff sees the overdue lent line (4 outstanding)');
select pg_temp.act('00000000-0000-0000-0000-0000000000e1');
select public.record_stock_loan_return('k-r4', pg_temp.g('lend'), jsonb_build_array(jsonb_build_object('loan_line_id', pg_temp.g('lline'), 'qty', 1)));
select public.record_stock_loan_return('k-r5', pg_temp.g('lend'),
  jsonb_build_array(jsonb_build_object('loan_line_id', pg_temp.g('lline'), 'qty', 3, 'batch_no', 'THEIRS-1', 'expiry_date', private.clinic_today() + 90)));
select pg_temp.check((select status = 'fully_returned' from public.stock_loans where id = pg_temp.g('lend'))
  and not exists (select 1 from public.stock_loan_outstanding where loan_id = pg_temp.g('lend')), 'lent stock returned in two parts (one new batch)');
select pg_temp.check((select usable_qty from public.stock_levels where item_id = pg_temp.g('litter')) = (select qty from base), 'stock back to the starting count');

-- Cancel a mistaken record → stock reversed
insert into ctx select 'oops', public.record_stock_loan('k-b9', 'borrowed', pg_temp.g('partner'),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('litter'), 'qty', 2)));
select public.cancel_stock_loan(pg_temp.g('oops'), 'Entered twice');
select pg_temp.check((select status = 'cancelled' from public.stock_loans where id = pg_temp.g('oops'))
  and (select usable_qty from public.stock_levels where item_id = pg_temp.g('litter')) = (select qty from base), 'cancelled record reverses its stock');

do $$ begin
  update public.stock_loan_lines set qty = 1 where id = pg_temp.g('bline');
  if found then raise exception 'FAIL: loan line edited'; end if;
  raise notice 'OK loan lines cannot be edited';
end $$;
select pg_temp.check((select count(*) from public.invoices) = (select invoices from base)
  and (select count(*) from public.payments) = (select payments from base)
  and (select count(*) from public.purchases) = (select purchases from base), 'loans create no invoices, payments or purchases');

reset role;
select pg_temp.check(not exists (select 1 from public.inventory_movements m
  where m.kind in ('borrow_in', 'borrow_return', 'lend_out', 'lend_return') and private.is_usage_movement(m.kind, m.ref_table, m.ref_id)),
  'reports never count loan movements as sales/usage');
select pg_temp.check((select sum(qty_on_hand) from public.product_batches where item_id = pg_temp.g('litter'))
  = (select sum(qty) from public.inventory_movements where item_id = pg_temp.g('litter')), 'stock reconciles with movements');
-- Regression: items whose price is set at the till were sold at Rs. 0 when the cart sent no price
set local role authenticated;
select pg_temp.act('00000000-0000-0000-0000-0000000000e1');
with i as (insert into public.catalog_items (kind, name, unit, sale_price, is_retail, price_is_editable)
  values ('product', 'Till-priced Litter 10L', 'bag', 1100, true, true) returning id) insert into ctx select 'tillitem', id from i;
with i as (insert into public.catalog_items (kind, name, unit, sale_price, is_retail, price_is_editable)
  values ('product', 'Unpriced Treat', 'pcs', 0, true, true) returning id) insert into ctx select 'unpriced', id from i;
insert into ctx select 'tillsale', public.pos_checkout('pos-till-1', pg_temp.g('cust'), null,
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('tillitem'), 'quantity', 1)),
  '[{"method":"jazzcash","amount":1150,"reference":"TX-991"}]', 0, null, null, '{"address":"House 12","charge":50}');
select pg_temp.check((select total = 1150 and amount_paid = 1150 from public.invoices where id = pg_temp.g('tillsale')),
  'a till-priced item with no typed price is billed at its list price (Rs. 1,100 + 50 delivery), not Rs. 0');
insert into ctx select 'tillsale2', public.pos_checkout('pos-till-2', null, null,
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('tillitem'), 'quantity', 1, 'unit_price', 900)), '[{"method":"cash","amount":900}]');
select pg_temp.check((select total = 900 from public.invoices where id = pg_temp.g('tillsale2')), 'a price typed at the till is used');
do $$ begin
  begin
    perform public.pos_checkout('pos-till-3', null, null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('unpriced'), 'quantity', 1)), '[]');
    raise exception 'FAIL: a product was sold at Rs. 0';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'OK a product with no price is refused instead of being sold at Rs. 0';
  end;
end $$;
reset role;
select 'ALL POS ENHANCEMENT CHECKS PASSED' as result;
rollback;
