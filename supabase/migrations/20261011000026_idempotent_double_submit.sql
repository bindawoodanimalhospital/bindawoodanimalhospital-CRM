-- =============================================================================
-- Same-key double submits wait instead of failing.
-- Pressure test: 25 simultaneous taps of the same "Pay" (same idempotency key) produced ONE sale (correct),
-- but the losing requests got a raw "duplicate key" error, so a cashier saw an error for a sale that went
-- through. Each idempotent function now takes a transaction-scoped advisory lock on its key first: a
-- concurrent duplicate waits for the first request to commit, then finds it and returns the same result.
-- Bodies are otherwise identical to the live definitions.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.checkout_invoice(p_id uuid, p_payments jsonb, p_pay_later jsonb, p_key text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv public.invoices; p jsonb; paid numeric := 0; i int := 0; num text; left_total numeric; amt numeric;
begin
  if coalesce(trim(p_key), '') = '' then raise exception 'missing idempotency key'; end if;
  select * into inv from public.invoices where id = p_id for update;
  if not found then raise exception 'invoice not found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bdah-idem:' || p_key, 0));   -- concurrent duplicate waits here
  if inv.status = 'issued' and inv.idempotency_key = p_key then return inv.number; end if;   -- double submit
  perform set_config('bdah.billing', 'on', true);
  update public.invoices set idempotency_key = p_key where id = p_id and status = 'draft';
  perform set_config('bdah.billing', '', true);

  for p in select * from jsonb_array_elements(coalesce(p_payments, '[]')) loop
    paid := paid + greatest(coalesce((p ->> 'amount')::numeric, 0), 0);
  end loop;
  perform private.recalc_invoice(p_id);
  select total into left_total from public.invoices where id = p_id;
  num := public.issue_invoice(p_id, least(paid, left_total), p_pay_later);

  for p in select * from jsonb_array_elements(coalesce(p_payments, '[]')) loop
    i := i + 1;
    amt := least(greatest(coalesce((p ->> 'amount')::numeric, 0), 0), left_total);
    continue when amt <= 0;
    perform public.record_payment(inv.customer_id, amt, p ->> 'method', p_key || ':' || i, p_id, p ->> 'reference', false);
    left_total := left_total - amt;
  end loop;
  return num;
end $function$;

CREATE OR REPLACE FUNCTION public.pos_checkout(p_key text, p_customer uuid, p_pet uuid, p_lines jsonb, p_payments jsonb, p_invoice_discount numeric DEFAULT 0, p_discount_reason text DEFAULT NULL::text, p_pay_later jsonb DEFAULT NULL::jsonb, p_delivery jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv_id uuid; l jsonb; i int := 0; dl public.catalog_items; charge numeric;
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

  insert into public.invoices (kind, customer_id, pet_id, invoice_discount, discount_reason, fulfilment, delivery_address, delivery_notes)
  values ('store', p_customer, p_pet, coalesce(p_invoice_discount, 0), nullif(trim(p_discount_reason), ''),
          case when p_delivery is null then 'in_store' else 'home_delivery' end,
          nullif(trim(p_delivery ->> 'address'), ''), nullif(trim(p_delivery ->> 'notes'), ''))
  returning id into inv_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    insert into public.invoice_items (invoice_id, sort_order, item_id, quantity, unit_price, discount_amount, batch_id, batch_override_reason)
    values (inv_id, i, (l ->> 'item_id')::uuid, (l ->> 'quantity')::numeric, coalesce((l ->> 'unit_price')::numeric, 0),
            coalesce((l ->> 'discount_amount')::numeric, 0), nullif(l ->> 'batch_id', '')::uuid, nullif(l ->> 'batch_override_reason', ''));
  end loop;
  if p_delivery is not null then
    insert into public.invoice_items (invoice_id, sort_order, item_id, quantity, unit_price)
    values (inv_id, i + 1, dl.id, 1, charge);
  end if;
  perform public.checkout_invoice(inv_id, p_payments, p_pay_later, p_key);
  return inv_id;
end $function$;

CREATE OR REPLACE FUNCTION public.record_payment(p_customer uuid, p_amount numeric, p_method text, p_key text, p_invoice uuid DEFAULT NULL::uuid, p_reference text DEFAULT NULL::text, p_auto boolean DEFAULT true, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare pay uuid; left_amt numeric := p_amount; inv record; take numeric; m public.payment_methods; kind_inv public.invoice_kind;
begin
  if coalesce(trim(p_key), '') = '' then raise exception 'missing idempotency key'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bdah-idem:' || p_key, 0));   -- concurrent duplicate waits here
  select id into pay from public.payments where idempotency_key = p_key;
  if found then return pay; end if;                                  -- double submit → same receipt

  if p_invoice is not null then select kind into kind_inv from public.invoices where id = p_invoice; end if;
  if not (private.has_permission('billing.create') or (kind_inv = 'store' and private.has_permission('pos.use'))) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'enter an amount'; end if;
  select * into m from public.payment_methods where key = p_method and is_active;
  if not found then raise exception 'unknown payment method'; end if;
  if m.needs_reference and coalesce(trim(p_reference), '') = '' then raise exception 'enter the transaction / reference number for %', m.label; end if;
  if p_customer is null and p_invoice is null then raise exception 'choose a customer or invoice'; end if;

  insert into public.payments (kind, customer_id, amount, method, reference, notes, idempotency_key)
  values ('payment', p_customer, p_amount, p_method, nullif(trim(p_reference), ''), p_notes, p_key) returning id into pay;

  if p_invoice is not null then
    select * into inv from public.invoices where id = p_invoice for update;
    if inv.status <> 'issued' then raise exception 'the invoice must be issued before taking payment'; end if;
    if p_customer is not null and inv.customer_id is distinct from p_customer then raise exception 'invoice belongs to another customer'; end if;
    take := least(left_amt, inv.balance);
    if take > 0 then perform private.allocate(pay, p_invoice, take); left_amt := left_amt - take; end if;
  end if;

  if left_amt > 0 and p_auto and p_customer is not null then
    for inv in select * from public.invoices where customer_id = p_customer and status = 'issued' and balance > 0
               order by issued_at for update loop
      exit when left_amt <= 0;
      take := least(left_amt, inv.balance);
      perform private.allocate(pay, inv.id, take);
      left_amt := left_amt - take;
    end loop;
  end if;

  if left_amt > 0 and p_customer is null then raise exception 'amount is more than the bill — give change instead'; end if;
  return pay;
end $function$;

CREATE OR REPLACE FUNCTION public.record_stock_loan(p_key text, p_direction text, p_partner uuid, p_lines jsonb, p_loan_date date DEFAULT NULL::date, p_expected_return date DEFAULT NULL::date, p_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare loan_id uuid; l jsonb; ci public.catalog_items; partner public.partner_businesses; line_id uuid;
        loc uuid; bid uuid; q numeric; i int := 0; d date := coalesce(p_loan_date, private.clinic_today()); exp date;
begin
  if not private.has_permission('inventory.manage') then raise exception 'permission denied: inventory.manage' using errcode = '42501'; end if;
  if coalesce(trim(p_key), '') = '' then raise exception 'missing idempotency key'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bdah-idem:' || p_key, 0));   -- concurrent duplicate waits here
  select id into loan_id from public.stock_loans where idempotency_key = p_key;
  if found then return loan_id; end if;                                -- double submit → same record
  if p_direction not in ('borrowed', 'lent') then raise exception 'choose borrowed or lent'; end if;
  select * into partner from public.partner_businesses where id = p_partner;
  if not found or not partner.is_active then raise exception 'choose the business'; end if;
  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then raise exception 'add at least one product'; end if;
  if d > private.clinic_today() then raise exception 'the date can''t be in the future'; end if;
  if p_expected_return is not null and p_expected_return < d then raise exception 'the expected return date is before the loan date'; end if;

  insert into public.stock_loans (direction, partner_id, loan_date, expected_return_date, reference, notes, idempotency_key)
  values (p_direction, p_partner, d, p_expected_return, nullif(trim(p_reference), ''), nullif(trim(p_notes), ''), p_key)
  returning id into loan_id;

  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    q := (l ->> 'qty')::numeric;
    if q is null or q <= 0 then raise exception 'enter a quantity for every product'; end if;
    select * into ci from public.catalog_items where id = (l ->> 'item_id')::uuid;
    if not found then raise exception 'product not found'; end if;
    if not ci.track_stock then raise exception '% is not a stock item — turn on stock tracking first', ci.name; end if;
    exp := nullif(l ->> 'expiry_date', '')::date;
    loc := case when p_direction = 'borrowed'
                then coalesce(nullif(l ->> 'location_id', '')::uuid, (select id from public.inventory_locations where is_default)) end;

    insert into public.stock_loan_lines (loan_id, sort_order, item_id, unit, qty, location_id, batch_no, expiry_date, notes)
    values (loan_id, i, ci.id, ci.unit, q, loc,
            case when p_direction = 'borrowed' then coalesce(trim(l ->> 'batch_no'), '') else '' end,
            case when p_direction = 'borrowed' then exp end, nullif(trim(l ->> 'notes'), ''))
    returning id into line_id;

    if p_direction = 'borrowed' then
      if exp is not null and exp < private.clinic_today() then
        raise exception '% batch % is already expired — don''t accept it', ci.name, coalesce(nullif(l ->> 'batch_no', ''), '');
      end if;
      bid := private.loan_batch(ci.id, loc, l ->> 'batch_no', exp);
      insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, reason, ref_table, ref_id)
      values (bid, ci.id, loc, q, 'borrow_in', 'Borrowed from ' || partner.name, 'stock_loan_lines', line_id);
    else
      perform private.consume_stock(ci.id, q, 'lend_out', 'stock_loan_lines', line_id,
        nullif(l ->> 'batch_id', '')::uuid, nullif(l ->> 'batch_override_reason', ''));
    end if;
  end loop;
  return loan_id;
end $function$;

CREATE OR REPLACE FUNCTION public.record_stock_loan_return(p_key text, p_loan uuid, p_lines jsonb, p_returned_on date DEFAULT NULL::date, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare loan public.stock_loans; partner_name text; ret uuid; l jsonb; ln public.stock_loan_lines; q numeric; rl uuid;
        total numeric := 0; bid uuid; loc uuid; exp date; src record; d date := coalesce(p_returned_on, private.clinic_today());
begin
  if not private.has_permission('inventory.manage') then raise exception 'permission denied: inventory.manage' using errcode = '42501'; end if;
  if coalesce(trim(p_key), '') = '' then raise exception 'missing idempotency key'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bdah-idem:' || p_key, 0));   -- concurrent duplicate waits here
  select id into ret from public.stock_loan_returns where idempotency_key = p_key;
  if found then return ret; end if;                                   -- double submit → same return

  select * into loan from public.stock_loans where id = p_loan for update;
  if not found then raise exception 'loan not found'; end if;
  if loan.status = 'cancelled' then raise exception 'this record was cancelled'; end if;
  if loan.status = 'fully_returned' then raise exception 'everything on this record is already returned'; end if;
  if d > private.clinic_today() then raise exception 'the date can''t be in the future'; end if;
  if d < loan.loan_date then raise exception 'the return date is before the loan date'; end if;
  select name into partner_name from public.partner_businesses where id = loan.partner_id;

  insert into public.stock_loan_returns (loan_id, returned_on, notes, idempotency_key)
  values (p_loan, d, nullif(trim(p_notes), ''), p_key) returning id into ret;

  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    q := (l ->> 'qty')::numeric;
    continue when q is null or q <= 0;
    select * into ln from public.stock_loan_lines where id = (l ->> 'loan_line_id')::uuid and loan_id = p_loan for update;
    if not found then raise exception 'product line not on this record'; end if;
    if q > ln.qty - ln.returned_qty then
      raise exception 'only % % of % are still outstanding', ln.qty - ln.returned_qty, ln.unit,
        (select name from public.catalog_items where id = ln.item_id);
    end if;
    exp := nullif(l ->> 'expiry_date', '')::date;
    insert into public.stock_loan_return_lines (return_id, loan_line_id, qty, batch_no, expiry_date)
    values (ret, ln.id, q, nullif(trim(l ->> 'batch_no'), ''), exp) returning id into rl;

    if loan.direction = 'borrowed' then
      perform private.consume_stock(ln.item_id, q, 'borrow_return', 'stock_loan_return_lines', rl,
        nullif(l ->> 'batch_id', '')::uuid, nullif(l ->> 'batch_override_reason', ''));
    else
      select batch_id, location_id into src from public.inventory_movements
       where ref_table = 'stock_loan_lines' and ref_id = ln.id and qty < 0 order by id desc limit 1;
      if nullif(trim(l ->> 'batch_no'), '') is not null or exp is not null then
        if exp is not null and exp < private.clinic_today() then
          raise exception 'that batch is already expired — don''t accept it back';
        end if;
        loc := coalesce(nullif(l ->> 'location_id', '')::uuid, src.location_id, (select id from public.inventory_locations where is_default));
        bid := private.loan_batch(ln.item_id, loc, l ->> 'batch_no', exp);
      else
        bid := src.batch_id; loc := src.location_id;          -- back where it came from
      end if;
      insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, reason, ref_table, ref_id)
      values (bid, ln.item_id, loc, q, 'lend_return', 'Returned by ' || partner_name, 'stock_loan_return_lines', rl);
    end if;

    update public.stock_loan_lines set returned_qty = returned_qty + q where id = ln.id;
    total := total + q;
  end loop;
  if total <= 0 then raise exception 'enter the quantity being returned'; end if;
  perform private.refresh_loan_status(p_loan);
  return ret;
end $function$;

CREATE OR REPLACE FUNCTION public.refund_payment(p_invoice uuid, p_amount numeric, p_method text, p_reason text, p_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv public.invoices; pay uuid;
begin
  if not private.has_permission('billing.refund') then raise exception 'permission denied: billing.refund' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bdah-idem:' || p_key, 0));   -- concurrent duplicate waits here
  select id into pay from public.payments where idempotency_key = p_key;
  if found then return pay; end if;
  return private.refund_internal(p_invoice, p_amount, p_method, p_reason, p_key);
end $function$;

CREATE OR REPLACE FUNCTION public.return_items(p_invoice uuid, p_lines jsonb, p_reason text, p_refund_method text, p_key text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv public.invoices; l jsonb; it public.invoice_items; q numeric; amt numeric; total_amt numeric := 0; ret uuid;
        lines jsonb := '[]'::jsonb; refund_amt numeric; src record;
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

  perform set_config('bdah.billing', 'on', true);
  for l in select * from jsonb_array_elements(p_lines) loop
    q := (l ->> 'qty')::numeric;
    continue when q is null or q <= 0;
    select * into it from public.invoice_items where id = (l ->> 'invoice_item_id')::uuid and invoice_id = p_invoice for update;
    if not found then raise exception 'item not on this invoice'; end if;
    if q > it.quantity - it.returned_qty then raise exception 'only % of % can be returned', it.quantity - it.returned_qty, it.description; end if;
    amt := round(it.line_total * q / it.quantity, 2);
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

CREATE OR REPLACE FUNCTION public.write_off_due(p_due uuid, p_reason text, p_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d public.dues; inv public.invoices; pay uuid;
begin
  if not private.has_permission('billing.discount_approve') then raise exception 'only a manager can write off dues' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into d from public.dues where id = p_due for update;
  if d.status <> 'open' then raise exception 'this due is already %', d.status; end if;
  select * into inv from public.invoices where id = d.invoice_id for update;
  perform pg_advisory_xact_lock(hashtextextended('bdah-idem:' || p_key, 0));   -- concurrent duplicate waits here
  if exists (select 1 from public.payments where idempotency_key = p_key) then return; end if;
  insert into public.payments (kind, customer_id, amount, method, notes, idempotency_key)
  values ('write_off', d.customer_id, inv.balance, 'write_off', p_reason, p_key) returning id into pay;
  perform private.allocate(pay, inv.id, inv.balance);
  update public.dues set status = 'written_off', closed_at = now() where id = p_due;
end $function$;

