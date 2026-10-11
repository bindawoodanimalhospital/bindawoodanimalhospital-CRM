-- =============================================================================
-- Business-logic audit fixes (each proven by a scenario test first; see scripts/sql/business-logic-test.sql)
--  1) Returns ignored a bill-wide discount: returning a discounted item refunded the full line price
--     (two Rs. 1,000 items − Rs. 200 discount, return one → refunded Rs. 1,000 instead of Rs. 900), and a
--     full return on a discounted bill failed outright (returned > bill total). Returns are now credited at
--     the discounted price.
--  2) Voiding a vaccination (e.g. recorded on the wrong pet) did not reopen the due reminder it had closed,
--     so the pet silently lost its next-dose reminder. Due items now remember which vaccination closed them
--     and are reopened if that record is voided.
--  3) Merging customers left tasks, messages and reminder tracks on the merged-away record.
--  4) Data checks: bills with money still owed but no promised payment date (a refund without a return
--     leaves such a balance, which the Unpaid bills list — built from dues — never shows).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.return_items(p_invoice uuid, p_lines jsonb, p_reason text, p_refund_method text, p_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv public.invoices; l jsonb; it public.invoice_items; q numeric; amt numeric; total_amt numeric := 0; ret uuid;
        lines jsonb := '[]'::jsonb; refund_amt numeric; src record; gross numeric; factor numeric;
begin
  if not (private.has_permission('billing.refund') or private.has_permission('pos.return')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  if coalesce(trim(p_key), '') = '' then raise exception 'missing idempotency key'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bdah-idem:' || p_key, 0));   -- concurrent duplicate waits here
  select id into ret from public.invoice_returns where idempotency_key = p_key;
  if found then return ret; end if;                                   -- double submit → same return

  select * into inv from public.invoices where id = p_invoice for update;
  if inv.status <> 'issued' then raise exception 'only issued invoices can have returns'; end if;

  -- A bill-wide discount is shared across the lines in proportion to their value, so a returned item is
  -- credited at what the customer actually paid for it (never more than what is left of the bill).
  select coalesce(sum(line_total), 0) into gross from public.invoice_items where invoice_id = p_invoice;
  factor := case when gross > 0 then inv.total / gross else 1 end;
  perform set_config('bdah.billing', 'on', true);
  for l in select * from jsonb_array_elements(p_lines) loop
    q := (l ->> 'qty')::numeric;
    continue when q is null or q <= 0;
    select * into it from public.invoice_items where id = (l ->> 'invoice_item_id')::uuid and invoice_id = p_invoice for update;
    if not found then raise exception 'item not on this invoice'; end if;
    if q > it.quantity - it.returned_qty then raise exception 'only % of % can be returned', it.quantity - it.returned_qty, it.description; end if;
    amt := least(round(it.line_total * q / it.quantity * factor, 2), inv.total - inv.returned_amount - total_amt);
    if it.deduct_stock then
      -- Back into the batch it was taken from (the most recent one if it came from several).
      select batch_id, item_id, location_id into src from public.inventory_movements
       where ref_table = 'invoice_items' and ref_id = it.id and qty < 0 order by id desc limit 1;
      if found then
        insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, reason, ref_table, ref_id)
        values (src.batch_id, src.item_id, src.location_id, q, 'return_in', p_reason, 'invoice_items', it.id);
      end if;
    end if;
    update public.invoice_items set returned_qty = returned_qty + q where id = it.id;
    total_amt := total_amt + amt;
    lines := lines || jsonb_build_object('invoice_item_id', it.id, 'qty', q, 'amount', amt);
  end loop;
  if total_amt <= 0 then raise exception 'choose what is being returned'; end if;

  -- Money already paid beyond the new (lower) total goes back to the customer first.
  refund_amt := greatest(0, least(inv.amount_paid, total_amt - inv.balance));
  if refund_amt > 0 then
    if p_refund_method is null then raise exception 'choose how to refund Rs. %', refund_amt; end if;
    perform private.refund_internal(p_invoice, refund_amt, p_refund_method, 'Return: ' || p_reason, p_key || ':refund');
  end if;
  perform set_config('bdah.billing', 'on', true);
  update public.invoices set returned_amount = returned_amount + total_amt where id = p_invoice;
  perform set_config('bdah.billing', '', true);
  insert into public.invoice_returns (invoice_id, amount, reason, lines, idempotency_key)
  values (p_invoice, total_amt, p_reason, lines, p_key) returning id into ret;
  return ret;
end $function$;

alter table public.due_items add column closed_by_vaccination uuid references public.vaccinations (id);

create or replace function private.vaccination_due_items()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.due_items
     set status = 'done', outcome = 'administered', completed_at = now(), completed_by = new.administered_by,
         closed_by_vaccination = new.id
   where pet_id = new.pet_id and kind = 'vaccination' and status = 'pending'
     and (vaccine_id = new.vaccine_id or (new.protocol_id is not null and protocol_id = new.protocol_id));

  if new.next_due_date is not null then
    insert into public.due_items (pet_id, kind, title, due_on, vaccine_id, protocol_id, protocol_step,
                                  source_table, source_id, assigned_to)
    values (new.pet_id, 'vaccination',
            coalesce(nullif(trim(new.next_due_label), ''), new.vaccine_name || ' — next dose'),
            new.next_due_date, new.vaccine_id, new.protocol_id,
            case when new.protocol_step is not null then new.protocol_step + 1 end,
            'vaccinations', new.id, new.administered_by);
  end if;
  return null;
end $$;

-- Voiding a record cancels the due item it created AND reopens the ones it had closed.
create or replace function private.vaccination_voided()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.voided_at is not null and old.voided_at is null then
    update public.due_items set status = 'cancelled', outcome = 'record voided', outcome_reason = new.void_reason
     where source_table = 'vaccinations' and source_id = new.id and status = 'pending';
    update public.due_items set status = 'pending', outcome = null, completed_at = null, completed_by = null,
           closed_by_vaccination = null
     where closed_by_vaccination = new.id and status = 'done';
  end if;
  return null;
end $$;

CREATE OR REPLACE FUNCTION public.merge_customers(p_source uuid, p_target uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.has_permission('customers.merge') then
    raise exception 'permission denied: customers.merge' using errcode = '42501';
  end if;
  if p_source = p_target then raise exception 'cannot merge a customer into itself'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  perform 1 from public.customers where id in (p_source, p_target) and status <> 'merged' having count(*) = 2;
  if not found then raise exception 'both customers must exist and not already be merged'; end if;

  delete from public.pet_owners po
   where po.customer_id = p_source
     and exists (select 1 from public.pet_owners t where t.pet_id = po.pet_id and t.customer_id = p_target);
  update public.pet_owners set customer_id = p_target where customer_id = p_source;
  update public.appointments set customer_id = p_target where customer_id = p_source;
  update public.visits set customer_id = p_target where customer_id = p_source;
  update public.surgeries set customer_id = p_target where customer_id = p_source;
  update public.admissions set customer_id = p_target where customer_id = p_source;
  perform set_config('bdah.billing', 'on', true);
  update public.invoices set customer_id = p_target where customer_id = p_source;
  perform set_config('bdah.billing', '', true);
  update public.payments set customer_id = p_target where customer_id = p_source;
  update public.dues set customer_id = p_target where customer_id = p_source;
  update public.tasks set customer_id = p_target where customer_id = p_source;
  update public.messages set customer_id = p_target where customer_id = p_source;
  update public.reminder_tracks set customer_id = p_target where customer_id = p_source;

  update public.customers
     set status = 'merged', merged_into_id = p_target,
         notes = concat_ws(E'\n', notes, 'Merged into target on ' || now()::date || ': ' || p_reason)
   where id = p_source;

  insert into public.audit_logs (actor_id, action, table_name, record_id, reason, context)
  values ((select auth.uid()), 'customer.merged', 'customers', p_source::text, p_reason, jsonb_build_object('target', p_target));
end $function$;

CREATE OR REPLACE FUNCTION public.report_data_quality()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    jsonb_build_object('key', 'balance_no_promise', 'severity', 'warning', 'href', '/billing?view=unpaid',
      'label', 'Bills with money still owed but no promised payment date (e.g. refunded without a return)',
      'count', (select count(*) from public.invoices i where i.status = 'issued' and i.balance > 0
                 and not exists (select 1 from public.dues d where d.invoice_id = i.id and d.status = 'open'))),
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
end $function$;
