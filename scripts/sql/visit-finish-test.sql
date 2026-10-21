-- A visit finishes when its bill is issued; empty drafts are tidied (migration 057). Rolled back.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000af101', 'vf-recep@vf.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@vf.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000af101', id from public.roles where key = 'reception';
create temp table fx (k text primary key, v uuid) on commit drop;
grant all on fx to authenticated;
create or replace function pg_temp.g(key text) returns uuid language sql as $$ select v from fx where k = key $$;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'OK %', label;
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000af101","role":"authenticated"}', true);
with c as (insert into public.customers (full_name) values ('VF Owner') returning id) insert into fx select 'c', id from c;
with p as (insert into public.pets (name, species_id) select 'VF Dog', id from public.species where name = 'Dog' returning id) insert into fx select 'pet', id from p;
insert into public.pet_owners (pet_id, customer_id, is_primary) values (pg_temp.g('pet'), pg_temp.g('c'), true);
with v as (insert into public.visits (pet_id, customer_id) values (pg_temp.g('pet'), pg_temp.g('c')) returning id) insert into fx select 'visit', id from v;
update public.visits set status = 'ready_for_billing' where id = pg_temp.g('visit');
with i as (insert into public.invoices (customer_id, pet_id, visit_id) values (pg_temp.g('c'), pg_temp.g('pet'), pg_temp.g('visit')) returning id) insert into fx select 'bill', id from i;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) select pg_temp.g('bill'), id, 1, 1500 from public.catalog_items where name = 'Other charge';
select pg_temp.check((select status = 'ready_for_billing' from public.visits where id = pg_temp.g('visit')), 'visit waits while the bill is a draft');
select public.checkout_invoice(pg_temp.g('bill'), '[{"method":"cash","amount":1500}]', null, 'vf-1');
select pg_temp.check((select status = 'completed' and completed_at is not null from public.visits where id = pg_temp.g('visit')), 'issuing the bill finishes the visit');

-- Empty draft from yesterday is tidied; a draft with items is kept
with i as (insert into public.invoices (customer_id) values (pg_temp.g('c')) returning id) insert into fx select 'empty', id from i;
with i as (insert into public.invoices (customer_id) values (pg_temp.g('c')) returning id) insert into fx select 'kept', id from i;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) select pg_temp.g('kept'), id, 1, 200 from public.catalog_items where name = 'Other charge';
reset role;
update public.invoices set created_at = now() - interval '2 days' where id in (pg_temp.g('empty'), pg_temp.g('kept'));
select private.remove_empty_drafts();
select pg_temp.check(not exists (select 1 from public.invoices where id = pg_temp.g('empty')) and exists (select 1 from public.invoices where id = pg_temp.g('kept')),
  'empty old drafts are removed, drafts with items are kept');
select 'ALL VISIT-FINISH CHECKS PASSED' as result;
rollback;
