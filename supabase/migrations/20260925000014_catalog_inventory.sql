-- =============================================================================
-- Phase 4 — Price list, inventory & suppliers (spec §17, §18, §19)
--
-- Money & stock rules enforced here:
--  * Stock only changes through inventory_movements (append-only). Batch quantities are
--    maintained by trigger and can never go below zero.
--  * Expired batches can never be sold or dispensed. Default picking is FEFO (first-expiry-first-out);
--    choosing a different batch requires a reason (logged on the movement).
--  * Manual adjustments / write-offs need inventory.adjust and a reason.
--  * Cost prices live in separate tables visible only with inventory.view_cost.
-- =============================================================================

create type public.catalog_kind as enum ('service', 'product');
create type public.movement_kind as enum
  ('receive', 'sale', 'dispense', 'surgery_use', 'return_in', 'return_to_supplier', 'adjust', 'wastage', 'expired',
   'transfer_in', 'transfer_out', 'reversal');

-- -----------------------------------------------------------------------------
-- Price list: services (consultation, ultrasound…) and products (medicines, food, toys…)
-- -----------------------------------------------------------------------------
create table public.catalog_items (
  id                   uuid primary key default gen_random_uuid(),
  kind                 public.catalog_kind not null,
  name                 text not null check (length(trim(name)) > 0),
  category             text,
  brand                text,
  sku                  text unique,
  barcode              text unique,
  unit                 text not null default 'pcs',        -- tablet, strip, bottle, bag, pcs, ml
  sale_price           numeric(12,2) not null default 0 check (sale_price >= 0),
  price_is_editable    boolean not null default false,     -- e.g. "Other procedure": price set at billing
  tax_rate             numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  track_stock          boolean not null default false,
  reorder_level        numeric(12,2) check (reorder_level >= 0),
  is_retail            boolean not null default false,     -- shown in the pet store POS
  is_active            boolean not null default true,
  -- Links used to suggest bill lines from clinical records
  appointment_type_id  uuid references public.appointment_types (id),
  vaccine_id           uuid references public.vaccines (id),
  medicine_id          uuid references public.medicines (id),
  diagnostic_type_id   uuid references public.diagnostic_types (id),
  procedure_id         uuid references public.surgery_procedures (id),
  is_ward_daily_fee    boolean not null default false,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (kind = 'product' or not track_stock)
);
create index catalog_items_name_trgm on public.catalog_items using gin (lower(name) extensions.gin_trgm_ops);
create index catalog_items_kind_idx on public.catalog_items (kind, is_active);

-- Supplier cost for an item (latest agreed price) — cost visibility is restricted.
create table public.catalog_costs (
  item_id     uuid primary key references public.catalog_items (id) on delete cascade,
  cost_price  numeric(12,2) not null check (cost_price >= 0),
  updated_at  timestamptz not null default now()
);

create table public.inventory_locations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  is_default  boolean not null default false,
  is_active   boolean not null default true,
  sort_order  int not null default 100
);
create unique index inventory_locations_one_default on public.inventory_locations (is_default) where is_default;
insert into public.inventory_locations (name, is_default, sort_order) values
  ('Pharmacy', true, 1), ('Pet store', false, 2), ('Vaccine fridge', false, 3), ('Theatre', false, 4);

create table public.product_batches (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.catalog_items (id),
  location_id   uuid not null references public.inventory_locations (id),
  batch_no      text not null default '',
  expiry_date   date,
  qty_on_hand   numeric(12,2) not null default 0 check (qty_on_hand >= 0),   -- maintained by trigger only
  received_at   timestamptz not null default now(),
  unique nulls not distinct (item_id, location_id, batch_no, expiry_date)
);
create index product_batches_item_idx on public.product_batches (item_id, expiry_date) where qty_on_hand > 0;

create table public.batch_costs (
  batch_id   uuid primary key references public.product_batches (id) on delete cascade,
  unit_cost  numeric(12,2) not null check (unit_cost >= 0)
);

create table public.inventory_movements (
  id          bigint generated always as identity primary key,
  batch_id    uuid not null references public.product_batches (id),
  item_id     uuid not null references public.catalog_items (id),
  location_id uuid not null references public.inventory_locations (id),
  qty         numeric(12,2) not null check (qty <> 0),                 -- + in, − out
  kind        public.movement_kind not null,
  reason      text,
  ref_table   text,
  ref_id      uuid,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  check (kind not in ('adjust', 'wastage', 'expired', 'return_to_supplier') or coalesce(trim(reason), '') <> '')
);
create index inventory_movements_item_idx on public.inventory_movements (item_id, created_at desc);
create index inventory_movements_ref_idx on public.inventory_movements (ref_table, ref_id);

-- Movements drive the batch balance. Batches can't be edited directly.
create or replace function private.apply_movement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.product_batches set qty_on_hand = qty_on_hand + new.qty where id = new.batch_id;
  -- qty_on_hand >= 0 check raises if this would go negative
  return new;
exception when check_violation then
  raise exception 'not enough stock in this batch' using errcode = 'P0001';
end $$;
create trigger inventory_movements_apply after insert on public.inventory_movements
  for each row execute function private.apply_movement();

create or replace function private.guard_batch()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.qty_on_hand is distinct from old.qty_on_hand and pg_trigger_depth() < 2 then
    raise exception 'stock quantities change only through stock movements' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger product_batches_guard before update on public.product_batches
  for each row execute function private.guard_batch();

-- -----------------------------------------------------------------------------
-- Stock helpers (used by billing, POS, surgery). Security definer: callers are
-- checked by the calling function / RLS; these never run directly from the API.
-- -----------------------------------------------------------------------------

/** Take `qty` of an item out of stock, earliest expiry first, never from expired batches. */
create or replace function private.consume_stock(p_item uuid, p_qty numeric, p_kind public.movement_kind,
  p_ref_table text, p_ref_id uuid, p_batch uuid default null, p_override_reason text default null,
  p_location uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  need numeric := p_qty;
  b record;
  take numeric;
  today date := private.clinic_today();
  item_name text;
begin
  if p_qty <= 0 then return; end if;
  select name into item_name from public.catalog_items where id = p_item;

  if p_batch is not null then
    select * into b from public.product_batches where id = p_batch and item_id = p_item for update;
    if not found then raise exception 'batch not found for %', item_name; end if;
    if b.expiry_date is not null and b.expiry_date < today then
      raise exception '% batch % is expired (%) — it cannot be sold', item_name, b.batch_no, b.expiry_date;
    end if;
    -- Picking a batch other than the FEFO choice needs a reason.
    if exists (select 1 from public.product_batches x
               where x.item_id = p_item and x.qty_on_hand > 0 and x.id <> b.id
                 and (x.expiry_date is null or x.expiry_date >= today)
                 and coalesce(x.expiry_date, 'infinity') < coalesce(b.expiry_date, 'infinity'))
       and coalesce(trim(p_override_reason), '') = '' then
      raise exception 'an earlier-expiring batch of % exists — give a reason to use batch %', item_name, b.batch_no;
    end if;
    if b.qty_on_hand < need then
      raise exception 'only % left of % in batch %', b.qty_on_hand, item_name, b.batch_no;
    end if;
    insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, reason, ref_table, ref_id)
    values (b.id, p_item, b.location_id, -need, p_kind, nullif(trim(p_override_reason), ''), p_ref_table, p_ref_id);
    return;
  end if;

  for b in
    select * from public.product_batches
     where item_id = p_item and qty_on_hand > 0
       and (expiry_date is null or expiry_date >= today)
       and (p_location is null or location_id = p_location)
     order by expiry_date nulls last, received_at
     for update
  loop
    exit when need <= 0;
    take := least(need, b.qty_on_hand);
    insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, ref_table, ref_id)
    values (b.id, p_item, b.location_id, -take, p_kind, p_ref_table, p_ref_id);
    need := need - take;
  end loop;

  if need > 0 then
    raise exception 'not enough % in stock (short by %) — receive stock or adjust the count first', item_name, need
      using errcode = 'P0001';
  end if;
end $$;

/** Put back exactly what a document took out (void / return). */
create or replace function private.reverse_stock(p_ref_table text, p_ref_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare m record;
begin
  for m in select * from public.inventory_movements where ref_table = p_ref_table and ref_id = p_ref_id and kind <> 'reversal'
  loop
    insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, reason, ref_table, ref_id)
    values (m.batch_id, m.item_id, m.location_id, -m.qty, 'reversal', p_reason, p_ref_table, p_ref_id);
  end loop;
end $$;

-- Manual stock count / write-off (API-callable, permission-checked).
create or replace function public.adjust_stock(p_batch uuid, p_qty_change numeric, p_kind public.movement_kind, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.product_batches;
begin
  if not private.has_permission('inventory.adjust') then
    raise exception 'permission denied: inventory.adjust' using errcode = '42501';
  end if;
  if p_kind not in ('adjust', 'wastage', 'expired', 'return_to_supplier', 'transfer_out') then raise exception 'invalid adjustment type'; end if;
  if p_kind <> 'adjust' and p_qty_change >= 0 then raise exception 'write-offs must reduce stock'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into b from public.product_batches where id = p_batch for update;
  if not found then raise exception 'batch not found'; end if;
  insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, reason)
  values (b.id, b.item_id, b.location_id, p_qty_change, p_kind, p_reason);
end $$;

/** Move stock between locations (e.g. pharmacy → vaccine fridge). */
create or replace function public.transfer_stock(p_batch uuid, p_qty numeric, p_to_location uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare b public.product_batches; target uuid;
begin
  if not private.has_permission('inventory.manage') then raise exception 'permission denied: inventory.manage' using errcode = '42501'; end if;
  if p_qty <= 0 then raise exception 'quantity must be positive'; end if;
  select * into b from public.product_batches where id = p_batch for update;
  if not found then raise exception 'batch not found'; end if;
  if b.location_id = p_to_location then raise exception 'already in that location'; end if;
  insert into public.product_batches (item_id, location_id, batch_no, expiry_date)
  values (b.item_id, p_to_location, b.batch_no, b.expiry_date)
  on conflict (item_id, location_id, batch_no, expiry_date) do update set batch_no = excluded.batch_no
  returning id into target;
  insert into public.batch_costs (batch_id, unit_cost) select target, unit_cost from public.batch_costs where batch_id = b.id
  on conflict (batch_id) do nothing;
  insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, reason)
  values (b.id, b.item_id, b.location_id, -p_qty, 'transfer_out', coalesce(p_reason, 'Transfer'));
  insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, reason)
  values (target, b.item_id, p_to_location, p_qty, 'transfer_in', coalesce(p_reason, 'Transfer'));
end $$;

-- -----------------------------------------------------------------------------
-- Suppliers & purchases (goods received)
-- -----------------------------------------------------------------------------
create table public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  contact_name  text,
  phone         text,
  whatsapp      text,
  email         text,
  address       text,
  ntn           text,              -- tax number, if any
  notes         text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

create sequence public.purchase_code_seq start 1;

create table public.purchases (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique default 'GRN-' || lpad(nextval('public.purchase_code_seq')::text, 6, '0'),
  supplier_id     uuid not null references public.suppliers (id),
  supplier_invoice_no text,
  invoice_date    date,
  status          text not null default 'draft' check (status in ('draft', 'received', 'cancelled')),
  total           numeric(12,2) not null default 0,     -- maintained from lines
  notes           text,
  received_at     timestamptz,
  received_by     uuid references public.staff (id),
  created_by      uuid references public.staff (id) default auth.uid(),
  created_at      timestamptz not null default now()
);

create table public.purchase_lines (
  id           uuid primary key default gen_random_uuid(),
  purchase_id  uuid not null references public.purchases (id) on delete cascade,
  item_id      uuid not null references public.catalog_items (id),
  location_id  uuid not null references public.inventory_locations (id),
  batch_no     text not null default '',
  expiry_date  date,
  qty          numeric(12,2) not null check (qty > 0),
  unit_cost    numeric(12,2) not null check (unit_cost >= 0),
  line_total   numeric(12,2) generated always as (round(qty * unit_cost, 2)) stored
);

create table public.supplier_payments (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references public.suppliers (id),
  purchase_id   uuid references public.purchases (id),
  amount        numeric(12,2) not null check (amount > 0),
  method        text not null,
  paid_on       date not null default private.clinic_today(),
  reference     text,
  notes         text,
  created_by    uuid references public.staff (id) default auth.uid(),
  created_at    timestamptz not null default now()
);

create or replace function private.purchase_total()
returns trigger language plpgsql security definer set search_path = '' as $$
declare pid uuid := coalesce(new.purchase_id, old.purchase_id);
begin
  if exists (select 1 from public.purchases where id = pid and status <> 'draft') then
    raise exception 'this purchase is already received — record a return instead' using errcode = '42501';
  end if;
  update public.purchases set total = coalesce((select sum(line_total) from public.purchase_lines where purchase_id = pid), 0) where id = pid;
  return null;
end $$;
create trigger purchase_lines_total after insert or update or delete on public.purchase_lines
  for each row execute function private.purchase_total();

/** Receive a draft purchase: creates batches, stock movements and cost records in one transaction. */
create or replace function public.receive_purchase(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.purchases; l record; bid uuid; today date := private.clinic_today();
begin
  if not private.has_permission('inventory.manage') then raise exception 'permission denied: inventory.manage' using errcode = '42501'; end if;
  select * into p from public.purchases where id = p_id for update;
  if not found then raise exception 'purchase not found'; end if;
  if p.status <> 'draft' then raise exception 'this purchase was already %', p.status; end if;
  if not exists (select 1 from public.purchase_lines where purchase_id = p_id) then raise exception 'add at least one item'; end if;

  for l in select pl.*, ci.track_stock, ci.name from public.purchase_lines pl join public.catalog_items ci on ci.id = pl.item_id where pl.purchase_id = p_id loop
    if not l.track_stock then raise exception '% is not a stock item — turn on stock tracking first', l.name; end if;
    if l.expiry_date is not null and l.expiry_date < today then
      raise exception '% batch % is already expired — do not receive it', l.name, l.batch_no;
    end if;
    insert into public.product_batches (item_id, location_id, batch_no, expiry_date)
    values (l.item_id, l.location_id, l.batch_no, l.expiry_date)
    on conflict (item_id, location_id, batch_no, expiry_date) do update set batch_no = excluded.batch_no
    returning id into bid;
    insert into public.batch_costs (batch_id, unit_cost) values (bid, l.unit_cost)
    on conflict (batch_id) do update set unit_cost = excluded.unit_cost;
    insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, ref_table, ref_id)
    values (bid, l.item_id, l.location_id, l.qty, 'receive', 'purchases', p_id);
    insert into public.catalog_costs (item_id, cost_price) values (l.item_id, l.unit_cost)
    on conflict (item_id) do update set cost_price = excluded.cost_price, updated_at = now();
  end loop;

  update public.purchases set status = 'received', received_at = now(), received_by = (select auth.uid()) where id = p_id;
end $$;

create trigger catalog_items_updated_at before update on public.catalog_items
  for each row execute function private.set_updated_at();

create trigger audit_catalog_items after insert or update or delete on public.catalog_items
  for each row execute function private.audit_row();
create trigger audit_catalog_costs after insert or update or delete on public.catalog_costs
  for each row execute function private.audit_row();
create trigger audit_suppliers after insert or update or delete on public.suppliers
  for each row execute function private.audit_row();
create trigger audit_purchases after insert or update or delete on public.purchases
  for each row execute function private.audit_row();
create trigger audit_supplier_payments after insert or update or delete on public.supplier_payments
  for each row execute function private.audit_row();

-- Stock levels & alerts (security invoker → RLS of the caller applies).
create view public.stock_levels with (security_invoker = true) as
select ci.id as item_id, ci.name, ci.category, ci.unit, ci.reorder_level, ci.is_retail, ci.sale_price,
       coalesce(sum(b.qty_on_hand) filter (where b.expiry_date is null or b.expiry_date >= private.clinic_today()), 0) as usable_qty,
       coalesce(sum(b.qty_on_hand) filter (where b.expiry_date < private.clinic_today()), 0) as expired_qty,
       min(b.expiry_date) filter (where b.qty_on_hand > 0 and b.expiry_date >= private.clinic_today()) as next_expiry
from public.catalog_items ci
left join public.product_batches b on b.item_id = ci.id
where ci.track_stock and ci.is_active
group by ci.id;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.catalog_items        enable row level security;
alter table public.catalog_costs        enable row level security;
alter table public.inventory_locations  enable row level security;
alter table public.product_batches      enable row level security;
alter table public.batch_costs          enable row level security;
alter table public.inventory_movements  enable row level security;
alter table public.suppliers            enable row level security;
alter table public.purchases            enable row level security;
alter table public.purchase_lines       enable row level security;
alter table public.supplier_payments    enable row level security;

-- Prices are visible to all active staff (reception and store need them).
create policy catalog_items_select on public.catalog_items for select to authenticated using ((select private.is_active_staff()));
create policy catalog_items_manage on public.catalog_items for all to authenticated
  using ((select private.has_permission('inventory.manage')) or (select private.has_permission('settings.manage')))
  with check ((select private.has_permission('inventory.manage')) or (select private.has_permission('settings.manage')));

create policy catalog_costs_select on public.catalog_costs for select to authenticated using ((select private.has_permission('inventory.view_cost')));
create policy catalog_costs_manage on public.catalog_costs for all to authenticated
  using ((select private.has_permission('inventory.view_cost')) and (select private.has_permission('inventory.manage')))
  with check ((select private.has_permission('inventory.view_cost')) and (select private.has_permission('inventory.manage')));

create policy inventory_locations_select on public.inventory_locations for select to authenticated using ((select private.is_active_staff()));
create policy inventory_locations_manage on public.inventory_locations for all to authenticated
  using ((select private.has_permission('inventory.manage'))) with check ((select private.has_permission('inventory.manage')));

create policy product_batches_select on public.product_batches for select to authenticated
  using ((select private.has_permission('inventory.view')) or (select private.has_permission('pos.use')) or (select private.has_permission('billing.create')));
-- New empty batches may be created by inventory managers; quantities only via movements.
create policy product_batches_insert on public.product_batches for insert to authenticated
  with check ((select private.has_permission('inventory.manage')) and qty_on_hand = 0);
create policy product_batches_update on public.product_batches for update to authenticated
  using ((select private.has_permission('inventory.manage'))) with check ((select private.has_permission('inventory.manage')));

create policy batch_costs_select on public.batch_costs for select to authenticated using ((select private.has_permission('inventory.view_cost')));

create policy inventory_movements_select on public.inventory_movements for select to authenticated
  using ((select private.has_permission('inventory.view')));
-- No insert/update/delete policies: movements are written only by the stock functions.

create policy suppliers_select on public.suppliers for select to authenticated
  using ((select private.has_permission('suppliers.manage')) or (select private.has_permission('inventory.manage')) or (select private.has_permission('finance.view')));
create policy suppliers_manage on public.suppliers for all to authenticated
  using ((select private.has_permission('suppliers.manage'))) with check ((select private.has_permission('suppliers.manage')));

create policy purchases_select on public.purchases for select to authenticated
  using ((select private.has_permission('suppliers.manage')) or (select private.has_permission('finance.view')));
create policy purchases_insert on public.purchases for insert to authenticated
  with check ((select private.has_permission('suppliers.manage')) and status = 'draft');
create policy purchases_update on public.purchases for update to authenticated
  using ((select private.has_permission('suppliers.manage')) and status = 'draft')
  with check ((select private.has_permission('suppliers.manage')) and status in ('draft', 'cancelled'));

create policy purchase_lines_select on public.purchase_lines for select to authenticated
  using ((select private.has_permission('suppliers.manage')) or (select private.has_permission('finance.view')));
create policy purchase_lines_write on public.purchase_lines for all to authenticated
  using ((select private.has_permission('suppliers.manage'))) with check ((select private.has_permission('suppliers.manage')));

create policy supplier_payments_select on public.supplier_payments for select to authenticated
  using ((select private.has_permission('suppliers.manage')) or (select private.has_permission('finance.view')));
create policy supplier_payments_insert on public.supplier_payments for insert to authenticated
  with check ((select private.has_permission('suppliers.manage')) and (select private.has_permission('finance.view')));
-- Supplier payments are never edited or deleted.

revoke execute on function public.adjust_stock(uuid, numeric, public.movement_kind, text) from public, anon;
revoke execute on function public.transfer_stock(uuid, numeric, uuid, text) from public, anon;
revoke execute on function public.receive_purchase(uuid) from public, anon;
grant execute on function public.adjust_stock(uuid, numeric, public.movement_kind, text) to authenticated;
grant execute on function public.transfer_stock(uuid, numeric, uuid, text) to authenticated;
grant execute on function public.receive_purchase(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Seed: starter price list (services only; prices 0 = clinic sets them in Settings → Price list)
-- -----------------------------------------------------------------------------
insert into public.catalog_items (kind, name, category, appointment_type_id)
select 'service', t.name || ' fee', 'Consultation', t.id from public.appointment_types t
where t.name in ('Consultation', 'Follow-up', 'Emergency', 'Dressing / wound care', 'Grooming');

insert into public.catalog_items (kind, name, category, diagnostic_type_id)
select 'service', d.name, 'Diagnostics', d.id from public.diagnostic_types d;

insert into public.catalog_items (kind, name, category, procedure_id, price_is_editable)
select 'service', p.name, 'Surgery', p.id, p.name = 'Other procedure' from public.surgery_procedures p;

insert into public.catalog_items (kind, name, category, is_ward_daily_fee) values
  ('service', 'Ward stay (per day)', 'Ward', true),
  ('service', 'Other charge', 'Other', false);
update public.catalog_items set price_is_editable = true where name = 'Other charge';

insert into public.catalog_items (kind, name, category, vaccine_id, unit, track_stock)
select 'product', v.name || ' vaccine', 'Vaccines', v.id, 'dose', false from public.vaccines v;
-- Stock tracking starts OFF: switch it on per item after entering the opening stock count,
-- otherwise every bill would be refused for "not enough stock".
