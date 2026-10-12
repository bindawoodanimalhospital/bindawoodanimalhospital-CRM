-- =============================================================================
-- Cancelled orders. A pet-store / home-delivery order the customer calls off can be cancelled in
-- one step, with an optional reason ("Order cancelled" if none):
--  * anything paid is refunded (same method as the payment unless another is chosen),
--  * the stock goes back on the shelf, any unpaid balance / reminder is closed,
--  * the order shows as Cancelled, and the cancellation is in the activity log.
-- Who: pet-store staff can cancel an order that hasn't been delivered yet, or an in-store sale
-- made today. Older or delivered orders need the owner (billing.void) — or a return.
-- Clinic bills keep using Void on the bill.
-- =============================================================================
create or replace function public.cancel_order(p_invoice uuid, p_reason text default null, p_refund_method text default null, p_key text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  inv public.invoices;
  reason text := coalesce(nullif(trim(p_reason), ''), 'Order cancelled');
  m text;
begin
  perform pg_advisory_xact_lock(hashtextextended('bdah-cancel:' || p_invoice, 0));
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then raise exception 'order not found'; end if;
  if inv.kind <> 'store' then raise exception 'clinic bills are cancelled with Void on the bill'; end if;
  if inv.status = 'void' then return; end if;                       -- already cancelled (double tap)
  if inv.status <> 'issued' then raise exception 'this order isn''t finished yet — clear the cart instead'; end if;
  if inv.returned_amount > 0 then raise exception 'items were already returned on this order — return the rest instead'; end if;
  if not (private.has_permission('billing.void') or (private.has_permission('pos.use') and (
       (inv.fulfilment = 'home_delivery' and inv.delivery_status <> 'delivered')
       or (inv.fulfilment = 'in_store' and (inv.issued_at at time zone 'Asia/Karachi')::date = private.clinic_today())))) then
    raise exception 'only the owner can cancel this order (it was delivered or sold on an earlier day — use a return instead)' using errcode = '42501';
  end if;

  if inv.amount_paid > 0 then
    m := coalesce(nullif(p_refund_method, ''),
      (select p.method from public.payments p join public.payment_allocations a on a.payment_id = p.id
        where a.invoice_id = inv.id and p.kind = 'payment' and p.method <> 'write_off' order by p.received_at desc limit 1),
      'cash');
    perform private.refund_internal(inv.id, inv.amount_paid, m, 'Order cancelled: ' || reason, coalesce(nullif(p_key, ''), 'cancel-' || inv.id));
  end if;

  perform private.reverse_stock('invoice_items', it.id, 'Order cancelled: ' || reason)
    from public.invoice_items it where it.invoice_id = inv.id;
  perform set_config('bdah.billing', 'on', true);
  update public.invoices set status = 'void', voided_at = now(), voided_by = (select auth.uid()), void_reason = 'Cancelled: ' || reason
   where id = inv.id;
  perform set_config('bdah.billing', '', true);

  insert into public.audit_logs (actor_id, action, table_name, record_id, reason, context)
  values ((select auth.uid()), 'order.cancelled', 'invoices', inv.id::text, reason,
          jsonb_build_object('number', inv.number, 'refunded', inv.amount_paid, 'delivery', inv.fulfilment = 'home_delivery'));
end $$;
revoke execute on function public.cancel_order(uuid, text, text, text) from public, anon;
grant execute on function public.cancel_order(uuid, text, text, text) to authenticated;
