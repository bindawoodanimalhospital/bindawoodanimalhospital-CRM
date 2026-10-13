-- =============================================================================
-- Previous balances from before the CRM (the clinic has run for 2 years on paper).
--  * Each old unpaid bill / balance is recorded on the pet owner's account with its original
--    date and old bill number: it becomes an issued "previous balance" bill, so it is owed,
--    shows in Unpaid bills and the owner's account, gets reminders, and payments clear it
--    (oldest first) exactly like any other bill.
--  * It is NOT counted as money billed in reports (it wasn't billed in the CRM); payments
--    received against it are counted as collected.
--  * The "Previous balance" price-list item can only be used for these bills.
-- =============================================================================
alter table public.catalog_items drop constraint catalog_items_system_role_check;
alter table public.catalog_items add constraint catalog_items_system_role_check
  check (system_role = any (array['delivery_charge', 'home_visit_charge', 'previous_balance']));
insert into public.catalog_items (kind, name, category, unit, sale_price, price_is_editable, track_stock, is_retail, system_role, notes)
values ('service', 'Previous balance (before CRM)', 'Account', 'bill', 0, true, false, false, 'previous_balance',
        'Used only for balances owed from before the CRM. Added from the pet owner''s Account page.');

alter table public.invoices add column is_previous_balance boolean not null default false,
  add column previous_ref text;
comment on column public.invoices.is_previous_balance is 'A balance owed from before the CRM, recorded with its original date.';

create or replace function private.previous_balance_line_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare role text; prev boolean;
begin
  select system_role into role from public.catalog_items where id = new.item_id;
  select is_previous_balance into prev from public.invoices where id = new.invoice_id;
  if coalesce(role = 'previous_balance', false) <> coalesce(prev, false) then
    raise exception 'a previous balance is recorded from the pet owner''s Account page, not on a normal bill';
  end if;
  return new;
end $$;
create trigger invoice_items_previous_balance before insert or update of item_id on public.invoice_items
  for each row execute function private.previous_balance_line_guard();

create or replace function public.add_previous_balance(p_customer uuid, p_amount numeric, p_date date,
  p_ref text default null, p_note text default null, p_key text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_item uuid; v_label text;
begin
  if not private.has_permission('billing.create') then raise exception 'permission denied: billing.create' using errcode = '42501'; end if;
  if coalesce(trim(p_key), '') = '' then raise exception 'missing idempotency key'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bdah-idem:' || p_key, 0));
  select id into v_id from public.invoices where idempotency_key = p_key;
  if found then return v_id; end if;                                     -- double tap → same record
  if not exists (select 1 from public.customers where id = p_customer and status <> 'merged') then raise exception 'pet owner not found'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'enter the amount owed'; end if;
  if p_date is null or p_date > private.clinic_today() then raise exception 'the date must be today or earlier'; end if;
  if p_date < date '2015-01-01' then raise exception 'check the date'; end if;

  select id into v_item from public.catalog_items where system_role = 'previous_balance';
  v_label := 'Previous balance from ' || to_char(p_date, 'DD Mon YYYY') || coalesce(' — old bill ' || nullif(trim(p_ref), ''), '');
  insert into public.invoices (kind, customer_id, is_previous_balance, previous_ref, notes)
  values ('clinic', p_customer, true, nullif(trim(p_ref), ''), nullif(trim(p_note), ''))
  returning id into v_id;
  insert into public.invoice_items (invoice_id, item_id, quantity, unit_price, description)
  values (v_id, v_item, 1, round(p_amount, 2), v_label);
  perform public.issue_invoice(v_id, 0, jsonb_build_object('promised_date', private.clinic_today() + 7, 'reason', v_label));

  perform set_config('bdah.billing', 'on', true);
  update public.invoices set issued_at = (p_date + time '12:00') at time zone 'Asia/Karachi', idempotency_key = p_key where id = v_id;
  perform set_config('bdah.billing', '', true);
  -- An old debt is a fact, not a new credit decision: no approval needed.
  update public.dues set approval_status = 'not_needed', approved_by = null, approved_at = null where invoice_id = v_id;
  return v_id;
end $$;
revoke execute on function public.add_previous_balance(uuid, numeric, date, text, text, text) from public, anon;
grant execute on function public.add_previous_balance(uuid, numeric, date, text, text, text) to authenticated;

-- Reports: previous balances are not new billing.
CREATE OR REPLACE FUNCTION public.report_financial(p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  grain    text := private.report_guard(private.has_permission('reports.financial'), 'reports.financial', p_from, p_to);
  see_cost boolean := private.has_permission('inventory.view_cost');
  today    date := private.clinic_today();
  billed numeric; returns_amt numeric; discounts numeric; bills int; voided int;
  received numeric; refunded numeric; written_off numeric; payments_n int;
  expenses_amt numeric; cogs numeric; wastage numeric; unknown_cost int;
  visits_billed int; visit_billed_amt numeric;
  res jsonb;
begin
  select coalesce(sum(total), 0), coalesce(sum(line_discounts + invoice_discount), 0), count(*),
         count(distinct visit_id), coalesce(sum(total) filter (where visit_id is not null), 0)
    into billed, discounts, bills, visits_billed, visit_billed_amt
    from public.invoices where status = 'issued' and not is_previous_balance and private.pk_date(issued_at) between p_from and p_to;
  select count(*) into voided from public.invoices where status = 'void' and private.pk_date(voided_at) between p_from and p_to;
  select coalesce(sum(r.amount), 0) into returns_amt from public.invoice_returns r where private.pk_date(r.created_at) between p_from and p_to;
  select coalesce(sum(amount) filter (where kind = 'payment'), 0), coalesce(sum(amount) filter (where kind = 'refund'), 0),
         coalesce(sum(amount) filter (where kind = 'write_off'), 0), count(*) filter (where kind = 'payment')
    into received, refunded, written_off, payments_n
    from public.payments where private.pk_date(received_at) between p_from and p_to;
  select coalesce(sum(amount), 0) into expenses_amt from public.expenses where spent_on between p_from and p_to;

  if see_cost then
    -- Same rules as private.unit_cost() / private.is_usage_movement(), written as joins (one pass, no per-row calls).
    select coalesce(sum(-m.qty * coalesce(bc.unit_cost, cc.cost_price)), 0),
           count(distinct m.item_id) filter (where coalesce(bc.unit_cost, cc.cost_price) is null)
      into cogs, unknown_cost
      from public.inventory_movements m
      left join public.batch_costs bc on bc.batch_id = m.batch_id
      left join public.catalog_costs cc on cc.item_id = m.item_id
     where private.pk_date(m.created_at) between p_from and p_to
       and (m.kind in ('sale', 'dispense', 'surgery_use', 'return_in')
            or (m.kind = 'reversal' and exists (select 1 from public.inventory_movements o
                  where o.ref_table = m.ref_table and o.ref_id = m.ref_id and o.kind in ('sale', 'dispense', 'surgery_use'))));
    select coalesce(sum(-m.qty * coalesce(bc.unit_cost, cc.cost_price)), 0) into wastage
      from public.inventory_movements m
      left join public.batch_costs bc on bc.batch_id = m.batch_id
      left join public.catalog_costs cc on cc.item_id = m.item_id
     where private.pk_date(m.created_at) between p_from and p_to
       and (m.kind in ('wastage', 'expired') or (m.kind = 'adjust' and m.qty < 0));
  end if;

  with rpt_inv as (
    select i.id, private.pk_date(i.issued_at) d, i.kind, i.customer_id, i.pet_id, i.visit_id, i.surgery_id, i.admission_id, i.total
      from public.invoices i
     where i.status = 'issued' and not i.is_previous_balance and private.pk_date(i.issued_at) between p_from and p_to)
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'grain', grain, 'days', p_to - p_from + 1),
    'billed', jsonb_build_object(
      'gross', billed, 'returns', returns_amt, 'net', billed - returns_amt, 'discounts', discounts,
      'bills', bills, 'voided_bills', voided,
      'average_bill', case when bills > 0 then round(billed / bills, 0) end,
      'average_per_visit', case when visits_billed > 0 then round(visit_billed_amt / visits_billed, 0) end,
      'clinic', (select coalesce(sum(total), 0) from rpt_inv where kind = 'clinic'),
      'store',  (select coalesce(sum(total), 0) from rpt_inv where kind = 'store')),
    'collected', jsonb_build_object(
      'received', received, 'refunded', refunded, 'net', received - refunded, 'payments', payments_n,
      'written_off', written_off,
      'by_method', coalesce((
        select jsonb_agg(jsonb_build_object('method', pm.label, 'amount', x.amt, 'count', x.n) order by x.amt desc)
          from (select method, sum(amount) amt, count(*) n from public.payments
                 where kind = 'payment' and private.pk_date(received_at) between p_from and p_to group by method) x
          join public.payment_methods pm on pm.key = x.method), '[]'::jsonb)),
    -- Owed is a snapshot as of now (not limited to the range).
    'owed', (
      select jsonb_build_object(
        'total', coalesce(sum(balance), 0), 'bills', count(*), 'customers', count(distinct customer_id),
        'aging', jsonb_build_array(
          jsonb_build_object('label', '0–30 days',  'amount', coalesce(sum(balance) filter (where today - private.pk_date(issued_at) <= 30), 0)),
          jsonb_build_object('label', '31–60 days', 'amount', coalesce(sum(balance) filter (where today - private.pk_date(issued_at) between 31 and 60), 0)),
          jsonb_build_object('label', '61–90 days', 'amount', coalesce(sum(balance) filter (where today - private.pk_date(issued_at) between 61 and 90), 0)),
          jsonb_build_object('label', 'Over 90 days', 'amount', coalesce(sum(balance) filter (where today - private.pk_date(issued_at) > 90), 0))),
        'overdue_promises', (select count(*) from public.dues where status = 'open' and promised_date < today),
        'credit_held', (select coalesce(-sum(balance), 0) from public.customer_balances where balance < 0))
        from public.invoices where status = 'issued' and balance > 0),
    'expenses', jsonb_build_object(
      'total', expenses_amt,
      'by_category', coalesce((
        select jsonb_agg(jsonb_build_object('label', c.name, 'amount', x.amt) order by x.amt desc)
          from (select category_id, sum(amount) amt from public.expenses where spent_on between p_from and p_to
                 group by category_id having sum(amount) <> 0) x
          join public.expense_categories c on c.id = x.category_id), '[]'::jsonb)),
    'estimate', case when see_cost then jsonb_build_object(
        'stock_cost', round(cogs, 0), 'wastage_cost', round(wastage, 0), 'items_without_cost', unknown_cost,
        'gross_margin', round(billed - returns_amt - cogs, 0),
        'profit', round(billed - returns_amt - cogs - wastage - expenses_amt, 0)) end,
    'series', (
      select jsonb_agg(jsonb_build_object('bucket', b.bucket,
               'billed', coalesce(sb.amt, 0), 'collected', coalesce(sc.amt, 0), 'expenses', coalesce(se.amt, 0))
             order by b.bucket)
        from private.report_buckets(grain, p_from, p_to) b
        left join (select private.bucket(grain, d) bk, sum(total) amt from rpt_inv group by 1) sb on sb.bk = b.bucket
        left join (select private.bucket(grain, private.pk_date(received_at)) bk, sum(case when kind = 'refund' then -amount else amount end) amt
                     from public.payments where kind in ('payment', 'refund') and private.pk_date(received_at) between p_from and p_to group by 1) sc on sc.bk = b.bucket
        left join (select private.bucket(grain, spent_on) bk, sum(amount) amt
                     from public.expenses where spent_on between p_from and p_to group by 1) se on se.bk = b.bucket),
    -- Line totals are before bill-level discounts; those are reported separately above.
    'by_category', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'kind', kind, 'amount', amt, 'lines', n) order by amt desc)
        from (select coalesce(nullif(trim(ci.category), ''), case when it.kind = 'service' then 'Other services' else 'Other products' end) label,
                     it.kind::text kind, sum(it.line_total) amt, count(*) n
                from public.invoice_items it join rpt_inv i on i.id = it.invoice_id
                join public.catalog_items ci on ci.id = it.item_id
               group by 1, 2) x), '[]'::jsonb),
    'top_items', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'kind', kind, 'amount', amt, 'qty', qty) order by amt desc)
        from (select ci.name label, ci.kind::text kind, sum(it.line_total) amt, sum(it.quantity) qty
                from public.invoice_items it join rpt_inv i on i.id = it.invoice_id
                join public.catalog_items ci on ci.id = it.item_id
               group by ci.id order by 3 desc limit 12) x), '[]'::jsonb),
    'by_doctor', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'amount', amt, 'bills', n) order by amt desc)
        from (select coalesce(nullif(s.display_name, ''), s.full_name,
                              case when i.kind = 'store' then 'Pet store' else 'No doctor recorded' end) label,
                     sum(i.total) amt, count(*) n
                from rpt_inv i
                left join public.visits v on v.id = i.visit_id
                left join public.surgeries su on su.id = i.surgery_id
                left join public.admissions a on a.id = i.admission_id
                left join public.staff s on s.id = coalesce(v.doctor_id, su.surgeon_id, a.attending_doctor_id)
               group by 1) x), '[]'::jsonb),
    'by_species', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'amount', amt, 'bills', n) order by amt desc)
        from (select coalesce(sp.name, 'No pet (walk-in sale)') label, sum(i.total) amt, count(*) n
                from rpt_inv i left join public.pets p on p.id = i.pet_id left join public.species sp on sp.id = p.species_id
               group by 1) x), '[]'::jsonb),
    'top_customers', coalesce((
      select jsonb_agg(jsonb_build_object('id', c.id, 'label', c.full_name, 'amount', x.amt, 'bills', x.n) order by x.amt desc)
        from (select customer_id, sum(total) amt, count(*) n from rpt_inv where customer_id is not null
               group by customer_id order by 2 desc limit 10) x
        join public.customers c on c.id = x.customer_id), '[]'::jsonb),
    -- Rough customer value: last 12 months, customers with at least one bill.
    'customer_value', (
      select jsonb_build_object(
        'active_customers', count(*),
        'average_yearly_spend', case when count(*) > 0 then round(avg(amt), 0) end,
        'average_bills_per_year', case when count(*) > 0 then round(avg(n), 1) end)
        from (select customer_id, sum(total) amt, count(*) n from public.invoices
               where status = 'issued' and customer_id is not null and private.pk_date(issued_at) > today - 365
               group by customer_id) x)) into res;
  return res;
end $function$;
