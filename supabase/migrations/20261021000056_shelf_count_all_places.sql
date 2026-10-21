-- =============================================================================
-- Shelf count fix. Products kept in two places (e.g. Pet store + Pharmacy, because supplier
-- deliveries were received into the Pharmacy) were counted against the usual place only, while
-- the screen shows the total. Typing the total added the other place's stock again; typing the
-- shelf number said "nothing changed". Now a count is the product's total across every place:
-- extra pieces go to its usual place, and missing pieces come off the soonest-expiring stock
-- wherever it is. (A location can still be given explicitly.)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_stock_counts(p_counts jsonb, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb; ci public.catalog_items; loc uuid; here uuid; target numeric; cur numeric; diff numeric; b record; take numeric;
        changed int := 0; note text := coalesce(nullif(trim(p_note), ''), 'Shelf count');
begin
  if not private.has_permission('inventory.adjust') then raise exception 'permission denied: inventory.adjust' using errcode = '42501'; end if;
  if jsonb_typeof(p_counts) <> 'array' then raise exception 'nothing to save'; end if;
  for r in select * from jsonb_array_elements(p_counts) loop
    target := (r ->> 'count')::numeric;
    if target is null or target < 0 then raise exception 'counts can''t be negative'; end if;
    select * into ci from public.catalog_items where id = (r ->> 'item_id')::uuid for update;
    if not found or ci.kind <> 'product' then raise exception 'item not found'; end if;
    -- The count is for the product as a whole (every place it is kept), unless a place is given.
    here := nullif(r ->> 'location_id', '')::uuid;
    loc := coalesce(here, private.default_location(ci.id));
    select coalesce(sum(qty_on_hand), 0) into cur from public.product_batches
     where item_id = ci.id and (here is null or location_id = here) and (expiry_date is null or expiry_date >= private.clinic_today());
    diff := target - cur;
    if diff > 0 then
      insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, reason)
      values (private.loose_batch(ci.id, loc), ci.id, loc, diff, 'adjust', note);
    elsif diff < 0 then
      -- lower the soonest-expiring stock first (loose stock without expiry last)
      for b in select id, location_id, qty_on_hand from public.product_batches
                where item_id = ci.id and (here is null or location_id = here) and qty_on_hand > 0
                  and (expiry_date is null or expiry_date >= private.clinic_today())
                order by expiry_date nulls last, received_at loop
        exit when diff = 0;
        take := least(b.qty_on_hand, -diff);
        insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, reason)
        values (b.id, ci.id, b.location_id, -take, 'adjust', note);
        diff := diff + take;
      end loop;
    end if;
    if target <> cur or not ci.track_stock then changed := changed + 1; end if;
    if not ci.track_stock then update public.catalog_items set track_stock = true where id = ci.id; end if;
  end loop;
  return changed;
end $function$;
