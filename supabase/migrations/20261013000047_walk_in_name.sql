-- =============================================================================
-- Walk-in name on pet-store bills. A walk-in buyer can be named at the counter ("Ali") without
-- registering them: the name is kept on the bill and printed on the receipt. Only used when no
-- registered customer is attached (a registered customer's own name always wins).
-- =============================================================================
alter table public.invoices add column walk_in_name text
  check (walk_in_name is null or (length(trim(walk_in_name)) between 1 and 80));
comment on column public.invoices.walk_in_name is 'Name typed at the counter for a walk-in (no customer record).';

-- pos_checkout gains p_walk_in_name (the old 9-argument version is replaced, not overloaded).
drop function public.pos_checkout(text, uuid, uuid, jsonb, jsonb, numeric, text, jsonb, jsonb);

CREATE OR REPLACE FUNCTION public.pos_checkout(p_key text, p_customer uuid, p_pet uuid, p_lines jsonb, p_payments jsonb, p_invoice_discount numeric DEFAULT 0, p_discount_reason text DEFAULT NULL::text, p_pay_later jsonb DEFAULT NULL::jsonb, p_delivery jsonb DEFAULT NULL::jsonb, p_walk_in_name text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv_id uuid; l jsonb; i int := 0; dl public.catalog_items; charge numeric; it public.catalog_items; price numeric;
begin
  if not private.has_permission('pos.use') then raise exception 'permission denied: pos.use' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bdah-idem:' || p_key, 0));   -- concurrent duplicate waits here
  select id into inv_id from public.invoices where idempotency_key = p_key;
  if found then return inv_id; end if;                                -- double tap on "Pay" → same sale
  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then raise exception 'the cart is empty'; end if;

  if p_delivery is not null then
    if p_customer is null then raise exception 'choose the customer for a home delivery'; end if;
    if coalesce(trim(p_delivery ->> 'address'), '') = '' then raise exception 'enter the delivery address'; end if;
    select * into dl from public.catalog_items where system_role = 'delivery_charge';
    charge := coalesce((p_delivery ->> 'charge')::numeric, dl.sale_price);
    if charge < 0 then raise exception 'the delivery charge can''t be negative'; end if;
  end if;

  insert into public.invoices (kind, customer_id, pet_id, invoice_discount, discount_reason, fulfilment, delivery_address, delivery_notes, walk_in_name)
  values ('store', p_customer, p_pet, coalesce(p_invoice_discount, 0), nullif(trim(p_discount_reason), ''),
          case when p_delivery is null then 'in_store' else 'home_delivery' end,
          nullif(trim(p_delivery ->> 'address'), ''), nullif(trim(p_delivery ->> 'notes'), ''),
          case when p_customer is null then nullif(left(trim(p_walk_in_name), 80), '') end)
  returning id into inv_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    select * into it from public.catalog_items where id = (l ->> 'item_id')::uuid;
    if not found then raise exception 'item not found'; end if;
    -- "Price decided at billing" items: use the price typed in the cart, else the list price.
    -- A product can never go out at Rs. 0 by accident (that billed delivery orders at 0 before).
    price := case when it.price_is_editable then coalesce(nullif((l ->> 'unit_price')::numeric, 0), it.sale_price) else it.sale_price end;
    if coalesce(price, 0) <= 0 then raise exception 'enter the price for % before selling it', it.name; end if;
    insert into public.invoice_items (invoice_id, sort_order, item_id, quantity, unit_price, discount_amount, batch_id, batch_override_reason)
    values (inv_id, i, (l ->> 'item_id')::uuid, (l ->> 'quantity')::numeric, price,
            coalesce((l ->> 'discount_amount')::numeric, 0), nullif(l ->> 'batch_id', '')::uuid, nullif(l ->> 'batch_override_reason', ''));
  end loop;
  if p_delivery is not null then
    insert into public.invoice_items (invoice_id, sort_order, item_id, quantity, unit_price)
    values (inv_id, i + 1, dl.id, 1, charge);
  end if;
  perform public.checkout_invoice(inv_id, p_payments, p_pay_later, p_key);
  return inv_id;
end $function$;

revoke all on function public.pos_checkout(text, uuid, uuid, jsonb, jsonb, numeric, text, jsonb, jsonb, text) from public, anon;
grant execute on function public.pos_checkout(text, uuid, uuid, jsonb, jsonb, numeric, text, jsonb, jsonb, text) to authenticated;
