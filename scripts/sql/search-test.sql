-- Smart search behaviour (rolled back). Every query must put the expected result first.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000cc001', 'search@s.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000cc005', 'search-store@s.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@s.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000cc001', id from public.roles where key = 'owner';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000cc005', id from public.roles where key = 'store_staff';
create temp table fx (k text primary key, v uuid) on commit drop;
create temp table res (q text, scope text, first_kind text, first_title text, first_badge text, n int) on commit drop;
grant all on fx, res to authenticated;
create or replace function pg_temp.g(key text) returns uuid language sql as $$ select v from fx where k = key $$;
create or replace function pg_temp.s(q text, sc text default 'all') returns void language sql as $$
  insert into res select q, sc, (array_agg(kind))[1], (array_agg(title))[1], (array_agg(badge))[1], count(*)::int from public.smart_search(q, sc, 30);
$$;
create or replace function pg_temp.expect(q text, kind text, title text, sc text default 'all') returns void language plpgsql as $$
declare r record;
begin
  select * into r from res where res.q = expect.q and res.scope = sc;
  if r.first_kind is distinct from kind or r.first_title is distinct from title then
    raise exception 'FAIL: "%" (%): expected % "%", got % "%"', q, sc, kind, title, r.first_kind, r.first_title;
  end if;
  raise notice 'OK % → % "%"%', rpad('"' || q || '"' || case when sc <> 'all' then ' (' || sc || ' tab)' else '' end, 30), kind, title, coalesce(' [' || r.first_badge || ']', '');
end $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000cc001","role":"authenticated"}', true);

with c as (insert into public.customers (full_name, full_name_ur, area) values ('Ahmed Raza', 'احمد رضا', 'Johar Town') returning id) insert into fx select 'ahmed', id from c;
insert into public.customer_contacts (customer_id, phone, email) values (pg_temp.g('ahmed'), '+923001234567', 'ahmed@example.com');
with c as (insert into public.customers (full_name, area) values ('Fatima Malik', 'DHA Phase 5') returning id) insert into fx select 'fatima', id from c;
insert into public.customer_contacts (customer_id, phone) values (pg_temp.g('fatima'), '+923217654321');
with p as (insert into public.pets (name, species_id, microchip_no, color) select 'Tiger', id, '985112003344556', 'golden' from public.species where name = 'Dog' returning id) insert into fx select 'tiger_dog', id from p;
with p as (insert into public.pets (name, species_id) select 'Tiger', id from public.species where name = 'Cat' returning id) insert into fx select 'tiger_cat', id from p;
with p as (insert into public.pets (name, species_id) select 'Snowy', id from public.species where name = 'Cat' returning id) insert into fx select 'snowy', id from p;
insert into public.pet_owners (pet_id, customer_id, is_primary) values
  (pg_temp.g('tiger_dog'), pg_temp.g('ahmed'), true), (pg_temp.g('snowy'), pg_temp.g('ahmed'), true), (pg_temp.g('tiger_cat'), pg_temp.g('fatima'), true);
insert into public.pet_alerts (pet_id, kind, label, severity) values (pg_temp.g('snowy'), 'allergy', 'Penicillin', 'critical');
with i as (insert into public.catalog_items (kind, name, category, unit, sale_price, is_retail, barcode) values ('product', 'Royal Canin Kitten 2kg', 'Cat food', 'bag', 4200, true, '3182550702447') returning id) insert into fx select 'rc', id from i;
with i as (insert into public.invoices (customer_id) values (pg_temp.g('fatima')) returning id) insert into fx select 'bill', id from i;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) select pg_temp.g('bill'), id, 1, 2500 from public.catalog_items where name = 'Other charge';
select public.checkout_invoice(pg_temp.g('bill'), '[{"method":"cash","amount":1000}]', jsonb_build_object('promised_date', private.clinic_today() + 3, 'reason', 'later'), 'srch-bill');
insert into public.visits (pet_id, customer_id) values (pg_temp.g('snowy'), pg_temp.g('ahmed'));

select pg_temp.s('ahmed');          select pg_temp.s('ahmad raza');      select pg_temp.s('احمد');
select pg_temp.s('0300-1234567');   select pg_temp.s('+92 300 1234567'); select pg_temp.s('923001234567');
select pg_temp.s('4567');           select pg_temp.s('johar');           select pg_temp.s('ahmed@example.com');
select pg_temp.s('tiger ahmed');    select pg_temp.s('tiger fatima');    select pg_temp.s('tigr ahmad');    select pg_temp.s('snowy');
select pg_temp.s('snowi');          select pg_temp.s('985112003344556'); select pg_temp.s('golden');
select pg_temp.s((select number from public.invoices where id = pg_temp.g('bill')));
select pg_temp.s(regexp_replace((select number from public.invoices where id = pg_temp.g('bill')), '^.*-0*', ''), 'bill');
select pg_temp.s('royal canin');    select pg_temp.s('3182550702447');   select pg_temp.s('kitten food');
select pg_temp.s('pet: tiger');     select pg_temp.s('owner: tiger');    select pg_temp.s('#' || (select token_no from public.visits where pet_id = pg_temp.g('snowy')));
select pg_temp.s((select code from public.pets where id = pg_temp.g('snowy')));
select pg_temp.s((select code from public.customers where id = pg_temp.g('fatima')));
select pg_temp.s('tiger', 'pet');

do $$ begin   -- real clients may also be called Ahmed: just make sure ours is found
  if not exists (select 1 from public.smart_search('ahmed') where kind = 'customer' and title = 'Ahmed Raza') then raise exception 'FAIL: "ahmed" did not find Ahmed Raza'; end if;
  raise notice 'OK "ahmed" finds Ahmed Raza';
end $$;
select pg_temp.expect('ahmad raza', 'customer', 'Ahmed Raza');
select pg_temp.expect('احمد', 'customer', 'Ahmed Raza');
select pg_temp.expect('0300-1234567', 'customer', 'Ahmed Raza');
select pg_temp.expect('+92 300 1234567', 'customer', 'Ahmed Raza');
select pg_temp.expect('923001234567', 'customer', 'Ahmed Raza');
select pg_temp.expect('4567', 'customer', 'Ahmed Raza');
select pg_temp.expect('johar', 'customer', 'Ahmed Raza');
select pg_temp.expect('ahmed@example.com', 'customer', 'Ahmed Raza');
select pg_temp.expect('tiger ahmed', 'pet', 'Tiger');
select pg_temp.expect('tigr ahmad', 'pet', 'Tiger');
select pg_temp.expect('snowy', 'pet', 'Snowy');
select pg_temp.expect('snowi', 'pet', 'Snowy');
select pg_temp.expect('985112003344556', 'pet', 'Tiger');
select pg_temp.expect('golden', 'pet', 'Tiger');
select pg_temp.expect((select number from public.invoices where id = pg_temp.g('bill')), 'bill', 'Fatima Malik');
select pg_temp.expect(regexp_replace((select number from public.invoices where id = pg_temp.g('bill')), '^.*-0*', ''), 'bill', 'Fatima Malik', 'bill');
select pg_temp.expect('royal canin', 'item', 'Royal Canin Kitten 2kg');
select pg_temp.expect('3182550702447', 'item', 'Royal Canin Kitten 2kg');
-- real price-list items may also match "kitten food", so check it is found rather than first
do $$ begin
  if not exists (select 1 from public.smart_search('kitten food') where kind = 'item' and title = 'Royal Canin Kitten 2kg') then
    raise exception 'FAIL: "kitten food" should find Royal Canin Kitten 2kg'; end if;
  raise notice 'OK "kitten food" finds Royal Canin Kitten 2kg';
end $$;
select pg_temp.expect('pet: tiger', 'pet', 'Tiger');
select pg_temp.expect('#' || (select token_no from public.visits where pet_id = pg_temp.g('snowy')), 'visit', 'Snowy');
select pg_temp.expect((select code from public.pets where id = pg_temp.g('snowy')), 'pet', 'Snowy');
select pg_temp.expect((select code from public.customers where id = pg_temp.g('fatima')), 'customer', 'Fatima Malik');

-- details that must be right
select pg_temp.expect('tiger fatima', 'pet', 'Tiger');
do $$ begin
  if (select count(*) from public.smart_search('tiger fatima') where kind = 'pet' and id = pg_temp.g('tiger_dog')) > 0
     and (select rank from public.smart_search('tiger fatima') where id = pg_temp.g('tiger_dog')) >= (select rank from public.smart_search('tiger fatima') where id = pg_temp.g('tiger_cat'))
  then raise exception 'FAIL: "tiger fatima" should rank Fatima''s cat above Ahmed''s dog'; end if;
  raise notice 'OK "tiger fatima" ranks Fatima''s Tiger first';
  if (select first_badge from res where q = 'snowy') is distinct from 'Alert' then raise exception 'FAIL: Snowy should carry an Alert badge'; end if;
  raise notice 'OK Snowy shows the allergy Alert badge';
  if (select first_badge from res where q = (select number from public.invoices where id = pg_temp.g('bill'))) not like 'Owes Rs. 1,500' then raise exception 'FAIL: bill badge'; end if;
  raise notice 'OK bill shows "Owes Rs. 1,500"';
  if exists (select 1 from public.smart_search('owner: tiger') where kind <> 'customer') then raise exception 'FAIL: owner: scope leaked other kinds'; end if;
  raise notice 'OK "owner: tiger" returns owners only';
  if exists (select 1 from public.smart_search('tiger', 'pet') where kind <> 'pet') then raise exception 'FAIL: pet scope'; end if;
  raise notice 'OK scope "pet" returns pets only';
  if (select count(*) from public.smart_search(repeat('x', 5000))) <> 0 then raise exception 'FAIL: huge input'; end if;
  raise notice 'OK 5,000-character input is trimmed and harmless';
end $$;

-- permissions: store staff search never shows clinic bills
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000cc005","role":"authenticated"}', true);
do $$ begin
  if exists (select 1 from public.smart_search((select number from public.invoices where customer_id = pg_temp.g('fatima') limit 1)) where kind = 'bill')
  then raise exception 'FAIL: store staff can find a clinic bill'; end if;
  raise notice 'OK store staff can''t find clinic bills (permissions respected)';
end $$;
reset role;
select q, scope, first_kind, first_title, first_badge, n from res order by q;
select 'ALL SEARCH CHECKS PASSED' as result;
rollback;
