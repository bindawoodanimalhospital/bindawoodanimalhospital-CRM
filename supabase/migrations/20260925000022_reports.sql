-- =============================================================================
-- Phase 6: reports & analytics (spec §26, §41)
--
-- Rules:
--  * Every money figure says what it is: BILLED (bills issued), COLLECTED (cash
--    actually received, net of refunds), OWED (still outstanding) and ESTIMATED
--    profit (only where purchase costs are known, and always labelled estimate).
--  * Reports return aggregates only — never raw rows. Money reports need
--    reports.financial; cost/margin figures additionally need inventory.view_cost
--    and come back as null without it.
--  * All day boundaries are clinic days (Asia/Karachi).
--  * Exports go through log_export() so every export is in the audit trail.
-- =============================================================================

-- Clinic-day of a timestamp.
create or replace function private.pk_date(ts timestamptz)
returns date language sql immutable set search_path = '' as $$
  select (ts at time zone 'Asia/Karachi')::date;
$$;

-- Permission + range check; returns the series grain for the range.
create or replace function private.report_guard(p_ok boolean, p_perm text, p_from date, p_to date)
returns text language plpgsql stable set search_path = '' as $$
begin
  if not coalesce(p_ok, false) then
    raise exception 'permission denied: %', p_perm using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'choose a valid date range' using errcode = '22023';
  end if;
  if p_to - p_from > 1100 then
    raise exception 'the date range can be at most 3 years' using errcode = '22023';
  end if;
  return case when p_to - p_from <= 62 then 'day' when p_to - p_from <= 370 then 'week' else 'month' end;
end $$;

-- Start of the bucket a clinic day falls in (Monday weeks, calendar months).
create or replace function private.bucket(p_grain text, p_day date)
returns date language sql immutable set search_path = '' as $$
  select date_trunc(p_grain, p_day::timestamp)::date;
$$;

-- Empty buckets for a range, so charts show zero days instead of skipping them.
create or replace function private.report_buckets(p_grain text, p_from date, p_to date)
returns table (bucket date) language sql immutable set search_path = '' as $$
  select g::date from generate_series(date_trunc(p_grain, p_from::timestamp), p_to::timestamp, ('1 ' || p_grain)::interval) g;
$$;

-- Estimated unit cost of a batch: the batch's own purchase cost, else the item's agreed cost.
create or replace function private.unit_cost(p_batch uuid, p_item uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select unit_cost from public.batch_costs where batch_id = p_batch),
                  (select cost_price from public.catalog_costs where item_id = p_item));
$$;

-- Stock movements that are "used for patients / sold" (and their undo rows).
create or replace function private.is_usage_movement(p_kind public.movement_kind, p_ref_table text, p_ref_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_kind in ('sale', 'dispense', 'surgery_use', 'return_in')
      or (p_kind = 'reversal' and exists (
            select 1 from public.inventory_movements o
             where o.ref_table = p_ref_table and o.ref_id = p_ref_id and o.kind in ('sale', 'dispense', 'surgery_use')));
$$;

-- =============================================================================
-- Money
-- =============================================================================
create or replace function public.report_financial(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
    select coalesce(sum(-m.qty * private.unit_cost(m.batch_id, m.item_id)), 0),
           count(distinct m.item_id) filter (where private.unit_cost(m.batch_id, m.item_id) is null)
      into cogs, unknown_cost
      from public.inventory_movements m
     where private.pk_date(m.created_at) between p_from and p_to and private.is_usage_movement(m.kind, m.ref_table, m.ref_id);
    select coalesce(sum(-m.qty * private.unit_cost(m.batch_id, m.item_id)), 0) into wastage
      from public.inventory_movements m
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
               'billed', coalesce((select sum(total) from rpt_inv where private.bucket(grain, d) = b.bucket), 0),
               'collected', coalesce((select sum(case when kind = 'refund' then -amount else amount end) from public.payments
                                       where kind in ('payment', 'refund') and private.pk_date(received_at) between p_from and p_to
                                         and private.bucket(grain, private.pk_date(received_at)) = b.bucket), 0),
               'expenses', coalesce((select sum(amount) from public.expenses
                                      where spent_on between p_from and p_to and private.bucket(grain, spent_on) = b.bucket), 0))
             order by b.bucket)
        from private.report_buckets(grain, p_from, p_to) b),
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
end $$;

-- =============================================================================
-- Clinic activity (no money)
-- =============================================================================
create or replace function public.report_operations(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  grain text := private.report_guard(private.has_permission('reports.view') or private.has_permission('reports.financial'),
                                     'reports.view', p_from, p_to);
  today date := private.clinic_today();
  res jsonb;
begin
  with rpt_vis as (select * from public.visits where visit_date between p_from and p_to)
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'grain', grain, 'days', p_to - p_from + 1),
    'visits', (
      select jsonb_build_object(
        'total', count(*) filter (where status <> 'cancelled'),
        'completed', count(*) filter (where status = 'completed'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'urgent', count(*) filter (where priority in ('urgent', 'emergency') and status <> 'cancelled'),
        'pets', count(distinct pet_id) filter (where status <> 'cancelled'),
        'per_day', round(count(*) filter (where status <> 'cancelled')::numeric / (p_to - p_from + 1), 1),
        'median_wait_min', round((percentile_cont(0.5) within group (order by extract(epoch from started_at - checked_in_at) / 60)
                                   filter (where started_at is not null and started_at >= checked_in_at))::numeric, 0),
        'median_visit_min', round((percentile_cont(0.5) within group (order by extract(epoch from completed_at - started_at) / 60)
                                   filter (where completed_at is not null and started_at is not null and completed_at >= started_at))::numeric, 0))
        from rpt_vis),
    'series', (
      select jsonb_agg(jsonb_build_object('bucket', b.bucket,
               'visits', (select count(*) from rpt_vis where status <> 'cancelled' and private.bucket(grain, visit_date) = b.bucket))
             order by b.bucket)
        from private.report_buckets(grain, p_from, p_to) b),
    -- Check-ins by weekday (1 = Monday) × hour, clinic time.
    'peak_hours', coalesce((
      select jsonb_agg(jsonb_build_object('dow', dow, 'hour', hr, 'visits', n))
        from (select extract(isodow from checked_in_at at time zone 'Asia/Karachi')::int dow,
                     extract(hour from checked_in_at at time zone 'Asia/Karachi')::int hr, count(*) n
                from rpt_vis where status <> 'cancelled' group by 1, 2) x), '[]'::jsonb),
    'by_doctor', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'visits', n, 'completed', done, 'median_visit_min', med) order by n desc)
        from (select coalesce(nullif(s.display_name, ''), s.full_name, 'Not assigned') label, count(*) n,
                     count(*) filter (where v.status = 'completed') done,
                     round((percentile_cont(0.5) within group (order by extract(epoch from v.completed_at - v.started_at) / 60)
                            filter (where v.completed_at >= v.started_at))::numeric, 0) med
                from rpt_vis v left join public.staff s on s.id = v.doctor_id
               where v.status <> 'cancelled' group by 1) x), '[]'::jsonb),
    'by_type', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'visits', n) order by n desc)
        from (select coalesce(t.name, 'Walk-in') label, count(*) n
                from rpt_vis v left join public.appointment_types t on t.id = v.visit_type_id
               where v.status <> 'cancelled' group by 1) x), '[]'::jsonb),
    'by_species', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'pets', n) order by n desc)
        from (select sp.name label, count(distinct v.pet_id) n
                from rpt_vis v join public.pets p on p.id = v.pet_id join public.species sp on sp.id = p.species_id
               where v.status <> 'cancelled' group by 1) x), '[]'::jsonb),
    'customers', (
      with seen as (select distinct customer_id from rpt_vis where status <> 'cancelled'),
           firsts as (select s.customer_id,
                             (select min(v.visit_date) from public.visits v where v.customer_id = s.customer_id and v.status <> 'cancelled') first_visit
                        from seen s)
      select jsonb_build_object(
        'seen', count(*),
        'new', count(*) filter (where first_visit >= p_from),
        'returning', count(*) filter (where first_visit < p_from),
        'registered', (select count(*) from public.customers where status <> 'merged' and private.pk_date(created_at) between p_from and p_to),
        'lapsed', (select count(*) from (
                     select v.customer_id from public.visits v join public.customers c on c.id = v.customer_id and c.status = 'active'
                      where v.status <> 'cancelled' group by v.customer_id
                     having max(v.visit_date) between today - 540 and today - 180) l),
        'referrals', coalesce((
          select jsonb_agg(jsonb_build_object('label', label, 'customers', n) order by n desc)
            from (select coalesce(nullif(trim(referral_source), ''), 'Not recorded') label, count(*) n from public.customers
                   where status <> 'merged' and private.pk_date(created_at) between p_from and p_to group by 1) r), '[]'::jsonb))
        from firsts),
    'appointments', (
      select jsonb_build_object(
        'total', count(*),
        'completed', count(*) filter (where status in ('arrived', 'completed')),
        'no_show', count(*) filter (where status = 'no_show'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        -- No-show rate: of bookings whose time has passed and that weren't cancelled.
        'no_show_rate', round(100.0 * count(*) filter (where status = 'no_show')
                        / nullif(count(*) filter (where status <> 'cancelled' and starts_at < now()), 0), 1),
        'cancel_rate', round(100.0 * count(*) filter (where status = 'cancelled') / nullif(count(*), 0), 1),
        'by_source', coalesce((
          select jsonb_agg(jsonb_build_object('label', src, 'appointments', n) order by n desc)
            from (select source::text src, count(*) n from public.appointments
                   where private.pk_date(starts_at) between p_from and p_to group by 1) s), '[]'::jsonb))
        from public.appointments where private.pk_date(starts_at) between p_from and p_to),
    'vaccinations', jsonb_build_object(
      'doses', (select count(*) from public.vaccinations where voided_at is null and private.pk_date(administered_at) between p_from and p_to),
      'by_vaccine', coalesce((
        select jsonb_agg(jsonb_build_object('label', vaccine_name, 'doses', n) order by n desc)
          from (select vaccine_name, count(*) n from public.vaccinations
                 where voided_at is null and private.pk_date(administered_at) between p_from and p_to
                 group by 1 order by 2 desc limit 10) x), '[]'::jsonb),
      -- Of vaccinations that fell due in the range (cancelled ones don't count).
      'due', (select jsonb_build_object(
                'total', count(*) filter (where status <> 'cancelled'),
                'done', count(*) filter (where status = 'done'),
                'done_on_time', count(*) filter (where status = 'done' and private.pk_date(completed_at) <= due_on + 7),
                'skipped', count(*) filter (where status = 'skipped'),
                'still_pending', count(*) filter (where status = 'pending'),
                'completion_rate', round(100.0 * count(*) filter (where status = 'done') / nullif(count(*) filter (where status <> 'cancelled'), 0), 1))
                from public.due_items where kind = 'vaccination' and due_on between p_from and p_to),
      'overdue_now', (select count(*) from public.due_items d join public.pets p on p.id = d.pet_id and p.status = 'active'
                       where d.kind = 'vaccination' and d.status = 'pending' and d.due_on < today),
      'overdue_pets', (select count(distinct d.pet_id) from public.due_items d join public.pets p on p.id = d.pet_id and p.status = 'active'
                        where d.kind = 'vaccination' and d.status = 'pending' and d.due_on < today)),
    'surgery', (
      select jsonb_build_object(
        'total', count(*) filter (where status <> 'cancelled'),
        'completed', count(*) filter (where status = 'discharged'),
        'cancelled', count(*) filter (where status = 'cancelled'),
        'emergency', count(*) filter (where urgency = 'emergency' and status <> 'cancelled'),
        'by_procedure', coalesce((
          select jsonb_agg(jsonb_build_object('label', procedure_name, 'surgeries', n) order by n desc)
            from (select procedure_name, count(*) n from public.surgeries
                   where status <> 'cancelled' and private.pk_date(coalesce(scheduled_at, created_at)) between p_from and p_to
                   group by 1 order by 2 desc limit 8) x), '[]'::jsonb))
        from public.surgeries where private.pk_date(coalesce(scheduled_at, created_at)) between p_from and p_to),
    'diagnostics', (
      select jsonb_build_object(
        'total', count(*) filter (where o.status <> 'cancelled'),
        'resulted', count(*) filter (where o.status in ('resulted', 'reviewed')),
        'by_category', coalesce((
          select jsonb_agg(jsonb_build_object('label', cat, 'tests', n) order by n desc)
            from (select t.category::text cat, count(*) n from public.diagnostic_orders d join public.diagnostic_types t on t.id = d.type_id
                   where d.status <> 'cancelled' and private.pk_date(d.created_at) between p_from and p_to group by 1) x), '[]'::jsonb))
        from public.diagnostic_orders o where private.pk_date(o.created_at) between p_from and p_to),
    'ward', (
      select jsonb_build_object(
        'admissions', count(*) filter (where status <> 'cancelled'),
        'average_stay_days', round((avg(extract(epoch from discharged_at - admitted_at) / 86400)
                                   filter (where status = 'discharged' and discharged_at is not null))::numeric, 1))
        from public.admissions where private.pk_date(admitted_at) between p_from and p_to)) into res;
  return res;
end $$;

-- =============================================================================
-- Medicines & stock
-- =============================================================================
create or replace function public.report_inventory(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  grain    text := private.report_guard(private.has_permission('inventory.view') or private.has_permission('reports.financial'),
                                        'inventory.view', p_from, p_to);
  see_cost boolean := private.has_permission('inventory.view_cost');
  today    date := private.clinic_today();
  days     int := p_to - p_from + 1;
  res jsonb;
begin
  res := jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'grain', grain, 'days', days),
    'top_used', coalesce((
      select jsonb_agg(jsonb_build_object('item_id', x.item_id, 'label', ci.name, 'unit', ci.unit, 'used', x.used,
               'cost', case when see_cost then round(x.cost, 0) end,
               'in_stock', sl.usable_qty,
               'days_left', case when x.used > 0 and sl.usable_qty is not null then round(sl.usable_qty / (x.used / days), 0) end)
             order by x.used desc)
        from (select m.item_id, sum(-m.qty) used, sum(-m.qty * private.unit_cost(m.batch_id, m.item_id)) cost
                from public.inventory_movements m
               where private.pk_date(m.created_at) between p_from and p_to and private.is_usage_movement(m.kind, m.ref_table, m.ref_id)
               group by m.item_id having sum(-m.qty) > 0 order by 2 desc limit 15) x
        join public.catalog_items ci on ci.id = x.item_id
        left join public.stock_levels sl on sl.item_id = x.item_id), '[]'::jsonb),
    'losses', (
      select jsonb_build_object(
        'wastage_qty', coalesce(sum(-m.qty) filter (where m.kind = 'wastage'), 0),
        'expired_qty', coalesce(sum(-m.qty) filter (where m.kind = 'expired'), 0),
        'count_loss_qty', coalesce(sum(-m.qty) filter (where m.kind = 'adjust'), 0),
        'cost', case when see_cost then round(coalesce(sum(-m.qty * private.unit_cost(m.batch_id, m.item_id)), 0), 0) end,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('label', ci.name, 'unit', ci.unit, 'qty', y.qty, 'reason', y.kinds,
                   'cost', case when see_cost then round(y.cost, 0) end) order by y.qty desc)
            from (select m2.item_id, sum(-m2.qty) qty, string_agg(distinct m2.kind::text, ', ') kinds,
                         sum(-m2.qty * private.unit_cost(m2.batch_id, m2.item_id)) cost
                    from public.inventory_movements m2
                   where private.pk_date(m2.created_at) between p_from and p_to
                     and (m2.kind in ('wastage', 'expired') or (m2.kind = 'adjust' and m2.qty < 0))
                   group by m2.item_id order by 2 desc limit 10) y
            join public.catalog_items ci on ci.id = y.item_id), '[]'::jsonb))
        from public.inventory_movements m
       where private.pk_date(m.created_at) between p_from and p_to
         and (m.kind in ('wastage', 'expired') or (m.kind = 'adjust' and m.qty < 0))),
    'stock_now', (
      select jsonb_build_object(
        'tracked_items', count(*),
        'out_of_stock', count(*) filter (where usable_qty <= 0),
        'below_reorder', count(*) filter (where usable_qty > 0 and reorder_level is not null and usable_qty <= reorder_level),
        'expired_on_shelf', count(*) filter (where expired_qty > 0),
        'expiring_60d', (select count(*) from public.product_batches b join public.catalog_items ci on ci.id = b.item_id and ci.is_active
                          where b.qty_on_hand > 0 and b.expiry_date between today and today + 60),
        'value', case when see_cost then (
                   select round(coalesce(sum(b.qty_on_hand * private.unit_cost(b.id, b.item_id)), 0), 0)
                     from public.product_batches b where b.qty_on_hand > 0 and (b.expiry_date is null or b.expiry_date >= today)) end,
        'reorder', coalesce((
          select jsonb_agg(jsonb_build_object('item_id', item_id, 'label', name, 'unit', unit, 'in_stock', usable_qty, 'reorder_level', reorder_level)
                   order by usable_qty / nullif(reorder_level, 0) nulls first, name)
            from (select * from public.stock_levels
                   where usable_qty <= 0 or (reorder_level is not null and usable_qty <= reorder_level)
                   order by usable_qty limit 20) r), '[]'::jsonb))
        from public.stock_levels),
    -- Purchases & price changes are cost data.
    'purchases', case when see_cost then jsonb_build_object(
        'total', (select coalesce(sum(total), 0) from public.purchases where status = 'received' and private.pk_date(received_at) between p_from and p_to),
        'count', (select count(*) from public.purchases where status = 'received' and private.pk_date(received_at) between p_from and p_to),
        'by_supplier', coalesce((
          select jsonb_agg(jsonb_build_object('label', s.name, 'amount', x.amt, 'purchases', x.n) order by x.amt desc)
            from (select supplier_id, sum(total) amt, count(*) n from public.purchases
                   where status = 'received' and private.pk_date(received_at) between p_from and p_to group by 1) x
            join public.suppliers s on s.id = x.supplier_id), '[]'::jsonb),
        'price_changes', coalesce((
          select jsonb_agg(jsonb_build_object('label', ci.name, 'unit', ci.unit, 'supplier', z.supplier,
                   'previous', z.prev_cost, 'latest', z.unit_cost,
                   'change_pct', round(100.0 * (z.unit_cost - z.prev_cost) / z.prev_cost, 1)) order by abs(z.unit_cost - z.prev_cost) / z.prev_cost desc)
            from (select * from (
                    select pl.item_id, pl.unit_cost, s.name supplier, p.received_at,
                           lag(pl.unit_cost) over (partition by pl.item_id order by p.received_at, pl.id) prev_cost,
                           row_number() over (partition by pl.item_id order by p.received_at desc, pl.id desc) rn
                      from public.purchase_lines pl join public.purchases p on p.id = pl.purchase_id and p.status = 'received'
                      join public.suppliers s on s.id = p.supplier_id) w
                   where rn = 1 and prev_cost > 0 and unit_cost <> prev_cost and private.pk_date(received_at) between p_from and p_to
                   order by abs(unit_cost - prev_cost) / prev_cost desc limit 15) z
            join public.catalog_items ci on ci.id = z.item_id), '[]'::jsonb)) end);
  return res;
end $$;

-- =============================================================================
-- Data quality — things to tidy up so the reports stay trustworthy
-- =============================================================================
create or replace function public.report_data_quality()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  today date := private.clinic_today();
  see_cost boolean := private.has_permission('inventory.view_cost');
begin
  if not (private.has_permission('reports.view') or private.has_permission('reports.financial')) then
    raise exception 'permission denied: reports.view' using errcode = '42501';
  end if;
  return jsonb_path_query_array(jsonb_build_array(
    jsonb_build_object('key', 'shared_phone', 'severity', 'warning', 'href', '/customers',
      'label', 'Owners sharing the same mobile number (possible duplicates)',
      'count', (select count(*) from (select phone from public.customers where status <> 'merged' group by phone having count(*) > 1) x)),
    jsonb_build_object('key', 'stuck_visits', 'severity', 'warning', 'href', '/queue',
      'label', 'Visits from earlier days never marked complete',
      'count', (select count(*) from public.visits where visit_date < today and status not in ('completed', 'cancelled'))),
    jsonb_build_object('key', 'draft_notes', 'severity', 'warning', 'href', '/queue',
      'label', 'Consultation notes still in draft from earlier days',
      'count', (select count(*) from public.consultations c join public.visits v on v.id = c.visit_id
                 where c.status = 'draft' and v.visit_date < today)),
    jsonb_build_object('key', 'unbilled_visits', 'severity', 'warning', 'href', '/billing',
      'label', 'Completed visits in the last 30 days with no bill',
      'count', (select count(*) from public.visits v where v.status = 'completed' and v.visit_date >= today - 30
                 and not exists (select 1 from public.invoices i where i.visit_id = v.id and i.status <> 'void'))),
    jsonb_build_object('key', 'old_drafts', 'severity', 'info', 'href', '/billing',
      'label', 'Draft bills older than 2 days',
      'count', (select count(*) from public.invoices where status = 'draft' and created_at < now() - interval '2 days')),
    jsonb_build_object('key', 'missed_promises', 'severity', 'warning', 'href', '/billing/dues',
      'label', 'Dues past their promised payment date',
      'count', (select count(*) from public.dues where status = 'open' and promised_date < today)),
    jsonb_build_object('key', 'no_area', 'severity', 'info', 'href', '/customers',
      'label', 'Owners without an area / society (needed for area reports)',
      'count', (select count(*) from public.customers where status = 'active' and coalesce(trim(area), '') = '')),
    jsonb_build_object('key', 'no_referral', 'severity', 'info', 'href', '/customers',
      'label', 'Owners registered in the last 90 days without “how did they find us”',
      'count', (select count(*) from public.customers where status = 'active' and coalesce(trim(referral_source), '') = ''
                 and created_at > now() - interval '90 days')),
    jsonb_build_object('key', 'no_dob', 'severity', 'info', 'href', '/pets',
      'label', 'Active pets without a date of birth (needed for age-based vaccine schedules)',
      'count', (select count(*) from public.pets where status = 'active' and date_of_birth is null)),
    jsonb_build_object('key', 'no_reorder', 'severity', 'info', 'href', '/inventory',
      'label', 'Stock items with no reorder level (no low-stock alert)',
      'count', (select count(*) from public.catalog_items where is_active and track_stock and reorder_level is null)),
    jsonb_build_object('key', 'zero_price', 'severity', 'info', 'href', '/settings',
      'label', 'Price-list items priced at Rs. 0',
      'count', (select count(*) from public.catalog_items where is_active and sale_price = 0 and not price_is_editable)),
    case when see_cost then jsonb_build_object('key', 'no_cost', 'severity', 'info', 'href', '/inventory',
      'label', 'Stock items with no purchase cost (profit estimate leaves them out)',
      'count', (select count(*) from public.catalog_items ci where ci.is_active and ci.track_stock
                 and not exists (select 1 from public.catalog_costs cc where cc.item_id = ci.id)
                 and not exists (select 1 from public.product_batches b join public.batch_costs bc on bc.batch_id = b.id where b.item_id = ci.id))) end
  ), '$[*] ? (@ != null)');
end $$;

-- =============================================================================
-- Export audit (the export itself is built by the app from RLS-filtered queries)
-- =============================================================================
create or replace function public.log_export(p_dataset text, p_rows int, p_filters jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('data.export') then
    raise exception 'permission denied: data.export' using errcode = '42501';
  end if;
  if coalesce(trim(p_dataset), '') = '' then raise exception 'dataset is required'; end if;
  insert into public.audit_logs (actor_id, action, table_name, record_id, reason, context)
  values ((select auth.uid()), 'data.exported', p_dataset, null, null,
          jsonb_build_object('rows', p_rows, 'filters', coalesce(p_filters, '{}'::jsonb)));
end $$;

-- =============================================================================
-- Grants: callable by signed-in staff only (each function checks its own permission).
-- =============================================================================
do $$
declare f text;
begin
  foreach f in array array[
    'public.report_financial(date, date)', 'public.report_operations(date, date)', 'public.report_inventory(date, date)',
    'public.report_data_quality()', 'public.log_export(text, int, jsonb)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  foreach f in array array[
    'private.pk_date(timestamptz)', 'private.bucket(text, date)', 'private.report_guard(boolean, text, date, date)', 'private.report_buckets(text, date, date)',
    'private.unit_cost(uuid, uuid)', 'private.is_usage_movement(public.movement_kind, text, uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
  end loop;
end $$;
