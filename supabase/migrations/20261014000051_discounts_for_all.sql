-- =============================================================================
-- Discounts without manager approval. The clinic wants any staff member who makes bills or
-- pet-store sales to be able to give a discount of any size (with a reason). The 20% "needs a
-- manager" rule is removed, and billing.discount is given to every role that can bill or sell
-- (the owner can still take it away in "Who can do what"). Who gave the discount is recorded.
-- =============================================================================
insert into public.role_permissions (role_id, permission_key)
select distinct rp.role_id, 'billing.discount' from public.role_permissions rp
 where rp.permission_key in ('billing.create', 'pos.use')
on conflict do nothing;

CREATE OR REPLACE FUNCTION public.issue_invoice(p_id uuid, p_pay_now numeric DEFAULT 0, p_pay_later jsonb DEFAULT NULL::jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inv public.invoices; it record; cfg jsonb := private.billing_config();
  disc numeric; pct numeric; unpaid numeric; needs_approval boolean := false; num text;
begin
  select * into inv from public.invoices where id = p_id for update;
  if not found then raise exception 'invoice not found'; end if;
  if inv.status <> 'draft' then raise exception 'this invoice is already %', inv.status; end if;
  if not (private.has_permission('billing.create') or (inv.kind = 'store' and private.has_permission('pos.use'))) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if not exists (select 1 from public.invoice_items where invoice_id = p_id) then raise exception 'add at least one item'; end if;

  perform private.recalc_invoice(p_id);
  select * into inv from public.invoices where id = p_id;

  -- Discounts: any amount, by anyone allowed to give discounts (all billing / pet-store roles by
  -- default), always with a reason (table check). Who gave it is recorded on the bill.
  disc := inv.line_discounts + inv.invoice_discount;
  if disc > 0 then
    if not private.has_permission('billing.discount') then raise exception 'you don''t have permission to give discounts' using errcode = '42501'; end if;
    perform set_config('bdah.billing', 'on', true);
    update public.invoices set discount_approved_by = (select auth.uid()) where id = p_id;
  end if;

  -- Stock (expired stock is refused inside consume_stock)
  for it in select * from public.invoice_items where invoice_id = p_id and deduct_stock loop
    perform private.consume_stock(it.item_id, it.quantity,
      case when inv.kind = 'store' then 'sale'::public.movement_kind else 'dispense'::public.movement_kind end,
      'invoice_items', it.id, it.batch_id, it.batch_override_reason);
  end loop;

  -- Unpaid balance → formal due
  unpaid := inv.total - greatest(coalesce(p_pay_now, 0), 0);
  if unpaid > 0 then
    if inv.customer_id is null then raise exception 'a walk-in sale must be paid in full — choose a customer to allow pay-later'; end if;
    -- Paying later must be chosen on purpose; the reason and date are optional (defaults below).
    if p_pay_later is null then
      raise exception 'Rs. % will be left unpaid — choose "pay later" to issue the bill without full payment', unpaid;
    end if;
    p_pay_later := jsonb_set(jsonb_set(p_pay_later,
      '{reason}', to_jsonb(coalesce(nullif(trim(p_pay_later ->> 'reason'), ''), 'Payment to follow'))),
      '{promised_date}', to_jsonb(coalesce(nullif(p_pay_later ->> 'promised_date', '')::date, private.clinic_today() + 7)));
    if (p_pay_later ->> 'promised_date')::date < private.clinic_today() then raise exception 'the promised date can''t be in the past'; end if;
    needs_approval := unpaid > coalesce((cfg ->> 'due_approval_amount')::numeric, 5000)
      or exists (select 1 from public.dues d where d.customer_id = inv.customer_id and d.status = 'open' and d.promised_date < private.clinic_today());
  end if;

  num := private.next_invoice_number();
  perform set_config('bdah.billing', 'on', true);
  update public.invoices set status = 'issued', number = num, issued_at = now(), issued_by = (select auth.uid()) where id = p_id;
  perform set_config('bdah.billing', '', true);

  if unpaid > 0 then
    insert into public.dues (invoice_id, customer_id, pet_id, original_amount, reason, promised_date, priority, approval_status, approved_by, approved_at)
    values (p_id, inv.customer_id, inv.pet_id, unpaid, p_pay_later ->> 'reason', (p_pay_later ->> 'promised_date')::date,
            coalesce(p_pay_later ->> 'priority', 'normal'),
            case when not needs_approval then 'not_needed'
                 when private.has_permission('billing.discount_approve') then 'approved' else 'pending' end,
            case when needs_approval and private.has_permission('billing.discount_approve') then (select auth.uid()) end,
            case when needs_approval and private.has_permission('billing.discount_approve') then now() end);
    insert into public.due_promises (due_id, promised_date, note)
    select id, promised_date, 'Initial promise' from public.dues where invoice_id = p_id;
  end if;
  return num;
end $function$;
