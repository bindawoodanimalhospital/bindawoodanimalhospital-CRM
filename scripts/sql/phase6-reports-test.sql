-- Phase 6 reports & export safety tests. One transaction, rolled back.
-- Reports aggregate the whole clinic, so every money check compares before/after deltas.
begin;

insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000000d1', 'owner6@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d2', 'doc6@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d4', 'recep6@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d5', 'store6@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%6@t.local';
insert into public.staff_roles (staff_id, role_id)
select u.id::uuid, r.id from (values ('00000000-0000-0000-0000-0000000000d1', 'owner'), ('00000000-0000-0000-0000-0000000000d2', 'senior_doctor'),
  ('00000000-0000-0000-0000-0000000000d4', 'reception'), ('00000000-0000-0000-0000-0000000000d5', 'store_staff')) u(id, key)
join public.roles r on r.key = u.key;

create temp table ctx (k text primary key, v uuid) on commit drop;
create temp table snap (k text primary key, v jsonb) on commit drop;
grant all on ctx, snap to authenticated;
create or replace function pg_temp.act(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.g(key text) returns uuid language sql as $$ select v from ctx where k = key $$;
create or replace function pg_temp.num(key text, path text[]) returns numeric language sql as $$
  select coalesce((select (v #>> path)::numeric from snap where k = key), 0) $$;
set local role authenticated;

-- ============================================================ anon / grants
do $$ begin
  if has_function_privilege('anon', 'public.report_financial(date, date)', 'execute')
     or has_function_privilege('anon', 'public.log_export(text, int, jsonb)', 'execute') then
    raise exception 'FAIL: anon can run reports';
  end if;
  raise notice 'OK reports are not callable without signing in';
end $$;

-- ============================================================ owner: baseline, then a day of business
select pg_temp.act('00000000-0000-0000-0000-0000000000d1');
insert into snap values ('fin0', public.report_financial(private.clinic_today(), private.clinic_today())),
                        ('ops0', public.report_operations(private.clinic_today(), private.clinic_today()));

update public.catalog_items set sale_price = 1000 where name = 'Consultation fee';
with i as (insert into public.catalog_items (kind, name, category, unit, sale_price, track_stock, reorder_level)
  values ('product', 'Report Test Tabs', 'Medicines', 'tablet', 100, true, 5) returning id) insert into ctx select 'tabs', id from i;
with s as (insert into public.suppliers (name) values ('Report Test Pharma') returning id) insert into ctx select 'sup', id from s;
with p as (insert into public.purchases (supplier_id) values (pg_temp.g('sup')) returning id) insert into ctx select 'po', id from p;
insert into public.purchase_lines (purchase_id, item_id, location_id, batch_no, expiry_date, qty, unit_cost)
select pg_temp.g('po'), pg_temp.g('tabs'), id, 'R1', current_date + 300, 10, 40 from public.inventory_locations where is_default;
select public.receive_purchase(pg_temp.g('po'));

with c as (insert into public.customers (full_name, phone) values ('Report Owner', '+923009998877') returning id) insert into ctx select 'cust', id from c;
with p as (insert into public.pets (name, species_id) select 'Rex', id from public.species where name = 'Dog' returning id) insert into ctx select 'pet', id from p;
insert into public.pet_owners (pet_id, customer_id, is_primary) values (pg_temp.g('pet'), pg_temp.g('cust'), true);
with v as (insert into public.visits (pet_id, customer_id, doctor_id) values (pg_temp.g('pet'), pg_temp.g('cust'), '00000000-0000-0000-0000-0000000000d2') returning id)
insert into ctx select 'visit', id from v;

with i as (insert into public.invoices (customer_id, pet_id, visit_id) values (pg_temp.g('cust'), pg_temp.g('pet'), pg_temp.g('visit')) returning id) insert into ctx select 'inv', id from i;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) select pg_temp.g('inv'), id, 1, 0 from public.catalog_items where name = 'Consultation fee';
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price, deduct_stock) values (pg_temp.g('inv'), pg_temp.g('tabs'), 2, 0, true);
select public.checkout_invoice(pg_temp.g('inv'), '[{"method":"cash","amount":700}]',
  jsonb_build_object('promised_date', current_date + 5, 'reason', 'Rest on Friday'), 'k-rpt-1') is not null as issued;
insert into public.expenses (category_id, amount, method, description) select id, 300, 'cash', 'Report test tea' from public.expense_categories order by sort_order limit 1;

insert into snap values ('fin1', public.report_financial(private.clinic_today(), private.clinic_today())),
                        ('ops1', public.report_operations(private.clinic_today(), private.clinic_today())),
                        ('inv1', public.report_inventory(private.clinic_today(), private.clinic_today()));

do $$
declare d_billed numeric := pg_temp.num('fin1', '{billed,gross}') - pg_temp.num('fin0', '{billed,gross}');
        d_coll   numeric := pg_temp.num('fin1', '{collected,net}') - pg_temp.num('fin0', '{collected,net}');
        d_owed   numeric := pg_temp.num('fin1', '{owed,total}') - pg_temp.num('fin0', '{owed,total}');
        d_cost   numeric := pg_temp.num('fin1', '{estimate,stock_cost}') - pg_temp.num('fin0', '{estimate,stock_cost}');
        d_exp    numeric := pg_temp.num('fin1', '{expenses,total}') - pg_temp.num('fin0', '{expenses,total}');
        d_profit numeric := pg_temp.num('fin1', '{estimate,profit}') - pg_temp.num('fin0', '{estimate,profit}');
begin
  if d_billed <> 1200 then raise exception 'FAIL: billed moved by % (expected 1200)', d_billed; end if;
  raise notice 'OK billed counts the issued bill (Rs. 1,200)';
  if d_coll <> 700 then raise exception 'FAIL: collected moved by % (expected 700)', d_coll; end if;
  raise notice 'OK collected counts only cash received (Rs. 700), not the bill';
  if d_owed <> 500 then raise exception 'FAIL: owed moved by % (expected 500)', d_owed; end if;
  raise notice 'OK owed = billed − collected (Rs. 500)';
  if d_cost <> 80 then raise exception 'FAIL: stock cost moved by % (expected 80)', d_cost; end if;
  if d_exp <> 300 then raise exception 'FAIL: expenses moved by % (expected 300)', d_exp; end if;
  if d_profit <> 820 then raise exception 'FAIL: profit estimate moved by % (expected 820)', d_profit; end if;
  raise notice 'OK estimated profit = billed − stock cost − expenses (1200 − 80 − 300)';
  if pg_temp.num('ops1', '{visits,total}') - pg_temp.num('ops0', '{visits,total}') <> 1 then raise exception 'FAIL: visit not counted'; end if;
  raise notice 'OK clinic activity counts the visit';
  if not exists (select 1 from snap, jsonb_array_elements(v -> 'top_used') e where k = 'inv1'
                  and e ->> 'label' = 'Report Test Tabs' and (e ->> 'used')::numeric = 2 and (e ->> 'cost')::numeric = 80) then
    raise exception 'FAIL: medicine usage missing from stock report';
  end if;
  raise notice 'OK stock report shows medicine used, with cost for cost-viewers';
  if jsonb_array_length((select v from snap where k = 'fin1') -> 'series') <> 1 then raise exception 'FAIL: one-day range should have one bucket'; end if;
end $$;

do $$ begin
  perform public.report_financial(current_date, current_date - 1);
  raise exception 'FAIL: backwards range accepted';
exception when invalid_parameter_value then raise notice 'OK backwards date range is refused';
end $$;
do $$ begin
  perform public.report_operations(current_date - 2000, current_date);
  raise exception 'FAIL: huge range accepted';
exception when invalid_parameter_value then raise notice 'OK ranges over 3 years are refused';
end $$;

select public.log_export('invoices', 12, '{"from":"2026-09-01"}');
do $$ begin
  if not exists (select 1 from public.audit_logs where action = 'data.exported' and table_name = 'invoices'
                  and actor_id = '00000000-0000-0000-0000-0000000000d1' and (context ->> 'rows')::int = 12) then
    raise exception 'FAIL: export not audited';
  end if;
  raise notice 'OK every export is written to the history log';
end $$;

-- ============================================================ senior doctor: activity yes, money no
select pg_temp.act('00000000-0000-0000-0000-0000000000d2');
select 'doctor sees activity' as t, (public.report_operations(private.clinic_today(), private.clinic_today()) -> 'visits' ->> 'total')::int >= 1 as ok;
do $$ begin
  perform public.report_financial(current_date, current_date);
  raise exception 'FAIL: doctor saw money report';
exception when insufficient_privilege then raise notice 'OK money reports need reports.financial';
end $$;
do $$ begin
  if exists (select 1 from jsonb_array_elements(public.report_data_quality()) e where e ->> 'key' = 'no_cost') then
    raise exception 'FAIL: cost check shown without cost permission';
  end if;
  if exists (select 1 from jsonb_array_elements(public.report_data_quality()) e where e = 'null'::jsonb) then
    raise exception 'FAIL: null entries in data-quality list';
  end if;
  raise notice 'OK data-quality list hides cost checks from non-cost roles';
end $$;
do $$ begin
  perform public.log_export('customers', 1, '{}');
  raise exception 'FAIL: doctor exported';
exception when insufficient_privilege then raise notice 'OK export needs data.export';
end $$;

-- ============================================================ reception: no reports
select pg_temp.act('00000000-0000-0000-0000-0000000000d4');
do $$ begin
  perform public.report_operations(current_date, current_date);
  raise exception 'FAIL: reception saw reports';
exception when insufficient_privilege then raise notice 'OK reception has no report access';
end $$;

-- ============================================================ store staff: stock report without costs
select pg_temp.act('00000000-0000-0000-0000-0000000000d5');
do $$
declare r jsonb := public.report_inventory(private.clinic_today(), private.clinic_today());
begin
  if r -> 'purchases' <> 'null'::jsonb or r -> 'stock_now' -> 'value' <> 'null'::jsonb
     or exists (select 1 from jsonb_array_elements(r -> 'top_used') e where e -> 'cost' <> 'null'::jsonb) then
    raise exception 'FAIL: store staff saw purchase costs';
  end if;
  raise notice 'OK stock report hides costs and supplier prices without inventory.view_cost';
end $$;
do $$ begin
  perform public.report_financial(current_date, current_date);
  raise exception 'FAIL: store staff saw money report';
exception when insufficient_privilege then raise notice 'OK store staff cannot see money reports';
end $$;

rollback;
