-- Product sizes (migration 037). Rolled back.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000ff001', 'sz-owner@sz.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000ff002', 'sz-store@sz.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@sz.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000ff001', id from public.roles where key = 'owner';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000ff002', id from public.roles where key = 'store_staff';
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
select pg_temp.as_('00000000-0000-0000-0000-0000000ff001');

with i as (insert into public.catalog_items (kind, name, category, unit, sale_price, is_retail) values ('product', 'SZ Kitten Food 1.5kg', 'Cat Food', 'bag', 4000, true) returning id) insert into fx select 'big', id from i;
with i as (insert into public.catalog_items (kind, name, category, unit, sale_price, is_retail) values ('product', 'SZ Kitten Food 400g', 'Cat Food', 'bag', 1200, true) returning id) insert into fx select 'small', id from i;
with i as (insert into public.catalog_items (kind, name, unit, sale_price) values ('service', 'SZ Grooming', 'session', 1500) returning id) insert into fx select 'svc', id from i;

-- Store staff can't group
select pg_temp.as_('00000000-0000-0000-0000-0000000ff002');
do $$ begin
  begin
    perform public.group_sizes('SZ Kitten Food', jsonb_build_array(jsonb_build_object('id', pg_temp.g('big'), 'size_label', '1.5 kg')));
    raise exception 'FAIL: store staff grouped sizes';
  exception when insufficient_privilege then raise notice 'OK store staff cannot change size groups';
  end;
end $$;

select pg_temp.as_('00000000-0000-0000-0000-0000000ff001');
insert into fx select 'fam', public.group_sizes('SZ Kitten Food', jsonb_build_array(
  jsonb_build_object('id', pg_temp.g('big'), 'size_label', '1.5 kg'),
  jsonb_build_object('id', pg_temp.g('small'), 'size_label', '400g')));
select pg_temp.check((select count(*) = 2 from public.catalog_items where family_id = pg_temp.g('fam')), 'two items grouped as sizes of one product');
select pg_temp.check((select array_agg(size_label order by size_grams) = '{400g,"1.5 kg"}' from public.catalog_items where family_id = pg_temp.g('fam')),
  'sizes sort small → large (400 g before 1.5 kg)');
select pg_temp.check((select category = 'Cat Food' from public.product_families where id = pg_temp.g('fam')), 'the product takes the items'' category');
do $$ begin
  begin
    perform public.group_sizes('SZ Mixed', jsonb_build_array(jsonb_build_object('id', pg_temp.g('svc'), 'size_label', '1 kg')));
    raise exception 'FAIL: a service was grouped as a size';
  exception when others then raise notice 'OK services cannot be sizes';
  end;
end $$;
do $$ begin
  begin
    perform public.group_sizes('SZ Kitten Food', jsonb_build_array(jsonb_build_object('id', pg_temp.g('small'), 'size_label', ' ')));
    raise exception 'FAIL: a size without a label';
  exception when others then raise notice 'OK every size needs a label';
  end;
end $$;

-- A size that isn't in the shop
update public.catalog_items set is_available = false where id = pg_temp.g('big');
select pg_temp.check((select not is_available from public.catalog_items where id = pg_temp.g('big')), 'a size can be marked not available');

-- Billing a size is the same as billing any item
with c as (insert into public.customers (full_name) values ('SZ Buyer') returning id) insert into fx select 'cust', id from c;
insert into fx select 'inv', public.pos_checkout('sz-sale-1', pg_temp.g('cust'), null,
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('small'), 'quantity', 2)), '[{"method":"cash","amount":2400}]', 0, null, null, null);
select pg_temp.check((select total = 2400 and balance = 0 from public.invoices where id = pg_temp.g('inv')), 'selling 2 × 400 g bills Rs. 2,400 like any item');

-- Ungrouping the last sizes removes the empty product group
update public.catalog_items set family_id = null, size_label = null where family_id = pg_temp.g('fam');
select pg_temp.check(not exists (select 1 from public.product_families where id = pg_temp.g('fam')), 'an empty size group is removed automatically');
select pg_temp.check((select count(*) = 2 from public.catalog_items where id in (pg_temp.g('big'), pg_temp.g('small'))), 'the items themselves stay on the price list');

reset role;
select pg_temp.check((select (private.parse_size('Pet Flori Litter 10L')).grams = 10000), 'litres are understood (10 L)');
select pg_temp.check(exists (select 1 from information_schema.triggers where event_object_table = 'product_families' and action_statement ilike '%audit_row%'),
  'size groups are recorded in the activity log');
select 'ALL SIZES CHECKS PASSED' as result;
rollback;
