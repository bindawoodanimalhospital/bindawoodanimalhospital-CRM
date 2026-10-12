-- =============================================================================
-- Easy stock. Staff found it hard to say "how many of this do we have": stock needed a separate
-- "add counted stock" step and then a "track stock" tick, so nothing was tracked (0 of 62).
--  * add_stock(): "I'm adding N pieces" (optionally with batch / expiry). Turns tracking on.
--  * set_stock_counts(): shelf count — "there are N on the shelf now" for many items at once;
--    raises or lowers stock to exactly N (soonest-expiring batches lowered first). Turns tracking on.
--  * private.default_location(): where an item lives if staff don't say (vaccines → fridge,
--    pet-store items → pet store, everything else → pharmacy).
-- Every change is an inventory movement with the person's name, so it shows in stock history and
-- the activity log.
-- =============================================================================
create or replace function private.default_location(p_item uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select l.id from public.inventory_locations l, public.catalog_items ci
      where ci.id = p_item and l.is_active
        and ((ci.vaccine_id is not null and l.name ilike '%fridge%') or (ci.vaccine_id is null and ci.is_retail and l.name ilike '%store%'))
      order by l.sort_order limit 1),
    (select id from public.inventory_locations where is_active order by sort_order limit 1));
$$;

-- The "loose" batch (no batch number, no expiry) at a location, created when first needed.
create or replace function private.loose_batch(p_item uuid, p_location uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b uuid;
begin
  select id into b from public.product_batches
   where item_id = p_item and location_id = p_location and batch_no = '' and expiry_date is null;
  if b is null then
    insert into public.product_batches (item_id, location_id, batch_no, expiry_date)
    values (p_item, p_location, '', null)
    on conflict (item_id, location_id, batch_no, expiry_date) do nothing
    returning id into b;
    if b is null then
      select id into b from public.product_batches
       where item_id = p_item and location_id = p_location and batch_no = '' and expiry_date is null;
    end if;
  end if;
  return b;
end $$;

-- "I'm adding N pieces of this item." Batch number and expiry are optional.
create or replace function public.add_stock(p_item uuid, p_qty numeric, p_location uuid default null,
  p_batch_no text default null, p_expiry date default null, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare ci public.catalog_items; loc uuid; b uuid; bn text := coalesce(trim(p_batch_no), '');
begin
  if not private.has_permission('inventory.adjust') then raise exception 'permission denied: inventory.adjust' using errcode = '42501'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'enter how many you are adding'; end if;
  select * into ci from public.catalog_items where id = p_item for update;
  if not found then raise exception 'item not found'; end if;
  if ci.kind <> 'product' then raise exception 'only products have stock'; end if;
  if p_expiry is not null and p_expiry < private.clinic_today() then raise exception 'this batch has already expired'; end if;
  loc := coalesce(p_location, private.default_location(p_item));
  if bn = '' and p_expiry is null then
    b := private.loose_batch(p_item, loc);
  else
    insert into public.product_batches (item_id, location_id, batch_no, expiry_date) values (p_item, loc, bn, p_expiry)
    on conflict (item_id, location_id, batch_no, expiry_date) do nothing;
    select id into b from public.product_batches
     where item_id = p_item and location_id = loc and batch_no = bn and expiry_date is not distinct from p_expiry;
  end if;
  insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, reason)
  values (b, p_item, loc, p_qty, 'adjust', coalesce(nullif(trim(p_note), ''), 'Stock added'));
  if not ci.track_stock then update public.catalog_items set track_stock = true where id = p_item; end if;
end $$;

-- Shelf count: [{"item_id": "...", "count": 12, "location_id": null}, …]
-- Sets usable (not expired) stock at the location to exactly "count". Returns how many items changed.
create or replace function public.set_stock_counts(p_counts jsonb, p_note text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare r jsonb; ci public.catalog_items; loc uuid; target numeric; cur numeric; diff numeric; b record; take numeric;
        changed int := 0; note text := coalesce(nullif(trim(p_note), ''), 'Shelf count');
begin
  if not private.has_permission('inventory.adjust') then raise exception 'permission denied: inventory.adjust' using errcode = '42501'; end if;
  if jsonb_typeof(p_counts) <> 'array' then raise exception 'nothing to save'; end if;
  for r in select * from jsonb_array_elements(p_counts) loop
    target := (r ->> 'count')::numeric;
    if target is null or target < 0 then raise exception 'counts can''t be negative'; end if;
    select * into ci from public.catalog_items where id = (r ->> 'item_id')::uuid for update;
    if not found or ci.kind <> 'product' then raise exception 'item not found'; end if;
    loc := coalesce(nullif(r ->> 'location_id', '')::uuid, private.default_location(ci.id));
    select coalesce(sum(qty_on_hand), 0) into cur from public.product_batches
     where item_id = ci.id and location_id = loc and (expiry_date is null or expiry_date >= private.clinic_today());
    diff := target - cur;
    if diff > 0 then
      insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, reason)
      values (private.loose_batch(ci.id, loc), ci.id, loc, diff, 'adjust', note);
    elsif diff < 0 then
      -- lower the soonest-expiring stock first (loose stock without expiry last)
      for b in select id, qty_on_hand from public.product_batches
                where item_id = ci.id and location_id = loc and qty_on_hand > 0
                  and (expiry_date is null or expiry_date >= private.clinic_today())
                order by expiry_date nulls last, received_at loop
        exit when diff = 0;
        take := least(b.qty_on_hand, -diff);
        insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, reason)
        values (b.id, ci.id, loc, -take, 'adjust', note);
        diff := diff + take;
      end loop;
    end if;
    if target <> cur or not ci.track_stock then changed := changed + 1; end if;
    if not ci.track_stock then update public.catalog_items set track_stock = true where id = ci.id; end if;
  end loop;
  return changed;
end $$;

revoke execute on function public.add_stock(uuid, numeric, uuid, text, date, text) from public, anon;
grant execute on function public.add_stock(uuid, numeric, uuid, text, date, text) to authenticated;
revoke execute on function public.set_stock_counts(jsonb, text) from public, anon;
grant execute on function public.set_stock_counts(jsonb, text) to authenticated;
revoke execute on function private.default_location(uuid) from public, anon;
revoke execute on function private.loose_batch(uuid, uuid) from public, anon;
