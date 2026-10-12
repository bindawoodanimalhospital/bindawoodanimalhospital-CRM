-- Role × permission matrix: every role tries every guarded action; the result must match the
-- permission matrix (role_permissions) exactly. One transaction, rolled back.
-- Each probe runs in its own sub-transaction and is undone right after (sentinel exception).
begin;

-- ---------------------------------------------------------------- one test user per role
create temp table r_users on commit drop as
select r.key as role_key, ('00000000-0000-0000-0000-0000000f' || lpad(row_number() over (order by r.key)::text, 4, '0'))::uuid as uid
from public.roles r;
insert into auth.users (id, email, instance_id, aud, role)
select uid, role_key || '@matrix.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated' from r_users;
update public.staff set is_active = true, full_name = 'Matrix ' || split_part(email, '@', 1) where email like '%@matrix.t.local';
insert into public.staff_roles (staff_id, role_id) select u.uid, r.id from r_users u join public.roles r on r.key = u.role_key;

create temp table fx (k text primary key, v uuid) on commit drop;
create temp table results (role_key text, probe text, perms text, expected boolean, actual boolean, detail text) on commit drop;
grant all on fx, results, r_users to authenticated;
create or replace function pg_temp.g(key text) returns uuid language sql stable as $$ select v from fx where k = key $$;
create or replace function pg_temp.act(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- ---------------------------------------------------------------- fixtures (created by the owner test user)
set local role authenticated;
select pg_temp.act((select uid from r_users where role_key = 'owner'));
insert into fx select 'owner', uid from r_users where role_key = 'owner';
with c as (insert into public.customers (full_name, house_no, address) values ('MX Owner', '1', 'Street 1') returning id) insert into fx select 'cust', id from c;
with c as (insert into public.customers (full_name) values ('MX Spare') returning id) insert into fx select 'cust2', id from c;
with p as (insert into public.pets (name, species_id) select 'MX Pet', id from public.species order by sort_order limit 1 returning id) insert into fx select 'pet', id from p;
insert into public.pet_owners (pet_id, customer_id, is_primary) values (pg_temp.g('pet'), pg_temp.g('cust'), true);
with v as (insert into public.visits (pet_id, customer_id) values (pg_temp.g('pet'), pg_temp.g('cust')) returning id) insert into fx select 'visit', id from v;
with c as (insert into public.consultations (visit_id, pet_id) values (pg_temp.g('visit'), pg_temp.g('pet')) returning id) insert into fx select 'cons', id from c;
with a as (insert into public.appointments (customer_id, pet_id, appointment_type_id, starts_at, ends_at)
  select pg_temp.g('cust'), pg_temp.g('pet'), id, now() + interval '1 day', now() + interval '1 day 15 min' from public.appointment_types limit 1 returning id) insert into fx select 'appt', id from a;
-- stock item with 100 in stock and a cost
with i as (insert into public.catalog_items (kind, name, unit, sale_price, is_retail) values ('product', 'MX Food', 'bag', 500, true) returning id) insert into fx select 'item', id from i;
insert into public.catalog_costs (item_id, cost_price) values (pg_temp.g('item'), 300);
with b as (insert into public.product_batches (item_id, location_id, batch_no) select pg_temp.g('item'), id, 'MX' from public.inventory_locations where is_default returning id) insert into fx select 'batch', id from b;
select public.adjust_stock(pg_temp.g('batch'), 100, 'adjust', 'matrix fixture');
update public.catalog_items set track_stock = true where id = pg_temp.g('item');
insert into fx select 'svc', id from public.catalog_items where name = 'Other charge';
-- bills: draft clinic, issued+paid clinic, issued unpaid clinic, store delivery (COD)
with i as (insert into public.invoices (customer_id) values (pg_temp.g('cust')) returning id) insert into fx select 'draft', id from i;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) values (pg_temp.g('draft'), pg_temp.g('svc'), 1, 1000);
with i as (insert into public.invoices (customer_id) values (pg_temp.g('cust')) returning id) insert into fx select 'paid', id from i;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) values (pg_temp.g('paid'), pg_temp.g('svc'), 1, 1000);
select public.checkout_invoice(pg_temp.g('paid'), '[{"method":"cash","amount":1000}]', null, 'mx-paid');
with i as (insert into public.invoices (customer_id) values (pg_temp.g('cust')) returning id) insert into fx select 'unpaid', id from i;
insert into public.invoice_items (invoice_id, item_id, quantity, unit_price) values (pg_temp.g('unpaid'), pg_temp.g('svc'), 1, 700);
select public.checkout_invoice(pg_temp.g('unpaid'), '[]', jsonb_build_object('promised_date', private.clinic_today() + 3, 'reason', 'matrix fixture'), 'mx-unpaid');
insert into fx select 'deliv', public.pos_checkout('mx-deliv', pg_temp.g('cust'), null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('item'), 'quantity', 1)),
  '[]', 0, null, jsonb_build_object('promised_date', private.clinic_today(), 'reason', 'Cash on delivery'), '{"address":"House 1"}');
-- loans, expense, task, message
with p as (insert into public.partner_businesses (name) values ('MX Clinic') returning id) insert into fx select 'partner', id from p;
insert into fx select 'loan', public.record_stock_loan('mx-loan', 'borrowed', pg_temp.g('partner'), jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('item'), 'qty', 2)));
with e as (insert into public.expenses (category_id, amount, method, description) select id, 100, 'cash', 'MX expense' from public.expense_categories limit 1 returning id) insert into fx select 'expense', id from e;
with t as (insert into public.tasks (title, assigned_to) values ('MX task', pg_temp.g('owner')) returning id) insert into fx select 'task', id from t;
with m as (insert into public.messages (customer_id, channel, body, created_by) values (pg_temp.g('cust'), 'whatsapp', 'MX message', pg_temp.g('owner')) returning id) insert into fx select 'msg', id from m;

-- lookup ids fetched once by the owner, so every probe inserts exactly one row (no silent 0-row inserts)
insert into fx select 'species', id from public.species order by sort_order limit 1;
insert into fx select 'appt_type', id from public.appointment_types order by sort_order limit 1;
insert into fx select 'vaccine', id from public.vaccines order by name limit 1;
insert into fx select 'dx_type', id from public.diagnostic_types order by sort_order limit 1;
insert into fx select 'exp_cat', id from public.expense_categories order by name limit 1;
insert into fx select 'owner_role', id from public.roles where key = 'owner';
insert into fx select 'intern_uid', uid from r_users where role_key = 'intern';

-- ---------------------------------------------------------------- probes
-- probe(name, permissions (any of), sql). Read probes raise NOT_VISIBLE when RLS hides the row.
create temp table probes (name text, perms text[], body text) on commit drop;
grant all on probes to authenticated;
insert into probes values
 ('customers: view',            '{customers.view}',        $q$ perform 1 from public.customers where id = pg_temp.g('cust'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('customers: create',          '{customers.create}',      $q$ insert into public.customers (full_name) values ('MX New'); $q$),
 ('customers: edit',            '{customers.edit}',        $q$ update public.customers set notes = 'x' where id = pg_temp.g('cust'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('customers: delete',          '{customers.delete}',      $q$ delete from public.customers where id = pg_temp.g('cust2'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('customers: merge',           '{customers.merge}',       $q$ perform public.merge_customers(pg_temp.g('cust2'), pg_temp.g('cust'), 'matrix'); $q$),
 ('pets: view',                 '{pets.view}',             $q$ perform 1 from public.pets where id = pg_temp.g('pet'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('pets: create',               '{pets.create}',           $q$ insert into public.pets (name, species_id) values ('MX P2', pg_temp.g('species')); $q$),
 ('appointments: view',         '{appointments.view}',     $q$ perform 1 from public.appointments where id = pg_temp.g('appt'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('appointments: book',         '{appointments.manage}',   $q$ insert into public.appointments (customer_id, appointment_type_id, starts_at, ends_at) values (pg_temp.g('cust'), pg_temp.g('appt_type'), now() + interval '2 day', now() + interval '2 day 10 min'); $q$),
 ('queue: check in',            '{queue.manage}',          $q$ insert into public.visits (pet_id, customer_id) values (pg_temp.g('pet'), pg_temp.g('cust')); $q$),
 ('visits: view',               '{queue.manage,appointments.view,clinical.view}', $q$ perform 1 from public.visits where id = pg_temp.g('visit'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('consultation: view',         '{clinical.view}',         $q$ perform 1 from public.consultations where id = pg_temp.g('cons'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('consultation: start',        '{clinical.create}',       $q$ insert into public.consultations (visit_id, pet_id) values (pg_temp.g('visit'), pg_temp.g('pet')); $q$),
 ('vaccination: record',        '{vaccinations.manage}',   $q$ insert into public.vaccinations (pet_id, vaccine_id, vaccine_name) values (pg_temp.g('pet'), pg_temp.g('vaccine'), 'MX vaccine'); $q$),
 ('prescription: write',        '{prescriptions.manage}',  $q$ insert into public.prescriptions (pet_id, visit_id) values (pg_temp.g('pet'), pg_temp.g('visit')); $q$),
 ('diagnostics: order',         '{diagnostics.manage}',    $q$ insert into public.diagnostic_orders (pet_id, type_id, visit_id) values (pg_temp.g('pet'), pg_temp.g('dx_type'), pg_temp.g('visit')); $q$),
 ('surgery: plan',              '{surgery.manage}',        $q$ insert into public.surgeries (pet_id, customer_id, procedure_name) values (pg_temp.g('pet'), pg_temp.g('cust'), 'MX spay'); $q$),
 ('ward: admit',                '{inpatient.manage}',      $q$ insert into public.admissions (pet_id, customer_id, reason) values (pg_temp.g('pet'), pg_temp.g('cust'), 'MX obs'); $q$),
 ('bills: view clinic bill',    '{billing.view}',          $q$ perform 1 from public.invoices where id = pg_temp.g('paid'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('bills: view store order',    '{billing.view,pos.use}',  $q$ perform 1 from public.invoices where id = pg_temp.g('deliv'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('bills: create clinic bill',  '{billing.create}',        $q$ insert into public.invoices (customer_id) values (pg_temp.g('cust')); $q$),
 ('bills: take payment',        '{billing.create}',        $q$ perform public.record_payment(pg_temp.g('cust'), 100, 'cash', 'mx-pay-' || gen_random_uuid(), pg_temp.g('unpaid'), null, false); $q$),
 ('bills: line discount',       '{billing.discount}',      $q$ if not private.has_permission('billing.create') then raise exception 'permission denied (no billing.create)' using errcode = '42501'; end if;
                                                              insert into public.invoice_items (invoice_id, item_id, quantity, unit_price, discount_amount) values (pg_temp.g('draft'), pg_temp.g('svc'), 1, 500, 50); $q$),
 ('bills: void',                '{billing.void}',          $q$ perform public.void_invoice(pg_temp.g('unpaid'), 'matrix'); $q$),
 ('bills: refund',              '{billing.refund}',        $q$ perform public.refund_payment(pg_temp.g('paid'), 100, 'cash', 'matrix', 'mx-ref-' || gen_random_uuid()); $q$),
 ('dues: view',                 '{billing.view,crm.manage}', $q$ perform 1 from public.dues where invoice_id = pg_temp.g('unpaid'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('dues: write off',            '{billing.discount_approve}', $q$ perform public.write_off_due((select id from public.dues where invoice_id = pg_temp.g('unpaid')), 'matrix', 'mx-wo-' || gen_random_uuid()); $q$),
 ('pet store: sell',            '{pos.use}',               $q$ perform public.pos_checkout('mx-sell-' || gen_random_uuid(), null, null, jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('item'), 'quantity', 1)), '[{"method":"cash","amount":500}]'); $q$),
 ('pet store: delivery update', '{pos.use,billing.create}', $q$ perform public.update_delivery(pg_temp.g('deliv'), 'dispatched'); $q$),
 ('pet store: return',          '{billing.refund,pos.return}', $q$ perform public.return_items(pg_temp.g('paid'), jsonb_build_array(jsonb_build_object('invoice_item_id', (select id from public.invoice_items where invoice_id = pg_temp.g('paid') limit 1), 'qty', 1)), 'matrix', 'cash', 'mx-ret-' || gen_random_uuid()); $q$),
 ('stock: adjust count',        '{inventory.adjust}',      $q$ perform public.adjust_stock(pg_temp.g('batch'), -1, 'wastage', 'matrix'); $q$),
 ('stock: price change',        '{inventory.manage,settings.manage}', $q$ update public.catalog_items set sale_price = 501 where id = pg_temp.g('item'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('stock: see cost prices',     '{inventory.view_cost}',   $q$ perform 1 from public.catalog_costs where item_id = pg_temp.g('item'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('stock: movement history',    '{inventory.view}',        $q$ perform 1 from public.inventory_movements where item_id = pg_temp.g('item'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('loans: view',                '{inventory.view}',        $q$ perform 1 from public.stock_loans where id = pg_temp.g('loan'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('loans: record',              '{inventory.manage}',      $q$ perform public.record_stock_loan('mx-l-' || gen_random_uuid(), 'lent', pg_temp.g('partner'), jsonb_build_array(jsonb_build_object('item_id', pg_temp.g('item'), 'qty', 1))); $q$),
 ('loans: return',              '{inventory.manage}',      $q$ perform public.record_stock_loan_return('mx-r-' || gen_random_uuid(), pg_temp.g('loan'), jsonb_build_array(jsonb_build_object('loan_line_id', (select id from public.stock_loan_lines where loan_id = pg_temp.g('loan')), 'qty', 1))); $q$),
 ('suppliers: add',             '{suppliers.manage}',      $q$ insert into public.suppliers (name) values ('MX Supplier ' || gen_random_uuid()); $q$),
 ('expenses: view',             '{expenses.view}',         $q$ perform 1 from public.expenses where id = pg_temp.g('expense'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('expenses: add',              '{expenses.manage}',       $q$ insert into public.expenses (category_id, amount, method, description) values (pg_temp.g('exp_cat'), 50, 'cash', 'MX exp2'); $q$),
 ('settings: change',           '{settings.manage}',       $q$ update public.system_settings set value = value where key = 'billing.config'; if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('history log: view',          '{audit.view}',            $q$ perform 1 from public.audit_logs limit 1; if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('reports: money',             '{reports.financial}',     $q$ perform public.report_financial(private.clinic_today() - 7, private.clinic_today()); $q$),
 ('reports: clinic activity',   '{reports.view,reports.financial}', $q$ perform public.report_operations(private.clinic_today() - 7, private.clinic_today()); $q$),
 ('reports: export',            '{data.export}',           $q$ perform public.log_export('customers', 1); $q$),
 ('messages: view',             '{crm.view}',              $q$ perform 1 from public.messages where id = pg_temp.g('msg'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('reminders: run now',         '{crm.manage,settings.manage}', $q$ perform public.run_reminders_now(); $q$),
 ('tasks: create',              '{tasks.manage}',          $q$ insert into public.tasks (title) values ('MX t2'); $q$),
 ('tasks: see others'' tasks',  '{tasks.view_all}',        $q$ perform 1 from public.tasks where id = pg_temp.g('task'); if not found then raise exception 'NOT_VISIBLE'; end if; $q$),
 ('staff: grant a role',        '{staff.manage}',          $q$ insert into public.staff_roles (staff_id, role_id) values (pg_temp.g('intern_uid'), pg_temp.g('owner_role')); $q$);

-- run every probe as every role (the owner is the reference user; tasks fixture is owner's own so skip that probe for owner)
do $$
declare u record; p record; ok boolean; err text; expected boolean;
begin
  for u in select * from r_users order by role_key loop
    perform pg_temp.act(u.uid);
    for p in select * from probes loop
      expected := exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id
                          where r.key = u.role_key and rp.permission_key = any (p.perms));
      if p.name = 'bills: line discount' then
        expected := expected and exists (select 1 from public.role_permissions rp join public.roles r on r.id = rp.role_id
                                         where r.key = u.role_key and rp.permission_key = 'billing.create');
      end if;
      if p.name = 'tasks: see others'' tasks' and u.role_key = 'owner' then continue; end if;
      begin
        execute 'do $b$ begin ' || p.body || ' raise exception ''PROBE_OK''; end $b$';
      exception when others then
        err := sqlerrm;
      end;
      ok := err = 'PROBE_OK';
      insert into results values (u.role_key, p.name, array_to_string(p.perms, ' | '), expected, ok, case when ok then null else left(err, 140) end);
      err := null;
    end loop;
  end loop;
end $$;

reset role;
-- mismatches = bugs (or a probe that failed for a non-permission reason — shown with its error)
select role_key, probe, perms, expected, actual, detail from results where expected <> actual order by probe, role_key;
select 'probes run' as t, count(*) as n, count(*) filter (where expected = actual) as matching, count(*) filter (where expected <> actual) as mismatching from results;
select probe, string_agg(role_key || ':' || case when actual then 'Y' else '-' end, ' ' order by role_key) as by_role from results group by probe order by probe;
rollback;
