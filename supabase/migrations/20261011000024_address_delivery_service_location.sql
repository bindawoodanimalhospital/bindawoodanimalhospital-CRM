-- =============================================================================
-- POS enhancements (Bin Dawood POS Enhancement Requirements, revised) §1–§6
--
--  §1  Client address: house number + block (full address already exists).
--  §2  Home delivery orders: fulfilment type, delivery status, per-order delivery address.
--  §3  Delivery charge: its own bill line from the price-list item "Home delivery charge"
--      (suggested Rs. 50, editable per order, never hard-coded). At most ONE delivery line per
--      bill (unique index), so it can't be counted twice. Rs. 0 (waived) needs billing.discount.
--      While an order is still pending and nothing has been paid (cash on delivery), the charge
--      can be changed through update_delivery() — logged; afterwards it is locked.
--  §4  Service location (At hospital / Home visit + visit address) on appointments, visits and
--      clinic bills; carried appointment → visit → bill automatically.
-- Existing rows keep working: every new column has a safe default.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- §1 Client address
-- -----------------------------------------------------------------------------
alter table public.customers
  add column house_no text,
  add column block    text;
comment on column public.customers.house_no is 'House / flat number, e.g. "123" or "Flat 4B"';
comment on column public.customers.block is 'Block / sector / phase, e.g. "Block C"';
comment on column public.customers.address is 'Full address: street, area and any other details';

-- One line used for deliveries, home visits and printouts: "House 12, Block C, Street 4, DHA Phase 5, Lahore".
create or replace function public.customer_address_line(p_customer uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select nullif(concat_ws(', ',
    nullif('House ' || nullif(trim(c.house_no), ''), 'House '),
    nullif(trim(c.block), ''), nullif(trim(c.address), ''), nullif(trim(c.area), ''), nullif(trim(c.city), '')), '')
  from public.customers c where c.id = p_customer;
$$;
revoke execute on function public.customer_address_line(uuid) from public, anon;
grant execute on function public.customer_address_line(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Price-list items the system relies on (delivery charge, home visit charge)
-- -----------------------------------------------------------------------------
alter table public.catalog_items
  add column system_role text unique check (system_role in ('delivery_charge', 'home_visit_charge')),
  add constraint catalog_items_system_role_ck
    check (system_role is null or (kind = 'service' and not track_stock and not is_retail and price_is_editable));

insert into public.catalog_items (kind, name, category, sale_price, price_is_editable, system_role, notes) values
  ('service', 'Home delivery charge', 'Delivery', 50, true, 'delivery_charge',
   'Suggested charge for home delivery. Staff can change it on each order according to distance.'),
  ('service', 'Home visit charge', 'Home visit', 0, true, 'home_visit_charge',
   'Charged when a doctor/staff visits the client''s home. Set your usual fee here; it can be changed on each bill.');

-- The system items can be re-priced and renamed, but not switched off or repurposed.
create or replace function private.guard_system_catalog_item()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.system_role is not null then raise exception '"%" is used by the system and can''t be deleted', old.name using errcode = '42501'; end if;
    return old;
  end if;
  if old.system_role is not null and (new.system_role is distinct from old.system_role or not new.is_active) then
    raise exception '"%" is used by the system — you can change its price or name, but not turn it off', old.name using errcode = '42501';
  end if;
  return new;
end $$;
create trigger catalog_items_system_guard before update or delete on public.catalog_items
  for each row execute function private.guard_system_catalog_item();

-- -----------------------------------------------------------------------------
-- §4 Service location on appointments & visits
-- -----------------------------------------------------------------------------
alter table public.appointments
  add column service_location text not null default 'clinic' check (service_location in ('clinic', 'home_visit')),
  add column service_address  text,
  add constraint appointments_service_address_ck
    check (service_location = 'clinic' or coalesce(trim(service_address), '') <> '');

alter table public.visits
  add column service_location text not null default 'clinic' check (service_location in ('clinic', 'home_visit')),
  add column service_address  text,
  add constraint visits_service_address_ck
    check (service_location = 'clinic' or coalesce(trim(service_address), '') <> '');
create index visits_home_visit_idx on public.visits (visit_date) where service_location = 'home_visit';

-- Check-in carries the booked location over to the visit (same function, plus the two fields).
create or replace function public.check_in_appointment(p_appointment_id uuid, p_pet_id uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  a public.appointments;
  v_id uuid;
begin
  select * into a from public.appointments where id = p_appointment_id for update;
  if not found then raise exception 'appointment not found'; end if;
  if a.status not in ('booked', 'confirmed') then
    raise exception 'this appointment is already %', a.status;
  end if;
  if coalesce(p_pet_id, a.pet_id) is null then
    raise exception 'choose which pet has arrived';
  end if;
  insert into public.visits (pet_id, customer_id, appointment_id, doctor_id, visit_type_id, reason, priority, service_location, service_address)
  values (coalesce(p_pet_id, a.pet_id), a.customer_id, a.id, a.doctor_id, a.appointment_type_id, a.reason,
          case when a.is_urgent then 'urgent'::public.visit_priority else 'normal' end,
          a.service_location, a.service_address)
  returning id into v_id;
  update public.appointments
     set status = 'arrived', visit_id = v_id, pet_id = coalesce(p_pet_id, a.pet_id)
   where id = a.id;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- §2 / §4 Invoices: fulfilment, delivery and service location
-- -----------------------------------------------------------------------------
alter table public.invoices
  add column fulfilment       text not null default 'in_store' check (fulfilment in ('in_store', 'home_delivery')),
  add column delivery_status  text check (delivery_status in ('pending', 'dispatched', 'delivered')),
  add column delivery_address text,
  add column delivery_rider   text,               -- who took it (optional)
  add column delivery_notes   text,
  add column dispatched_at    timestamptz,
  add column dispatched_by    uuid references public.staff (id),
  add column delivered_at     timestamptz,
  add column delivered_by     uuid references public.staff (id),
  add column service_location text not null default 'clinic' check (service_location in ('clinic', 'home_visit')),
  add column service_address  text,
  add constraint invoices_delivery_status_ck check ((fulfilment = 'home_delivery') = (delivery_status is not null)),
  add constraint invoices_delivery_needs_customer_ck
    check (fulfilment = 'in_store' or (customer_id is not null and coalesce(trim(delivery_address), '') <> '')),
  add constraint invoices_service_address_ck
    check (service_location = 'clinic' or coalesce(trim(service_address), '') <> '');
create index invoices_delivery_idx on public.invoices (delivery_status, created_at desc) where fulfilment = 'home_delivery';

alter table public.invoice_items add column line_role text;   -- copied from catalog_items.system_role
-- The delivery charge (and the home-visit charge) can appear at most once on a bill.
create unique index invoice_items_one_system_line on public.invoice_items (invoice_id, line_role) where line_role is not null;

-- Line defaults: same rules as before (migration 017), plus system lines.
create or replace function private.invoice_item_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ci public.catalog_items; inv public.invoices;
  generated text[] := array['returned_qty', 'line_subtotal', 'tax_amount', 'line_total'];
begin
  select * into inv from public.invoices where id = new.invoice_id;
  if inv.status <> 'draft' then
    -- Only the return function may touch an issued line, and only returned_qty.
    if tg_op = 'UPDATE' and current_setting('bdah.billing', true) = 'on'
       and (to_jsonb(new) - generated) = (to_jsonb(old) - generated) then
      return new;
    end if;
    -- update_delivery() may re-price the delivery line of a pending, unpaid order — nothing else.
    if tg_op = 'UPDATE' and current_setting('bdah.delivery', true) = 'on' and old.line_role = 'delivery_charge'
       and (to_jsonb(new) - generated - 'unit_price') = (to_jsonb(old) - generated - 'unit_price') then
      return new;
    end if;
    raise exception 'this invoice is issued and locked' using errcode = '42501';
  end if;
  select * into ci from public.catalog_items where id = new.item_id;
  if not found or not ci.is_active then raise exception 'this item is not in the price list'; end if;
  new.kind := ci.kind;
  new.description := coalesce(nullif(trim(new.description), ''), ci.name);
  new.tax_rate := ci.tax_rate;
  if not ci.price_is_editable then new.unit_price := ci.sale_price; end if;
  new.deduct_stock := ci.track_stock;          -- never switchable per line
  if not ci.track_stock then new.batch_id := null; end if;
  new.line_role := ci.system_role;
  if ci.system_role = 'delivery_charge' then
    if inv.fulfilment <> 'home_delivery' then
      raise exception 'a delivery charge can only be added to a home delivery order';
    end if;
    new.quantity := 1;                         -- one charge per order, never multiplied
    new.discount_amount := 0;                  -- lower the charge itself instead
    if new.unit_price = 0 and not private.has_permission('billing.discount') then
      raise exception 'only staff who can give discounts can waive the delivery charge (Rs. 0)' using errcode = '42501';
    end if;
  end if;
  if new.discount_amount > 0 and not private.has_permission('billing.discount') and pg_trigger_depth() < 2 then
    raise exception 'you don''t have permission to give discounts' using errcode = '42501';
  end if;
  return new;
end $$;

-- Header rules for fulfilment/service location (drafts are editable; issue checks the delivery line).
create or replace function private.invoice_fulfilment_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare has_line boolean; v record;
begin
  -- A bill made from a visit inherits where the service was given.
  if tg_op = 'INSERT' and new.visit_id is not null and new.service_location = 'clinic' and new.service_address is null then
    select service_location, service_address into v from public.visits where id = new.visit_id;
    if found then new.service_location := v.service_location; new.service_address := v.service_address; end if;
  end if;
  if new.service_location = 'clinic' then new.service_address := null; end if;

  if tg_op = 'INSERT' or old.status = 'draft' then
    if new.fulfilment = 'home_delivery' then
      new.delivery_status := coalesce(new.delivery_status, 'pending');
    else
      new.delivery_status := null; new.delivery_address := null;
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status = 'draft' and new.status = 'issued' then
    has_line := exists (select 1 from public.invoice_items where invoice_id = new.id and line_role = 'delivery_charge');
    if new.fulfilment = 'home_delivery' and not has_line then
      raise exception 'add the delivery charge to this home delivery order (Rs. 0 if waived)';
    end if;
    if new.fulfilment = 'in_store' and has_line then
      raise exception 'remove the delivery charge, or mark the order as home delivery';
    end if;
  end if;
  return new;
end $$;
create trigger invoices_fulfilment_rules before insert or update on public.invoices
  for each row execute function private.invoice_fulfilment_rules();

-- Changing a visit's location updates its still-draft bill.
create or replace function private.visit_location_to_draft_bill()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.invoices set service_location = new.service_location, service_address = new.service_address
   where visit_id = new.id and status = 'draft';
  return null;
end $$;
create trigger visits_location_sync after update of service_location, service_address on public.visits
  for each row execute function private.visit_location_to_draft_bill();

-- -----------------------------------------------------------------------------
-- §2 / §3 Delivery workflow on issued orders
-- -----------------------------------------------------------------------------
/**
 * Update a home delivery order after the sale:
 *  p_status  'pending' | 'dispatched' | 'delivered'   ('delivered' is final)
 *  p_charge  new delivery charge — only while pending AND nothing paid/returned (cash on delivery)
 *  p_address new delivery address — only while pending
 *  p_rider / p_note  optional details
 * Every change is written to the audit log.
 */
create or replace function public.update_delivery(p_invoice uuid, p_status text default null, p_charge numeric default null,
  p_address text default null, p_rider text default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare inv public.invoices; line public.invoice_items; before jsonb;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then raise exception 'order not found'; end if;
  if not private.can_write_invoice(inv.kind) then raise exception 'permission denied' using errcode = '42501'; end if;
  if inv.fulfilment <> 'home_delivery' then raise exception 'this is not a home delivery order'; end if;
  if inv.status = 'void' then raise exception 'this order was voided'; end if;
  if inv.status = 'draft' then raise exception 'finish the sale first — draft orders are edited on the bill'; end if;
  if p_status is not null and p_status not in ('pending', 'dispatched', 'delivered') then raise exception 'unknown delivery status'; end if;
  if inv.delivery_status = 'delivered' and p_status is distinct from 'delivered' and p_status is not null then
    raise exception 'this order is already delivered';
  end if;
  if (p_charge is not null or p_address is not null) and inv.delivery_status <> 'pending' then
    raise exception 'the order has left the shop — the delivery charge and address are locked';
  end if;
  before := jsonb_build_object('status', inv.delivery_status, 'address', inv.delivery_address, 'total', inv.total);

  perform set_config('bdah.billing', 'on', true);

  if p_address is not null then
    if trim(p_address) = '' then raise exception 'enter the delivery address'; end if;
    update public.invoices set delivery_address = trim(p_address) where id = p_invoice;
  end if;

  if p_charge is not null then
    if p_charge < 0 then raise exception 'the delivery charge can''t be negative'; end if;
    select * into line from public.invoice_items where invoice_id = p_invoice and line_role = 'delivery_charge' for update;
    if not found then raise exception 'this order has no delivery charge line'; end if;
    if line.unit_price is distinct from p_charge then
      if inv.amount_paid <> 0 or inv.returned_amount <> 0 then
        raise exception 'money was already taken on this order, so the delivery charge is locked — use a refund/return instead';
      end if;
      if p_charge = 0 and not private.has_permission('billing.discount') then
        raise exception 'only staff who can give discounts can waive the delivery charge (Rs. 0)' using errcode = '42501';
      end if;
      perform set_config('bdah.delivery', 'on', true);
      update public.invoice_items set unit_price = p_charge where id = line.id;
      perform set_config('bdah.delivery', '', true);
      -- Re-total the issued bill (same formula as recalc_invoice, which only touches drafts).
      update public.invoices i set
        subtotal = t.subtotal, line_discounts = t.disc, tax_total = t.tax, total = greatest(0, t.total - i.invoice_discount)
      from (select coalesce(sum(line_subtotal), 0) subtotal, coalesce(sum(discount_amount), 0) disc,
                   coalesce(sum(tax_amount), 0) tax, coalesce(sum(line_total), 0) total
            from public.invoice_items where invoice_id = p_invoice) t
      where i.id = p_invoice;
      -- Keep the cash-on-delivery due equal to what is now owed.
      select * into inv from public.invoices where id = p_invoice;
      if inv.balance > 0 then
        insert into public.dues (invoice_id, customer_id, pet_id, original_amount, reason, promised_date)
        values (p_invoice, inv.customer_id, inv.pet_id, inv.balance, 'Cash on delivery', private.clinic_today())
        on conflict (invoice_id) do update set original_amount = excluded.original_amount, status = 'open', closed_at = null;
      end if;
      insert into public.audit_logs (actor_id, action, table_name, record_id, reason, context)
      values ((select auth.uid()), 'delivery.charge_changed', 'invoices', p_invoice::text, nullif(trim(p_note), ''),
              jsonb_build_object('from', line.unit_price, 'to', p_charge));
    end if;
  end if;

  update public.invoices set
    delivery_status = coalesce(p_status, delivery_status),
    dispatched_at = case when p_status in ('dispatched', 'delivered') then coalesce(dispatched_at, now())
                         when p_status = 'pending' then null else dispatched_at end,
    dispatched_by = case when p_status in ('dispatched', 'delivered') then coalesce(dispatched_by, (select auth.uid()))
                         when p_status = 'pending' then null else dispatched_by end,
    delivered_at  = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
    delivered_by  = case when p_status = 'delivered' then coalesce(delivered_by, (select auth.uid())) else delivered_by end,
    delivery_rider = coalesce(nullif(trim(p_rider), ''), delivery_rider),
    delivery_notes = case when nullif(trim(p_note), '') is null then delivery_notes
                          else concat_ws(E'\n', delivery_notes, trim(p_note)) end
  where id = p_invoice;
  perform set_config('bdah.billing', '', true);

  if p_status is not null and p_status is distinct from before ->> 'status' then
    insert into public.audit_logs (actor_id, action, table_name, record_id, reason, context)
    values ((select auth.uid()), 'delivery.' || p_status, 'invoices', p_invoice::text, nullif(trim(p_note), ''), before);
  end if;
end $$;

/**
 * Pet store checkout — as before, plus optional home delivery:
 *  p_delivery = {"address": "...", "charge": 50, "notes": "..."}  (charge omitted → price-list default)
 * The delivery charge is added as its own line; cash on delivery = no payment now + p_pay_later.
 */
drop function public.pos_checkout(text, uuid, uuid, jsonb, jsonb, numeric, text, jsonb);
create or replace function public.pos_checkout(p_key text, p_customer uuid, p_pet uuid, p_lines jsonb, p_payments jsonb,
  p_invoice_discount numeric default 0, p_discount_reason text default null, p_pay_later jsonb default null,
  p_delivery jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv_id uuid; l jsonb; i int := 0; dl public.catalog_items; charge numeric;
begin
  if not private.has_permission('pos.use') then raise exception 'permission denied: pos.use' using errcode = '42501'; end if;
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
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'public.pos_checkout(text, uuid, uuid, jsonb, jsonb, numeric, text, jsonb, jsonb)',
    'public.update_delivery(uuid, text, numeric, text, text, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
