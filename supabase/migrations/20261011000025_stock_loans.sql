-- =============================================================================
-- Inventory borrowing & lending between nearby businesses (POS enhancement §7)
--
--  * A loan is either "borrowed" (we received stock) or "lent" (we gave stock), with one or more
--    product lines. Returns are recorded against the loan, in parts, until nothing is outstanding.
--  * Stock moves only through inventory_movements (borrow_in / borrow_return / lend_out / lend_return),
--    so available stock is always right. Lending never takes expired stock (FEFO, same as sales).
--  * Loans are NOT purchases or sales: no invoice, no payment, no supplier bill, and reports never
--    count these movements as usage, revenue or cost. Any agreed compensation goes through the
--    normal billing / supplier workflows.
--  * Every write goes through a function with an idempotency key (double-click safe). Loans and
--    their lines can't be edited after saving — a wrong entry is cancelled (stock reversed) and re-entered.
--  * Read: inventory.view. Record / return / cancel: inventory.manage.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Partner businesses (nearby clinics, hospitals, pet stores)
-- -----------------------------------------------------------------------------
create table public.partner_businesses (
  id            uuid primary key default gen_random_uuid(),
  name          text not null check (length(trim(name)) > 0),
  kind          text not null default 'clinic' check (kind in ('clinic', 'hospital', 'pet_store', 'pharmacy', 'other')),
  contact_name  text,
  phone         text,
  address       text,
  notes         text,
  is_active     boolean not null default true,
  created_by    uuid references public.staff (id) default auth.uid(),
  created_at    timestamptz not null default now()
);
create unique index partner_businesses_name_uq on public.partner_businesses (lower(trim(name)));

-- -----------------------------------------------------------------------------
-- Loans
-- -----------------------------------------------------------------------------
create sequence public.stock_loan_code_seq start 1;

create table public.stock_loans (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique default 'SL-' || lpad(nextval('public.stock_loan_code_seq')::text, 6, '0'),
  direction             text not null check (direction in ('borrowed', 'lent')),
  partner_id            uuid not null references public.partner_businesses (id),
  loan_date             date not null default private.clinic_today(),
  expected_return_date  date,
  status                text not null default 'pending_return'
                          check (status in ('pending_return', 'partially_returned', 'fully_returned', 'cancelled')),
  reference             text,           -- their slip / phone note / agreed arrangement
  notes                 text,
  cancel_reason         text,
  cancelled_at          timestamptz,
  cancelled_by          uuid references public.staff (id),
  idempotency_key       text unique,
  created_by            uuid references public.staff (id) default auth.uid(),
  created_at            timestamptz not null default now(),
  check (expected_return_date is null or expected_return_date >= loan_date),
  check ((status = 'cancelled') = (cancel_reason is not null))
);
alter sequence public.stock_loan_code_seq owned by public.stock_loans.code;
create index stock_loans_partner_idx on public.stock_loans (partner_id, loan_date desc);
create index stock_loans_open_idx on public.stock_loans (expected_return_date) where status in ('pending_return', 'partially_returned');

create table public.stock_loan_lines (
  id            uuid primary key default gen_random_uuid(),
  loan_id       uuid not null references public.stock_loans (id) on delete cascade,
  sort_order    int not null default 0,
  item_id       uuid not null references public.catalog_items (id),
  unit          text not null,                       -- unit of measure at the time (bag, strip, bottle…)
  qty           numeric(12,2) not null check (qty > 0),
  returned_qty  numeric(12,2) not null default 0 check (returned_qty >= 0),
  location_id   uuid references public.inventory_locations (id),   -- borrowed: where it was put
  batch_no      text not null default '',            -- borrowed: their batch details
  expiry_date   date,
  notes         text,
  check (returned_qty <= qty)
);
create index stock_loan_lines_loan_idx on public.stock_loan_lines (loan_id, sort_order);
create index stock_loan_lines_item_idx on public.stock_loan_lines (item_id);

create table public.stock_loan_returns (
  id               uuid primary key default gen_random_uuid(),
  loan_id          uuid not null references public.stock_loans (id),
  returned_on      date not null default private.clinic_today(),
  notes            text,
  idempotency_key  text unique,
  created_by       uuid references public.staff (id) default auth.uid(),
  created_at       timestamptz not null default now()
);
create index stock_loan_returns_loan_idx on public.stock_loan_returns (loan_id, created_at);

create table public.stock_loan_return_lines (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references public.stock_loan_returns (id) on delete cascade,
  loan_line_id  uuid not null references public.stock_loan_lines (id),
  qty           numeric(12,2) not null check (qty > 0),
  batch_no      text,
  expiry_date   date
);
create index stock_loan_return_lines_line_idx on public.stock_loan_return_lines (loan_line_id);

-- -----------------------------------------------------------------------------
-- Functions
-- -----------------------------------------------------------------------------
create or replace function private.refresh_loan_status(p_loan uuid)
returns void language sql security definer set search_path = '' as $$
  update public.stock_loans l set status = case when s.ret <= 0 then 'pending_return'
                                                when s.ret >= s.tot then 'fully_returned'
                                                else 'partially_returned' end
    from (select sum(qty) tot, sum(returned_qty) ret from public.stock_loan_lines where loan_id = p_loan) s
   where l.id = p_loan and l.status <> 'cancelled';
$$;

/** Find or create the batch for (item, location, batch no, expiry); copies the item's cost for profit estimates. */
create or replace function private.loan_batch(p_item uuid, p_location uuid, p_batch_no text, p_expiry date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare bid uuid;
begin
  insert into public.product_batches (item_id, location_id, batch_no, expiry_date)
  values (p_item, p_location, coalesce(trim(p_batch_no), ''), p_expiry)
  on conflict (item_id, location_id, batch_no, expiry_date) do update set batch_no = excluded.batch_no
  returning id into bid;
  insert into public.batch_costs (batch_id, unit_cost)
  select bid, cost_price from public.catalog_costs where item_id = p_item
  on conflict (batch_id) do nothing;
  return bid;
end $$;

/**
 * Record stock borrowed from / lent to another business.
 * p_lines = [{"item_id", "qty", "location_id"?, "batch_no"?, "expiry_date"?, "batch_id"?, "batch_override_reason"?, "notes"?}]
 *   borrowed → location/batch/expiry describe the stock we received (location defaults to the main store)
 *   lent     → stock leaves earliest-expiry-first; batch_id (+ reason) to pick a specific batch
 */
create or replace function public.record_stock_loan(p_key text, p_direction text, p_partner uuid, p_lines jsonb,
  p_loan_date date default null, p_expected_return date default null, p_reference text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare loan_id uuid; l jsonb; ci public.catalog_items; partner public.partner_businesses; line_id uuid;
        loc uuid; bid uuid; q numeric; i int := 0; d date := coalesce(p_loan_date, private.clinic_today()); exp date;
begin
  if not private.has_permission('inventory.manage') then raise exception 'permission denied: inventory.manage' using errcode = '42501'; end if;
  if coalesce(trim(p_key), '') = '' then raise exception 'missing idempotency key'; end if;
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
end $$;

/**
 * Record (part of) a loan coming back. Can be called many times until everything is returned.
 * p_lines = [{"loan_line_id", "qty", "batch_id"?, "batch_override_reason"?, "batch_no"?, "expiry_date"?, "location_id"?}]
 *   borrowed loan → we give stock back (earliest expiry first, or the chosen batch)
 *   lent loan     → our stock comes back: into the batch it left from, or the batch_no/expiry given
 */
create or replace function public.record_stock_loan_return(p_key text, p_loan uuid, p_lines jsonb,
  p_returned_on date default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare loan public.stock_loans; partner_name text; ret uuid; l jsonb; ln public.stock_loan_lines; q numeric; rl uuid;
        total numeric := 0; bid uuid; loc uuid; exp date; src record; d date := coalesce(p_returned_on, private.clinic_today());
begin
  if not private.has_permission('inventory.manage') then raise exception 'permission denied: inventory.manage' using errcode = '42501'; end if;
  if coalesce(trim(p_key), '') = '' then raise exception 'missing idempotency key'; end if;
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
end $$;

/** A record entered by mistake: reverse its stock and mark it cancelled (only before any return). */
create or replace function public.cancel_stock_loan(p_loan uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare loan public.stock_loans;
begin
  if not private.has_permission('inventory.manage') then raise exception 'permission denied: inventory.manage' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into loan from public.stock_loans where id = p_loan for update;
  if not found then raise exception 'loan not found'; end if;
  if loan.status = 'cancelled' then raise exception 'already cancelled'; end if;
  if exists (select 1 from public.stock_loan_returns where loan_id = p_loan) then
    raise exception 'returns were already recorded on this record — it can''t be cancelled';
  end if;
  begin
    perform private.reverse_stock('stock_loan_lines', ln.id, 'Loan ' || loan.code || ' cancelled: ' || p_reason)
      from public.stock_loan_lines ln where ln.loan_id = p_loan;
  exception when raise_exception or check_violation then
    raise exception 'some of the borrowed stock was already used or sold — record a return instead of cancelling';
  end;
  update public.stock_loans set status = 'cancelled', cancel_reason = trim(p_reason), cancelled_at = now(),
         cancelled_by = (select auth.uid()) where id = p_loan;
end $$;

-- What is still owed, per line (security invoker → caller's RLS applies).
create view public.stock_loan_outstanding with (security_invoker = true) as
select l.id as loan_id, l.code, l.direction, l.partner_id, p.name as partner_name, l.loan_date, l.expected_return_date, l.status,
       ln.id as line_id, ln.item_id, ci.name as item_name, ln.unit, ln.qty, ln.returned_qty, ln.qty - ln.returned_qty as outstanding_qty,
       (l.expected_return_date is not null and l.expected_return_date < private.clinic_today()) as is_overdue
from public.stock_loans l
join public.partner_businesses p on p.id = l.partner_id
join public.stock_loan_lines ln on ln.loan_id = l.id
join public.catalog_items ci on ci.id = ln.item_id
where l.status in ('pending_return', 'partially_returned') and ln.qty > ln.returned_qty;

-- -----------------------------------------------------------------------------
-- Audit, RLS, grants
-- -----------------------------------------------------------------------------
create trigger audit_partner_businesses after insert or update or delete on public.partner_businesses
  for each row execute function private.audit_row();
create trigger audit_stock_loans after insert or update on public.stock_loans
  for each row execute function private.audit_row();
create trigger audit_stock_loan_lines after insert or update on public.stock_loan_lines
  for each row execute function private.audit_row();
create trigger audit_stock_loan_returns after insert on public.stock_loan_returns
  for each row execute function private.audit_row();

alter table public.partner_businesses      enable row level security;
alter table public.stock_loans             enable row level security;
alter table public.stock_loan_lines        enable row level security;
alter table public.stock_loan_returns      enable row level security;
alter table public.stock_loan_return_lines enable row level security;

create policy partner_businesses_select on public.partner_businesses for select to authenticated
  using ((select private.has_permission('inventory.view')));
create policy partner_businesses_manage on public.partner_businesses for all to authenticated
  using ((select private.has_permission('inventory.manage'))) with check ((select private.has_permission('inventory.manage')));

create policy stock_loans_select on public.stock_loans for select to authenticated
  using ((select private.has_permission('inventory.view')));
create policy stock_loan_lines_select on public.stock_loan_lines for select to authenticated
  using ((select private.has_permission('inventory.view')));
create policy stock_loan_returns_select on public.stock_loan_returns for select to authenticated
  using ((select private.has_permission('inventory.view')));
create policy stock_loan_return_lines_select on public.stock_loan_return_lines for select to authenticated
  using ((select private.has_permission('inventory.view')));
-- No insert/update/delete policies on loans: only the functions above write them.

do $$ declare f text; begin
  foreach f in array array[
    'public.record_stock_loan(text, text, uuid, jsonb, date, date, text, text)',
    'public.record_stock_loan_return(text, uuid, jsonb, date, text)',
    'public.cancel_stock_loan(uuid, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke execute on function private.refresh_loan_status(uuid) from public, anon, authenticated;
revoke execute on function private.loan_batch(uuid, uuid, text, date) from public, anon, authenticated;
