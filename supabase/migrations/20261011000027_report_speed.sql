-- =============================================================================
-- Report speed at real-world volume.
-- Pressure test with a year of data (10,000 bills, 10,000 stock movements): the 12-month money report
-- took ~50 s, far over the 8 s request limit, so it would fail in the app.
--  1) private.pk_date() / private.bucket() are pure date helpers over built-ins; their SET search_path
--     stopped PostgreSQL from inlining them, so they ran as a function call per row (~60 µs each).
--     They are invoker-rights, immutable, in the private schema (not exposed by the API) — safe to inline.
--  2) report_financial: chart series computed with one grouped pass per source (was a rescan per week),
--     and stock cost via joins instead of per-row security-definer calls. Same numbers — verified by
--     comparing the report output before/after for several ranges.
-- =============================================================================

create or replace function private.pk_date(ts timestamptz)
returns date language sql immutable parallel safe as $$
  select (ts at time zone 'Asia/Karachi')::date;
$$;

create or replace function private.bucket(p_grain text, p_day date)
returns date language sql immutable parallel safe as $$
  select date_trunc(p_grain, p_day::timestamp)::date;
$$;

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
    from public.invoices where status = 'issued' and private.pk_date(issued_at) between p_from and p_to;
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
     where i.status = 'issued' and private.pk_date(i.issued_at) between p_from and p_to)
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
