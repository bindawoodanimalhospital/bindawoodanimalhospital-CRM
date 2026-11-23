-- Easy stock: add_stock and shelf counts (migration 039). Rolled back.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000aa101', 'st-owner@st.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000aa102', 'st-recep@st.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@st.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000aa101', id from public.roles where key = 'owner';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000aa102', id from public.roles where key = 'reception';
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
select pg_temp.as_('00000000-0000-0000-0000-0000000aa101');

with i as (insert into public.catalog_items (kind, name, unit, sale_price, is_retail) values ('product', 'ST Cat Food 1kg', 'bag', 1000, true) returning id) insert into fx select 'food', id from i;
with i as (insert into public.catalog_items (kind, name, unit, sale_price) values ('product', 'ST Syringe 3ml', 'pcs', 30) returning id) insert into fx select 'syr', id from i;
with i as (insert into public.catalog_items (kind, name, unit, sale_price) values ('service', 'ST Bath', 'session', 800) returning id) insert into fx select 'svc', id from i;

-- add_stock: one step, tracking turns on, sensible place
select public.add_stock(pg_temp.g('food'), 10);
select pg_temp.check(pg_temp.qty(pg_temp.g('food')) = 10, 'adding 10 bags gives 10 in stock');
select pg_temp.check((select track_stock from public.catalog_items where id = pg_temp.g('food')), 'adding stock turns tracking on by itself');
select pg_temp.check((select l.name ilike '%store%' from public.product_batches b join public.inventory_locations l on l.id = b.location_id where b.item_id = pg_temp.g('food') limit 1),
  'a pet-store product goes to the pet store unless told otherwise');
select public.add_stock(pg_temp.g('food'), 5);
select pg_temp.check(pg_temp.qty(pg_temp.g('food')) = 15 and (select count(*) = 1 from public.product_batches where item_id = pg_temp.g('food')),
  'adding more without a batch number joins the same stock (15)');
select public.add_stock(pg_temp.g('food'), 4, null, 'LOT-7', private.clinic_today() + 90);
select pg_temp.check(pg_temp.qty(pg_temp.g('food')) = 19 and (select count(*) = 2 from public.product_batches where item_id = pg_temp.g('food')),
  'adding with a batch and expiry keeps it as its own batch');
do $$ begin
  begin perform public.add_stock(pg_temp.g('food'), 3, null, 'OLD', private.clinic_today() - 1); raise exception 'FAIL: expired batch added';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK an already-expired batch is refused'; end;
  begin perform public.add_stock(pg_temp.g('svc'), 1); raise exception 'FAIL: stock added to a service';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK services have no stock'; end;
  begin perform public.add_stock(pg_temp.g('food'), 0); raise exception 'FAIL: zero added';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK adding zero is refused'; end;
end $$;

-- Shelf count: set exact numbers, many at once
select pg_temp.check(public.set_stock_counts(jsonb_build_array(
  jsonb_build_object('item_id', pg_temp.g('food'), 'count', 12),
  jsonb_build_object('item_id', pg_temp.g('syr'), 'count', 200))) = 2, 'a shelf count saves several items at once');
select pg_temp.check(pg_temp.qty(pg_temp.g('food')) = 12, 'counting 12 on the shelf lowers 19 → 12');
select pg_temp.check((select qty_on_hand = 0 from public.product_batches where item_id = pg_temp.g('food') and batch_no = 'LOT-7'),
  'the batch that expires soonest is lowered first');
select pg_temp.check(pg_temp.qty(pg_temp.g('syr')) = 200 and (select track_stock from public.catalog_items where id = pg_temp.g('syr')),
  'an untracked item gets its first count (200) and starts being tracked');
select pg_temp.check(public.set_stock_counts(jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('syr'), 'count', 200))) = 0,
  'saving the same count again changes nothing');
do $$ begin
  begin perform public.set_stock_counts(jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('syr'), 'count', -1))); raise exception 'FAIL: negative count';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if; raise notice 'OK a negative count is refused'; end;
end $$;
select pg_temp.check((select count(*) >= 4 from public.inventory_movements where item_id = pg_temp.g('food') and created_by = '00000000-0000-0000-0000-0000000aa101'),
  'every change is a stock movement with the person''s name');

-- Selling after counting takes stock out
insert into fx select 'sale', public.pos_checkout('st-sale-1', null, null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('food'), 'quantity', 2)), '[{"method":"cash","amount":2000}]');
select pg_temp.check(pg_temp.qty(pg_temp.g('food')) = 10, 'selling 2 bags leaves 10');

-- Permissions: reception (no inventory.adjust) can't change stock
select pg_temp.as_('00000000-0000-0000-0000-0000000aa102');
do $$ begin
  if private.has_permission('inventory.adjust') then raise notice 'SKIP reception has inventory.adjust in this setup'; return; end if;
  begin perform public.add_stock(pg_temp.g('food'), 5); raise exception 'FAIL: reception added stock';
  exception when insufficient_privilege then raise notice 'OK staff without stock permission cannot add stock'; end;
  begin perform public.set_stock_counts(jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('food'), 'count', 99))); raise exception 'FAIL: reception counted stock';
  exception when insufficient_privilege then raise notice 'OK staff without stock permission cannot do a shelf count'; end;
end $$;
reset role;
-- Stock kept in two places (Pet store + Pharmacy): a shelf count is for the total
set local role authenticated;
select pg_temp.as_('00000000-0000-0000-0000-0000000aa101');
with i as (insert into public.catalog_items (kind, name, unit, sale_price, is_retail) values ('product', 'ST Two Places Food', 'bag', 900, true) returning id) insert into fx select 'two', id from i;
select public.add_stock(pg_temp.g('two'), 9);                                                                   -- usual place (Pet store)
select public.add_stock(pg_temp.g('two'), 19, (select id from public.inventory_locations where name = 'Pharmacy'));
select pg_temp.check(pg_temp.qty(pg_temp.g('two')) = 28, 'two places hold 9 + 19 = 28');
select public.set_stock_counts(jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('two'), 'count', 28)));
select pg_temp.check(pg_temp.qty(pg_temp.g('two')) = 28, 'counting 28 when there are 28 changes nothing (it used to add 19)');
select public.set_stock_counts(jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('two'), 'count', 20)));
select pg_temp.check(pg_temp.qty(pg_temp.g('two')) = 20, 'counting 20 brings the total down to 20 (it used to say nothing changed)');
select public.set_stock_counts(jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('two'), 'count', 25)));
select pg_temp.check(pg_temp.qty(pg_temp.g('two')) = 25, 'counting 25 adds the 5 found');
reset role;
select 'ALL STOCK CHECKS PASSED' as result;
rollback;
