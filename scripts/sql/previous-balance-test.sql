-- Previous balances from before the CRM (migration 050). Rolled back.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000ab101', 'pb-recep@pb.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000ab102', 'pb-store@pb.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000ab103', 'pb-owner@pb.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@pb.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000ab101', id from public.roles where key = 'reception';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000ab102', id from public.roles where key = 'store_staff';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000ab103', id from public.roles where key = 'owner';
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
create or replace function pg_temp.billed(d date) returns numeric language sql security definer as $$
  select (public.report_financial(d, d) -> 'billed' ->> 'gross')::numeric $$;
set local role authenticated;
select pg_temp.as_('00000000-0000-0000-0000-0000000ab101');
with c as (insert into public.customers (full_name) values ('PB Old Client') returning id) insert into fx select 'c', id from c;

-- Store staff can't record previous balances
select pg_temp.as_('00000000-0000-0000-0000-0000000ab102');
do $$ begin
  perform public.add_previous_balance(pg_temp.g('c'), 3000, date '2025-11-20', '412', null, 'pb-x');
  raise exception 'FAIL: store staff recorded a previous balance';
exception when insufficient_privilege then raise notice 'OK store staff cannot record previous balances'; end $$;

select pg_temp.as_('00000000-0000-0000-0000-0000000ab101');
select pg_temp.as_('00000000-0000-0000-0000-0000000ab103');
create temp table base on commit drop as select coalesce(pg_temp.billed(date '2025-11-20'), 0) b;
select pg_temp.as_('00000000-0000-0000-0000-0000000ab101');
-- Two old unpaid bills: Rs. 3,000 from 20 Nov 2025 (old bill 412) and Rs. 9,500 from 2 Mar 2026
insert into fx select 'pb1', public.add_previous_balance(pg_temp.g('c'), 3000, date '2025-11-20', '412', 'From the old register', 'pb-1');
insert into fx select 'pb2', public.add_previous_balance(pg_temp.g('c'), 9500, date '2026-03-02', null, null, 'pb-2');
select pg_temp.check(public.add_previous_balance(pg_temp.g('c'), 3000, date '2025-11-20', '412', null, 'pb-1') = pg_temp.g('pb1'), 'double tap records it once');
select pg_temp.check((select status = 'issued' and is_previous_balance and balance = 3000 and (issued_at at time zone 'Asia/Karachi')::date = date '2025-11-20'
  and previous_ref = '412' from public.invoices where id = pg_temp.g('pb1')), 'old bill: issued, owed, with its original date and old bill no.');
select pg_temp.check((select description = 'Previous balance from 20 Nov 2025 — old bill 412' from public.invoice_items where invoice_id = pg_temp.g('pb1')), 'line says where it came from');
select pg_temp.check((select count(*) = 2 and bool_and(approval_status = 'not_needed') from public.dues where invoice_id in (pg_temp.g('pb1'), pg_temp.g('pb2'))),
  'both show in Unpaid bills, no approval needed (even Rs. 9,500)');
select pg_temp.check((select sum(balance) = 12500 from public.invoices where customer_id = pg_temp.g('c') and status = 'issued'), 'client owes Rs. 12,500 in total');
do $$ begin
  perform public.add_previous_balance(pg_temp.g('c'), 500, private.clinic_today() + 1, null, null, 'pb-f');
  raise exception 'FAIL: future date accepted';
exception when others then perform pg_temp.check(sqlerrm like '%today or earlier%', 'no future dates'); end $$;
do $$ begin
  perform public.add_previous_balance(pg_temp.g('c'), 0, date '2025-01-01', null, null, 'pb-0');
  raise exception 'FAIL: zero accepted';
exception when others then perform pg_temp.check(sqlerrm like '%amount owed%', 'amount must be above zero'); end $$;

-- The "previous balance" item can't go on a normal bill
with b as (insert into public.invoices (customer_id) values (pg_temp.g('c')) returning id) insert into fx select 'new', id from b;
do $$ begin
  insert into public.invoice_items (invoice_id, item_id, quantity, unit_price)
  select pg_temp.g('new'), id, 1, 100 from public.catalog_items where system_role = 'previous_balance';
  raise exception 'FAIL: previous-balance item on a normal bill';
exception when others then perform pg_temp.check(sqlerrm like '%Account page%', 'previous-balance item refused on a normal bill'); end $$;

-- Today's visit bill Rs. 1,500, and the client pays Rs. 5,000 towards everything: oldest first
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price)
select pg_temp.g('new'), id, 1, 1500 from public.catalog_items where name = 'Other charge';
select public.checkout_invoice(pg_temp.g('new'), '[{"method":"cash","amount":1500}]', null, 'pb-new');
select public.record_payment(pg_temp.g('c'), 5000, 'cash', 'pb-pay', null, null, true);
select pg_temp.check((select balance = 0 from public.invoices where id = pg_temp.g('pb1')), 'payment clears the oldest previous balance first');
select pg_temp.check((select balance = 7500 from public.invoices where id = pg_temp.g('pb2')), '…then the next (Rs. 7,500 left)');

-- Reports: not counted as billed on the old date
select pg_temp.as_('00000000-0000-0000-0000-0000000ab103');
select pg_temp.check(coalesce(pg_temp.billed(date '2025-11-20'), 0) = (select b from base), 'previous balances are not counted as billed in reports');
reset role;
select 'ALL PREVIOUS-BALANCE CHECKS PASSED' as result;
rollback;
