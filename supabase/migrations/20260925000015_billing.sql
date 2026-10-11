-- =============================================================================
-- Phase 4 — Invoices, payments, dues, returns & customer ledger (spec §16, §44–46, §51)
--
-- Money rules enforced here:
--  * Line prices come from the price list (unless the item is marked price-editable);
--    all totals are calculated by the database, never trusted from the screen.
--  * Issued invoices are locked. Mistakes → void (stock restored) or return / refund.
--  * Payments, refunds and write-offs are append-only and written only by functions,
--    each with an idempotency key so a double-click can't charge twice.
--  * Discounts need billing.discount; large ones need billing.discount_approve.
--  * Every unpaid balance becomes a formal due with a promised date and a reason;
--    large or repeat dues are flagged for manager approval. Dues close automatically at zero.
--  * Expired stock can never be sold (enforced by consume_stock).
-- =============================================================================

create type public.invoice_kind as enum ('clinic', 'store');
create type public.invoice_status as enum ('draft', 'issued', 'void');
create type public.payment_kind as enum ('payment', 'refund', 'write_off');

create table public.payment_methods (
  key                text primary key,
  label              text not null,
  needs_reference    boolean not null default false,
  is_active          boolean not null default true,
  sort_order         int not null default 100
);
insert into public.payment_methods (key, label, needs_reference, sort_order) values
  ('cash', 'Cash', false, 1), ('card', 'Card', false, 2), ('bank', 'Bank transfer / IBFT', true, 3),
  ('raast', 'Raast', true, 4), ('jazzcash', 'JazzCash', true, 5), ('easypaisa', 'Easypaisa', true, 6),
  ('cheque', 'Cheque', true, 7);

insert into public.system_settings (key, value, description) values
('billing.config', jsonb_build_object(
  'invoice_prefix', 'BD',
  'discount_approval_percent', 20,       -- discounts above this % of the bill need manager approval
  'due_approval_amount', 5000,           -- unpaid balances above this need manager approval
  'invoice_footer', 'Thank you for trusting Bin Dawood Animal Hospital.'
), 'Billing rules: invoice numbering, discount & due approval thresholds')
on conflict (key) do nothing;

create table public.invoice_counters (
  prefix text not null, year int not null, last_no int not null default 0,
  primary key (prefix, year)
);

-- -----------------------------------------------------------------------------
-- Invoices
-- -----------------------------------------------------------------------------
create table public.invoices (
  id                      uuid primary key default gen_random_uuid(),
  number                  text unique,                      -- assigned on issue: BD-26-000123
  kind                    public.invoice_kind not null default 'clinic',
  customer_id             uuid references public.customers (id),
  pet_id                  uuid references public.pets (id),
  visit_id                uuid references public.visits (id),
  surgery_id              uuid references public.surgeries (id),
  admission_id            uuid references public.admissions (id),
  status                  public.invoice_status not null default 'draft',
  subtotal                numeric(12,2) not null default 0,  -- Σ qty × price
  line_discounts          numeric(12,2) not null default 0,
  invoice_discount        numeric(12,2) not null default 0 check (invoice_discount >= 0),
  discount_reason         text,
  discount_approved_by    uuid references public.staff (id),
  tax_total               numeric(12,2) not null default 0,
  total                   numeric(12,2) not null default 0 check (total >= 0),
  amount_paid             numeric(12,2) not null default 0,  -- net of refunds / write-offs, from allocations
  returned_amount         numeric(12,2) not null default 0,
  balance                 numeric(12,2) generated always as (total - returned_amount - amount_paid) stored,
  notes                   text,
  idempotency_key         text unique,
  issued_at               timestamptz,
  issued_by               uuid references public.staff (id),
  voided_at               timestamptz,
  voided_by               uuid references public.staff (id),
  void_reason             text,
  created_by              uuid references public.staff (id) default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (kind = 'store' or customer_id is not null),
  check (amount_paid >= 0 and amount_paid <= total - returned_amount),
  check (returned_amount >= 0 and returned_amount <= total),
  check ((status = 'void') = (void_reason is not null)),
  check (invoice_discount = 0 or coalesce(trim(discount_reason), '') <> '')
);
create index invoices_customer_idx on public.invoices (customer_id, created_at desc);
create index invoices_open_idx on public.invoices (customer_id) where status = 'issued' and balance > 0;
create index invoices_visit_idx on public.invoices (visit_id);
create index invoices_issued_idx on public.invoices (issued_at desc) where status = 'issued';

create table public.invoice_items (
  id                    uuid primary key default gen_random_uuid(),
  invoice_id            uuid not null references public.invoices (id) on delete cascade,
  sort_order            int not null default 0,
  item_id               uuid not null references public.catalog_items (id),
  kind                  public.catalog_kind not null default 'service',
  description           text not null default '',
  quantity              numeric(12,2) not null check (quantity > 0),
  unit_price            numeric(12,2) not null check (unit_price >= 0),
  discount_amount       numeric(12,2) not null default 0 check (discount_amount >= 0),
  tax_rate              numeric(5,2) not null default 0,
  line_subtotal         numeric(12,2) generated always as (round(quantity * unit_price, 2)) stored,
  tax_amount            numeric(12,2) generated always as (round((quantity * unit_price - discount_amount) * tax_rate / 100, 2)) stored,
  line_total            numeric(12,2) generated always as (round(quantity * unit_price - discount_amount + (quantity * unit_price - discount_amount) * tax_rate / 100, 2)) stored,
  deduct_stock          boolean not null default false,
  batch_id              uuid references public.product_batches (id),
  batch_override_reason text,
  returned_qty          numeric(12,2) not null default 0,
  source_table          text,                 -- visits / vaccinations / prescription_items / diagnostic_orders / surgeries / admissions
  source_id             uuid,
  check (discount_amount <= round(quantity * unit_price, 2)),
  check (returned_qty >= 0 and returned_qty <= quantity)
);
create index invoice_items_invoice_idx on public.invoice_items (invoice_id, sort_order);
create index invoice_items_source_idx on public.invoice_items (source_table, source_id);

-- Prices, description, kind and stock flag come from the price list — the screen can't set them.
create or replace function private.invoice_item_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ci public.catalog_items; inv public.invoices;
begin
  select * into inv from public.invoices where id = new.invoice_id;
  if inv.status <> 'draft' then
    -- Only the return function may touch an issued line, and only returned_qty.
    if tg_op = 'UPDATE' and current_setting('bdah.billing', true) = 'on'
       and (to_jsonb(new) - 'returned_qty') = (to_jsonb(old) - 'returned_qty') then
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
  if new.discount_amount > 0 and not private.has_permission('billing.discount') and pg_trigger_depth() < 2 then
    raise exception 'you don''t have permission to give discounts' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger invoice_items_defaults before insert or update on public.invoice_items
  for each row execute function private.invoice_item_defaults();

create or replace function private.guard_invoice_item_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.invoices where id = old.invoice_id and status <> 'draft') then
    raise exception 'this invoice is issued and locked' using errcode = '42501';
  end if;
  return old;
end $$;
create trigger invoice_items_guard_delete before delete on public.invoice_items
  for each row execute function private.guard_invoice_item_delete();

create or replace function private.recalc_invoice(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.invoices i set
    subtotal = t.subtotal, line_discounts = t.disc, tax_total = t.tax,
    total = greatest(0, t.total - i.invoice_discount)
  from (select coalesce(sum(line_subtotal), 0) subtotal, coalesce(sum(discount_amount), 0) disc,
               coalesce(sum(tax_amount), 0) tax, coalesce(sum(line_total), 0) total
        from public.invoice_items where invoice_id = p_id) t
  where i.id = p_id and i.status = 'draft';
end $$;

create or replace function private.invoice_items_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.recalc_invoice(coalesce(new.invoice_id, old.invoice_id));
  return null;
end $$;
create trigger invoice_items_recalc after insert or update or delete on public.invoice_items
  for each row execute function private.invoice_items_changed();

-- Direct edits to an invoice row: drafts only (header fields); money fields are recalculated.
create or replace function private.guard_invoice()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'issued invoices cannot be deleted — void them' using errcode = '42501'; end if;
    return old;
  end if;
  if pg_trigger_depth() < 2 and current_setting('bdah.billing', true) is distinct from 'on' then
    if old.status <> 'draft' then raise exception 'this invoice is issued and locked' using errcode = '42501'; end if;
    if new.status is distinct from old.status or new.number is distinct from old.number
       or new.amount_paid is distinct from old.amount_paid or new.returned_amount is distinct from old.returned_amount
       or new.issued_at is distinct from old.issued_at then
      raise exception 'use the billing functions to issue, pay or void' using errcode = '42501';
    end if;
    if new.invoice_discount > 0 and new.invoice_discount is distinct from old.invoice_discount
       and not private.has_permission('billing.discount') then
      raise exception 'you don''t have permission to give discounts' using errcode = '42501';
    end if;
    new.total := greatest(0, new.subtotal - new.line_discounts + new.tax_total - new.invoice_discount);
  end if;
  return new;
end $$;
create trigger invoices_guard before update or delete on public.invoices
  for each row execute function private.guard_invoice();

-- -----------------------------------------------------------------------------
-- Payments (append-only; written only by functions)
-- -----------------------------------------------------------------------------
create sequence public.receipt_code_seq start 1;

create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique default 'RCPT-' || lpad(nextval('public.receipt_code_seq')::text, 6, '0'),
  kind             public.payment_kind not null default 'payment',
  customer_id      uuid references public.customers (id),
  amount           numeric(12,2) not null check (amount > 0),
  method           text not null references public.payment_methods (key),
  reference        text,
  notes            text,
  idempotency_key  text unique,
  received_at      timestamptz not null default now(),
  received_by      uuid references public.staff (id) default auth.uid()
);
create index payments_customer_idx on public.payments (customer_id, received_at desc);
create index payments_day_idx on public.payments (received_at desc);
alter sequence public.receipt_code_seq owned by public.payments.code;
insert into public.payment_methods (key, label, sort_order, is_active) values ('write_off', 'Written off', 99, false)
on conflict do nothing;

create table public.payment_allocations (
  id          bigint generated always as identity primary key,
  payment_id  uuid not null references public.payments (id),
  invoice_id  uuid not null references public.invoices (id),
  amount      numeric(12,2) not null check (amount <> 0),   -- + pays the invoice, − refund
  created_at  timestamptz not null default now()
);
create index payment_allocations_invoice_idx on public.payment_allocations (invoice_id);
create index payment_allocations_payment_idx on public.payment_allocations (payment_id);

create or replace function private.apply_allocation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('bdah.billing', 'on', true);
  update public.invoices set amount_paid = amount_paid + new.amount where id = new.invoice_id;
  perform set_config('bdah.billing', '', true);
  return new;
exception when check_violation then
  raise exception 'this payment would take the invoice below zero or above its total' using errcode = 'P0001';
end $$;
create trigger payment_allocations_apply after insert on public.payment_allocations
  for each row execute function private.apply_allocation();

-- -----------------------------------------------------------------------------
-- Dues (every unpaid balance is a formal receivable — spec §44)
-- -----------------------------------------------------------------------------
create table public.dues (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null unique references public.invoices (id),
  customer_id       uuid not null references public.customers (id),
  pet_id            uuid references public.pets (id),
  original_amount   numeric(12,2) not null check (original_amount > 0),
  reason            text not null check (length(trim(reason)) > 2),
  promised_date     date not null,
  priority          text not null default 'normal' check (priority in ('normal', 'high')),
  status            text not null default 'open' check (status in ('open', 'paid', 'written_off', 'cancelled')),
  approval_status   text not null default 'not_needed' check (approval_status in ('not_needed', 'pending', 'approved', 'rejected')),
  approval_note     text,
  approved_by       uuid references public.staff (id),
  approved_at       timestamptz,
  missed_promises   int not null default 0,
  created_by        uuid references public.staff (id) default auth.uid(),
  created_at        timestamptz not null default now(),
  closed_at         timestamptz
);
create index dues_open_idx on public.dues (promised_date) where status = 'open';
create index dues_customer_idx on public.dues (customer_id);

create table public.due_promises (
  id            bigint generated always as identity primary key,
  due_id        uuid not null references public.dues (id) on delete cascade,
  promised_date date not null,
  previous_date date,
  note          text,
  was_missed    boolean not null default false,   -- previous promise date had passed unpaid
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now()
);

-- Balance hits zero → due closes; invoice voided → due cancelled.
create or replace function private.invoice_settled()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'issued' and new.balance <= 0 and old.balance > 0 then
    update public.dues set status = 'paid', closed_at = now() where invoice_id = new.id and status = 'open';
  elsif new.status = 'issued' and new.balance > 0 and old.balance <= 0 then
    update public.dues set status = 'open', closed_at = null where invoice_id = new.id and status = 'paid';
  elsif new.status = 'void' and old.status <> 'void' then
    update public.dues set status = 'cancelled', closed_at = now() where invoice_id = new.id and status = 'open';
  end if;
  return null;
end $$;
create trigger invoices_settled after update on public.invoices
  for each row execute function private.invoice_settled();

-- -----------------------------------------------------------------------------
-- Returns (store/medicine returns after issue)
-- -----------------------------------------------------------------------------
create table public.invoice_returns (
  id          uuid primary key default gen_random_uuid(),
  idempotency_key text unique,
  invoice_id  uuid not null references public.invoices (id),
  amount      numeric(12,2) not null check (amount > 0),
  reason      text not null check (length(trim(reason)) > 2),
  lines       jsonb not null,                    -- [{invoice_item_id, qty, amount}]
  created_by  uuid references public.staff (id) default auth.uid(),
  created_at  timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Functions
-- -----------------------------------------------------------------------------
create or replace function private.billing_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select value from public.system_settings where key = 'billing.config'), '{}'::jsonb);
$$;

create or replace function private.next_invoice_number()
returns text language plpgsql security definer set search_path = '' as $$
declare pre text := coalesce(private.billing_config() ->> 'invoice_prefix', 'BD');
        yr int := extract(year from private.clinic_today())::int; n int;
begin
  insert into public.invoice_counters as c (prefix, year, last_no) values (pre, yr, 1)
  on conflict (prefix, year) do update set last_no = c.last_no + 1 returning last_no into n;
  return pre || '-' || lpad((yr % 100)::text, 2, '0') || '-' || lpad(n::text, 6, '0');
end $$;

/** Allocate a payment row to an invoice (internal). */
create or replace function private.allocate(p_payment uuid, p_invoice uuid, p_amount numeric)
returns void language sql security definer set search_path = '' as $$
  insert into public.payment_allocations (payment_id, invoice_id, amount) values (p_payment, p_invoice, p_amount);
$$;

/**
 * Issue a draft invoice: checks discount rules, deducts stock (FEFO), assigns the number and locks it.
 * If the bill will not be fully paid now, p_pay_later = {"promised_date":"YYYY-MM-DD","reason":"…","priority":"normal|high"}
 * creates the due. Payments are recorded separately with record_payment (same transaction in the UI flow).
 */
create or replace function public.issue_invoice(p_id uuid, p_pay_now numeric default 0, p_pay_later jsonb default null)
returns text language plpgsql security definer set search_path = '' as $$
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

  -- Discount rules
  disc := inv.line_discounts + inv.invoice_discount;
  if disc > 0 then
    if not private.has_permission('billing.discount') then raise exception 'you don''t have permission to give discounts' using errcode = '42501'; end if;
    pct := case when inv.subtotal > 0 then disc * 100 / inv.subtotal else 0 end;
    if pct > coalesce((cfg ->> 'discount_approval_percent')::numeric, 20) then
      if not private.has_permission('billing.discount_approve') then
        raise exception 'a discount of %%% needs a manager — ask them to issue this bill', round(pct);
      end if;
    end if;
    if private.has_permission('billing.discount_approve') then
      perform set_config('bdah.billing', 'on', true);
      update public.invoices set discount_approved_by = (select auth.uid()) where id = p_id;
    end if;
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
    if p_pay_later is null or coalesce(trim(p_pay_later ->> 'reason'), '') = '' or (p_pay_later ->> 'promised_date') is null then
      raise exception 'Rs. % will be left unpaid — record a promised payment date and reason', unpaid;
    end if;
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
end $$;

/**
 * Record money received. Idempotent by p_key (the screen generates one key per submit).
 * p_invoice set → allocate to that invoice first (up to its balance).
 * p_auto → allocate any remainder to the customer's oldest open invoices; else it stays as credit (advance/deposit).
 */
create or replace function public.record_payment(p_customer uuid, p_amount numeric, p_method text, p_key text,
  p_invoice uuid default null, p_reference text default null, p_auto boolean default true, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare pay uuid; left_amt numeric := p_amount; inv record; take numeric; m public.payment_methods; kind_inv public.invoice_kind;
begin
  if coalesce(trim(p_key), '') = '' then raise exception 'missing idempotency key'; end if;
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
end $$;

/** Use a customer's unallocated credit (e.g. surgery deposit) against an invoice. */
create or replace function public.apply_credit(p_invoice uuid)
returns numeric language plpgsql security definer set search_path = '' as $$
declare inv public.invoices; p record; free numeric; take numeric; used numeric := 0;
begin
  if not private.has_permission('billing.create') then raise exception 'permission denied' using errcode = '42501'; end if;
  select * into inv from public.invoices where id = p_invoice for update;
  if inv.status <> 'issued' then raise exception 'issue the invoice first'; end if;
  for p in select pm.id, pm.amount - coalesce((select sum(a.amount) from public.payment_allocations a where a.payment_id = pm.id), 0) as free
           from public.payments pm where pm.customer_id = inv.customer_id and pm.kind = 'payment' order by pm.received_at loop
    exit when inv.balance - used <= 0;
    continue when p.free <= 0;
    take := least(p.free, inv.balance - used);
    perform private.allocate(p.id, p_invoice, take);
    used := used + take;
  end loop;
  return used;
end $$;

create or replace function private.refund_internal(p_invoice uuid, p_amount numeric, p_method text, p_reason text, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invoices; pay uuid;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if inv.status <> 'issued' then raise exception 'only issued invoices can be refunded'; end if;
  if p_amount <= 0 or p_amount > inv.amount_paid then raise exception 'you can refund at most Rs. %', inv.amount_paid; end if;
  if not exists (select 1 from public.payment_methods where key = p_method and key <> 'write_off') then raise exception 'unknown refund method'; end if;
  insert into public.payments (kind, customer_id, amount, method, notes, idempotency_key)
  values ('refund', inv.customer_id, p_amount, p_method, p_reason, p_key) returning id into pay;
  perform private.allocate(pay, p_invoice, -p_amount);
  insert into public.audit_logs (actor_id, action, table_name, record_id, reason, context)
  values ((select auth.uid()), 'invoice.refund', 'invoices', p_invoice::text, p_reason, jsonb_build_object('amount', p_amount));
  return pay;
end $$;

/** Refund money on an invoice (billing.refund). */
create or replace function public.refund_payment(p_invoice uuid, p_amount numeric, p_method text, p_reason text, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invoices; pay uuid;
begin
  if not private.has_permission('billing.refund') then raise exception 'permission denied: billing.refund' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select id into pay from public.payments where idempotency_key = p_key;
  if found then return pay; end if;
  return private.refund_internal(p_invoice, p_amount, p_method, p_reason, p_key);
end $$;

/** Void an issued invoice: only when nothing is paid; stock goes back. */
create or replace function public.void_invoice(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare inv public.invoices;
begin
  if not private.has_permission('billing.void') then raise exception 'permission denied: billing.void' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into inv from public.invoices where id = p_id for update;
  if inv.status <> 'issued' then raise exception 'only issued invoices can be voided (delete drafts instead)'; end if;
  if inv.amount_paid > 0 then raise exception 'refund the Rs. % paid before voiding', inv.amount_paid; end if;
  if inv.returned_amount > 0 then raise exception 'items were already returned on this invoice'; end if;
  perform private.reverse_stock('invoice_items', it.id, 'Invoice voided: ' || p_reason)
    from public.invoice_items it where it.invoice_id = p_id;
  perform set_config('bdah.billing', 'on', true);
  update public.invoices set status = 'void', voided_at = now(), voided_by = (select auth.uid()), void_reason = p_reason where id = p_id;
  perform set_config('bdah.billing', '', true);
end $$;

/** Write off what's left of a due (manager). */
create or replace function public.write_off_due(p_due uuid, p_reason text, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.dues; inv public.invoices; pay uuid;
begin
  if not private.has_permission('billing.discount_approve') then raise exception 'only a manager can write off dues' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into d from public.dues where id = p_due for update;
  if d.status <> 'open' then raise exception 'this due is already %', d.status; end if;
  select * into inv from public.invoices where id = d.invoice_id for update;
  if exists (select 1 from public.payments where idempotency_key = p_key) then return; end if;
  insert into public.payments (kind, customer_id, amount, method, notes, idempotency_key)
  values ('write_off', d.customer_id, inv.balance, 'write_off', p_reason, p_key) returning id into pay;
  perform private.allocate(pay, inv.id, inv.balance);
  update public.dues set status = 'written_off', closed_at = now() where id = p_due;
end $$;

/** Change the promised date — previous date kept; missing a promise is counted (spec §45). */
create or replace function public.update_due_promise(p_due uuid, p_date date, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.dues; missed boolean;
begin
  if not (private.has_permission('billing.create') or private.has_permission('crm.manage')) then raise exception 'permission denied' using errcode = '42501'; end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'say why the date is changing'; end if;
  if p_date < private.clinic_today() then raise exception 'the new date can''t be in the past'; end if;
  select * into d from public.dues where id = p_due for update;
  if d.status <> 'open' then raise exception 'this due is %', d.status; end if;
  missed := d.promised_date < private.clinic_today();
  insert into public.due_promises (due_id, promised_date, previous_date, note, was_missed) values (p_due, p_date, d.promised_date, p_note, missed);
  update public.dues set promised_date = p_date, missed_promises = missed_promises + case when missed then 1 else 0 end,
         priority = case when missed_promises + (case when missed then 1 else 0 end) >= 2 then 'high' else priority end
   where id = p_due;
end $$;

create or replace function public.approve_due(p_due uuid, p_approve boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('billing.discount_approve') then raise exception 'only a manager can approve dues' using errcode = '42501'; end if;
  update public.dues set approval_status = case when p_approve then 'approved' else 'rejected' end,
         approval_note = p_note, approved_by = (select auth.uid()), approved_at = now()
   where id = p_due and approval_status = 'pending';
  if not found then raise exception 'nothing to approve'; end if;
end $$;

/**
 * Return items from an issued invoice. Stock goes back (if tracked), invoice net total drops,
 * and optionally cash is refunded immediately (otherwise it becomes customer credit).
 * p_lines = [{"invoice_item_id": "...", "qty": 1}]
 */
create or replace function public.return_items(p_invoice uuid, p_lines jsonb, p_reason text, p_refund_method text, p_key text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv public.invoices; l jsonb; it public.invoice_items; q numeric; amt numeric; total_amt numeric := 0; ret uuid;
        lines jsonb := '[]'::jsonb; refund_amt numeric; src record;
begin
  if not (private.has_permission('billing.refund') or private.has_permission('pos.return')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  if coalesce(trim(p_key), '') = '' then raise exception 'missing idempotency key'; end if;
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
end $$;

/**
 * Issue a draft invoice AND record the payments in one transaction, so there is never an
 * issued bill with a balance but no due, or a payment without its bill.
 * p_payments = [{"method","amount","reference"}]; p_pay_later required if not fully paid.
 */
create or replace function public.checkout_invoice(p_id uuid, p_payments jsonb, p_pay_later jsonb, p_key text)
returns text language plpgsql security definer set search_path = '' as $$
declare inv public.invoices; p jsonb; paid numeric := 0; i int := 0; num text; left_total numeric; amt numeric;
begin
  if coalesce(trim(p_key), '') = '' then raise exception 'missing idempotency key'; end if;
  select * into inv from public.invoices where id = p_id for update;
  if not found then raise exception 'invoice not found'; end if;
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
end $$;

/**
 * Pet store checkout in one transaction: invoice + items + issue + payments.
 * p_lines = [{"item_id","quantity","discount_amount","batch_id","batch_override_reason"}]
 * p_payments = [{"method","amount","reference"}]
 */
create or replace function public.pos_checkout(p_key text, p_customer uuid, p_pet uuid, p_lines jsonb, p_payments jsonb,
  p_invoice_discount numeric default 0, p_discount_reason text default null, p_pay_later jsonb default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare inv_id uuid; l jsonb; i int := 0;
begin
  if not private.has_permission('pos.use') then raise exception 'permission denied: pos.use' using errcode = '42501'; end if;
  select id into inv_id from public.invoices where idempotency_key = p_key;
  if found then return inv_id; end if;                                -- double tap on "Pay" → same sale
  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then raise exception 'the cart is empty'; end if;

  insert into public.invoices (kind, customer_id, pet_id, invoice_discount, discount_reason)
  values ('store', p_customer, p_pet, coalesce(p_invoice_discount, 0), nullif(trim(p_discount_reason), '')) returning id into inv_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    insert into public.invoice_items (invoice_id, sort_order, item_id, quantity, unit_price, discount_amount, batch_id, batch_override_reason)
    values (inv_id, i, (l ->> 'item_id')::uuid, (l ->> 'quantity')::numeric, coalesce((l ->> 'unit_price')::numeric, 0),
            coalesce((l ->> 'discount_amount')::numeric, 0), nullif(l ->> 'batch_id', '')::uuid, nullif(l ->> 'batch_override_reason', ''));
  end loop;
  perform public.checkout_invoice(inv_id, p_payments, p_pay_later, p_key);
  return inv_id;
end $$;

do $$ declare f text; begin
  foreach f in array array[
    'public.issue_invoice(uuid, numeric, jsonb)', 'public.record_payment(uuid, numeric, text, text, uuid, text, boolean, text)',
    'public.apply_credit(uuid)', 'public.refund_payment(uuid, numeric, text, text, text)', 'public.void_invoice(uuid, text)',
    'public.write_off_due(uuid, text, text)', 'public.update_due_promise(uuid, date, text)', 'public.approve_due(uuid, boolean, text)',
    'public.return_items(uuid, jsonb, text, text, text)', 'public.checkout_invoice(uuid, jsonb, jsonb, text)',
    'public.pos_checkout(text, uuid, uuid, jsonb, jsonb, numeric, text, jsonb)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Customer ledger (spec §46) — security invoker, so RLS on the base tables applies.
-- Positive balance = the customer owes the clinic; negative = the clinic holds credit.
-- -----------------------------------------------------------------------------
create view public.customer_ledger with (security_invoker = true) as
select customer_id, issued_at as at, 'invoice'::text as entry, id as ref_id, number as ref, total as debit, 0::numeric as credit
  from public.invoices where status = 'issued' and customer_id is not null
union all
select i.customer_id, r.created_at, 'return', r.id, i.number, 0, r.amount
  from public.invoice_returns r join public.invoices i on i.id = r.invoice_id where i.customer_id is not null
union all
select customer_id, received_at, kind::text, id, code,
       case when kind = 'refund' then amount else 0 end,
       case when kind <> 'refund' then amount else 0 end
  from public.payments where customer_id is not null;

create view public.customer_balances with (security_invoker = true) as
select customer_id, sum(debit) - sum(credit) as balance from public.customer_ledger group by customer_id;

-- -----------------------------------------------------------------------------
-- Keep customer merges complete now that more tables point at customers.
-- -----------------------------------------------------------------------------
create or replace function public.merge_customers(p_source uuid, p_target uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
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

  update public.customers
     set status = 'merged', merged_into_id = p_target,
         notes = concat_ws(E'\n', notes, 'Merged into target on ' || now()::date || ': ' || p_reason)
   where id = p_source;

  insert into public.audit_logs (actor_id, action, table_name, record_id, reason, context)
  values ((select auth.uid()), 'customer.merged', 'customers', p_source::text, p_reason, jsonb_build_object('target', p_target));
end $$;

-- Surgery materials can now point at stock items (deduction happens when billed).
alter table public.surgery_consumables
  add constraint surgery_consumables_product_fk foreign key (product_id) references public.catalog_items (id);

create trigger invoices_updated_at before update on public.invoices
  for each row execute function private.set_updated_at();

create trigger audit_payment_methods after insert or update or delete on public.payment_methods
  for each row execute function private.audit_row();
create trigger audit_invoices after insert or update or delete on public.invoices
  for each row execute function private.audit_row();
create trigger audit_invoice_items after insert or update or delete on public.invoice_items
  for each row execute function private.audit_row();
create trigger audit_payments after insert on public.payments
  for each row execute function private.audit_row();
create trigger audit_dues after insert or update on public.dues
  for each row execute function private.audit_row();
create trigger audit_invoice_returns after insert on public.invoice_returns
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.payment_methods     enable row level security;
alter table public.invoice_counters    enable row level security;   -- function-only
alter table public.invoices            enable row level security;
alter table public.invoice_items       enable row level security;
alter table public.payments            enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.dues                enable row level security;
alter table public.due_promises        enable row level security;
alter table public.invoice_returns     enable row level security;

create policy payment_methods_select on public.payment_methods for select to authenticated using ((select private.is_active_staff()));
create policy payment_methods_manage on public.payment_methods for all to authenticated
  using ((select private.has_permission('settings.manage'))) with check ((select private.has_permission('settings.manage')));

create or replace function private.can_see_invoice(p_kind public.invoice_kind)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_permission('billing.view') or (p_kind = 'store' and private.has_permission('pos.use'));
$$;
create or replace function private.can_write_invoice(p_kind public.invoice_kind)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_permission('billing.create') or (p_kind = 'store' and private.has_permission('pos.use'));
$$;
grant execute on function private.can_see_invoice(public.invoice_kind) to authenticated;
grant execute on function private.can_write_invoice(public.invoice_kind) to authenticated;

create policy invoices_select on public.invoices for select to authenticated using (private.can_see_invoice(kind));
create policy invoices_insert on public.invoices for insert to authenticated
  with check (private.can_write_invoice(kind) and status = 'draft' and amount_paid = 0 and number is null);
create policy invoices_update on public.invoices for update to authenticated
  using (private.can_write_invoice(kind)) with check (private.can_write_invoice(kind));
create policy invoices_delete on public.invoices for delete to authenticated
  using (private.can_write_invoice(kind) and status = 'draft');

create policy invoice_items_select on public.invoice_items for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and private.can_see_invoice(i.kind)));
create policy invoice_items_write on public.invoice_items for all to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft' and private.can_write_invoice(i.kind)))
  with check (exists (select 1 from public.invoices i where i.id = invoice_id and i.status = 'draft' and private.can_write_invoice(i.kind)));

create policy payments_select on public.payments for select to authenticated
  using ((select private.has_permission('billing.view')) or (select private.has_permission('pos.use')));
create policy payment_allocations_select on public.payment_allocations for select to authenticated
  using ((select private.has_permission('billing.view')) or (select private.has_permission('pos.use')));
-- No write policies on payments / allocations: only the billing functions write them.

create policy dues_select on public.dues for select to authenticated
  using ((select private.has_permission('billing.view')) or (select private.has_permission('crm.manage')));
create policy due_promises_select on public.due_promises for select to authenticated
  using ((select private.has_permission('billing.view')) or (select private.has_permission('crm.manage')));
create policy invoice_returns_select on public.invoice_returns for select to authenticated
  using ((select private.has_permission('billing.view')) or (select private.has_permission('pos.use')));
