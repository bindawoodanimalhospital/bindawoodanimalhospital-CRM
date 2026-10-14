-- Correcting / splitting expiry dates and batch numbers (migration 052). Rolled back.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000be101', 'be-inv@be.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000be102', 'be-recep@be.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@be.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000be101', id from public.roles where key = 'owner';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000be102', id from public.roles where key = 'reception';
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
create or replace function pg_temp.lot(item uuid, exp date) returns numeric language sql as $$
  select coalesce(sum(qty_on_hand), 0) from public.product_batches where item_id = item and expiry_date is not distinct from exp $$;
set local role authenticated;
select pg_temp.as_('00000000-0000-0000-0000-0000000be101');

with i as (insert into public.catalog_items (kind, name, unit, sale_price, is_retail) values ('product', 'BE Wormer', 'tab', 100, true) returning id) insert into fx select 'item', id from i;
select public.add_stock(pg_temp.g('item'), 10);                                   -- entered with no expiry
insert into fx select 'loose', id from public.product_batches where item_id = pg_temp.g('item');

-- Reception can't change batches
select pg_temp.as_('00000000-0000-0000-0000-0000000be102');
do $$ begin
  perform public.set_batch_details(pg_temp.g('loose'), jsonb_build_array(jsonb_build_object('qty', 10, 'expiry', '2027-01-31')));
  raise exception 'FAIL: reception edited a batch';
exception when insufficient_privilege then raise notice 'OK only inventory staff can edit batches'; end $$;
select pg_temp.as_('00000000-0000-0000-0000-0000000be101');

-- 1) Just add the expiry date to existing stock
select public.set_batch_details(pg_temp.g('loose'), jsonb_build_array(jsonb_build_object('qty', 10, 'expiry', '2027-01-31', 'batch_no', 'L-77')), 'Read from the box');
select pg_temp.check((select expiry_date = date '2027-01-31' and batch_no = 'L-77' and qty_on_hand = 10 from public.product_batches where id = pg_temp.g('loose')),
  'expiry and batch no. added to existing stock; quantity unchanged');

-- 2) Split: 6 expire Jan 2027, 4 expire Mar 2027
select public.set_batch_details(pg_temp.g('loose'), jsonb_build_array(
  jsonb_build_object('qty', 6, 'expiry', '2027-01-31', 'batch_no', 'L-77'),
  jsonb_build_object('qty', 4, 'expiry', '2027-03-31', 'batch_no', 'L-90')), 'Two boxes with different dates');
select pg_temp.check(pg_temp.lot(pg_temp.g('item'), date '2027-01-31') = 6 and pg_temp.lot(pg_temp.g('item'), date '2027-03-31') = 4
  and pg_temp.qty(pg_temp.g('item')) = 10, 'split into two expiry dates, total still 10');
do $$ begin
  perform public.set_batch_details(pg_temp.g('loose'), jsonb_build_array(jsonb_build_object('qty', 2, 'expiry', '2027-02-28'), jsonb_build_object('qty', 3, 'expiry', '2027-04-30')));
  raise exception 'FAIL: wrong total accepted';
exception when others then perform pg_temp.check(sqlerrm like '%must match%', 'lines must add up to the quantity'); end $$;

-- 3) Correct a typo into a date that already exists → merged
insert into fx select 'mar', id from public.product_batches where item_id = pg_temp.g('item') and expiry_date = date '2027-03-31';
select public.set_batch_details(pg_temp.g('mar'), jsonb_build_array(jsonb_build_object('qty', 4, 'expiry', '2027-01-31', 'batch_no', 'L-77')), 'Same box after all');
select pg_temp.check(pg_temp.lot(pg_temp.g('item'), date '2027-01-31') = 10 and pg_temp.qty(pg_temp.g('item')) = 10, 'correcting to an existing date merges them');

-- 4) Sales still take the soonest expiry first
select public.set_batch_details(pg_temp.g('loose'), jsonb_build_array(
  jsonb_build_object('qty', 7, 'expiry', '2027-06-30'), jsonb_build_object('qty', 3, 'expiry', (private.clinic_today() + 20)::text)));
select public.pos_checkout('be-sale', null, null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('item'), 'quantity', 2)), '[{"method":"cash","amount":200}]');
select pg_temp.check(pg_temp.lot(pg_temp.g('item'), private.clinic_today() + 20) = 1, 'a sale takes the soonest-expiring stock first');

reset role;
select pg_temp.check((select count(*) >= 4 from public.audit_logs where action = 'batch.edited' and context ->> 'item' = 'BE Wormer'), 'every change in the activity log');
select pg_temp.check((select count(*) > 0 from public.inventory_movements where item_id = pg_temp.g('item') and kind = 'transfer_out' and reason = 'Two boxes with different dates'),
  'splits appear in the stock history with the reason');
select 'ALL BATCH-EDIT CHECKS PASSED' as result;
rollback;
