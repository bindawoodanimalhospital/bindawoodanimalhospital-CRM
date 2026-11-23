-- Deleting never-used price-list items (migration 048). Rolled back.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000dd101', 'di-owner@di.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000dd102', 'di-store@di.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@di.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000dd101', id from public.roles where key = 'owner';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000dd102', id from public.roles where key = 'store_staff';
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
set local role authenticated;
select pg_temp.as_('00000000-0000-0000-0000-0000000dd101');

with i as (insert into public.catalog_items (kind, name, unit, sale_price, is_retail) values ('product', 'DI Typo Fod', 'bag', 900, true) returning id) insert into fx select 'typo', id from i;
insert into public.catalog_costs (item_id, cost_price) values (pg_temp.g('typo'), 600);
with i as (insert into public.catalog_items (kind, name, unit, sale_price, is_retail) values ('product', 'DI Stocked', 'bag', 900, true) returning id) insert into fx select 'stocked', id from i;
select public.add_stock(pg_temp.g('stocked'), 5);
with i as (insert into public.catalog_items (kind, name, unit, sale_price) values ('service', 'DI Billed service', 'session', 500) returning id) insert into fx select 'billed', id from i;
with c as (insert into public.customers (full_name) values ('DI Buyer') returning id) insert into fx select 'cust', id from c;
with b as (insert into public.invoices (customer_id) values (pg_temp.g('cust')) returning id) insert into fx select 'bill', id from b;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) values (pg_temp.g('bill'), pg_temp.g('billed'), 1, 500);

-- Store staff can't delete
select pg_temp.as_('00000000-0000-0000-0000-0000000dd102');
select pg_temp.check(not public.item_is_deletable(pg_temp.g('typo')), 'no Delete button for store staff');
do $$ begin
  perform public.delete_unused_item(pg_temp.g('typo'));
  raise exception 'FAIL: store staff deleted an item';
exception when insufficient_privilege then raise notice 'OK store staff cannot delete items'; end $$;

select pg_temp.as_('00000000-0000-0000-0000-0000000dd101');
select pg_temp.check(public.item_is_deletable(pg_temp.g('typo')), 'never-used item: Delete button shown');
select pg_temp.check(not public.item_is_deletable(pg_temp.g('stocked')), 'item with stock: no Delete button');
select pg_temp.check(not public.item_is_deletable(pg_temp.g('billed')), 'item on a bill (even a draft): no Delete button');
select pg_temp.check(not public.item_is_deletable((select id from public.catalog_items where system_role = 'delivery_charge')), 'built-in item: no Delete button');
do $$ begin
  perform public.delete_unused_item(pg_temp.g('stocked'));
  raise exception 'FAIL: deleted an item with stock';
exception when foreign_key_violation then perform pg_temp.check(sqlerrm like '%used (stock)%Hide it instead%', 'item with stock refused, told to hide it'); end $$;
do $$ begin
  perform public.delete_unused_item(pg_temp.g('billed'));
  raise exception 'FAIL: deleted a billed item';
exception when foreign_key_violation then perform pg_temp.check(sqlerrm like '%used (bills)%', 'billed item refused'); end $$;
do $$ begin
  perform public.delete_unused_item((select id from public.catalog_items where system_role = 'delivery_charge'));
  raise exception 'FAIL: deleted a built-in item';
exception when insufficient_privilege then raise notice 'OK built-in items cannot be deleted'; end $$;

select public.delete_unused_item(pg_temp.g('typo'), 'Typo — duplicate of DI Food');
select pg_temp.check(not exists (select 1 from public.catalog_items where id = pg_temp.g('typo')), 'never-used item deleted');
select pg_temp.check(not exists (select 1 from public.catalog_costs where item_id = pg_temp.g('typo')), 'its saved cost went with it');
reset role;
select pg_temp.check(exists (select 1 from public.audit_logs where action = 'item.deleted' and record_id = pg_temp.g('typo')::text
  and reason = 'Typo — duplicate of DI Food' and context ->> 'name' = 'DI Typo Fod'), 'deletion recorded in the activity log with name and reason');
select pg_temp.check(exists (select 1 from public.audit_logs where table_name = 'catalog_items' and action = 'delete' and record_id = pg_temp.g('typo')::text),
  'full row kept in the activity log');
select 'ALL DELETE-ITEM CHECKS PASSED' as result;
rollback;
