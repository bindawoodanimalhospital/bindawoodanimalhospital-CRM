-- =============================================================================
-- Correct or split a batch's expiry date / batch number.
-- Staff couldn't fix a wrong expiry, or record that stock entered as one lot actually has
-- several expiry dates (most stock was entered with none). set_batch_details does both:
--   * one part  → the batch's expiry / batch no. is corrected (merged into an identical batch
--                 at the same place if one exists);
--   * several   → the quantity is split across expiry dates / batch numbers.
-- The total never changes (movements in and out net to zero); every change is in the stock
-- history and the activity log with who, what before → after and the reason. Sales keep using
-- the soonest-expiring stock first, and expired stock still can't be sold.
-- =============================================================================

create or replace function public.set_batch_details(p_batch uuid, p_parts jsonb, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  b public.product_batches; p record; target uuid; total numeric; cnt int; why text;
  before jsonb;
begin
  if not (private.has_permission('inventory.adjust') or private.has_permission('inventory.manage')) then
    raise exception 'permission denied: inventory.adjust' using errcode = '42501';
  end if;
  select * into b from public.product_batches where id = p_batch for update;
  if not found then raise exception 'batch not found'; end if;
  if jsonb_typeof(p_parts) <> 'array' or jsonb_array_length(p_parts) = 0 then raise exception 'nothing to save'; end if;
  why := coalesce(nullif(trim(p_reason), ''), 'Expiry / batch corrected');

  -- Parts grouped by (batch no., expiry): the same date entered twice is one part.
  create temp table _parts on commit drop as
    select coalesce(trim(x ->> 'batch_no'), '') bn, nullif(x ->> 'expiry', '')::date exp, sum((x ->> 'qty')::numeric) qty
      from jsonb_array_elements(p_parts) x group by 1, 2;
  if exists (select 1 from _parts where qty is null or qty <= 0) then raise exception 'every line needs a quantity above zero'; end if;
  select sum(qty), count(*) into total, cnt from _parts;
  if cnt = 1 and b.qty_on_hand = 0 then total := 0; end if;   -- empty batch: only its details change
  if total <> b.qty_on_hand then
    raise exception 'the lines add up to %, but this batch has % — they must match', total, b.qty_on_hand;
  end if;
  before := jsonb_build_object('batch_no', b.batch_no, 'expiry', b.expiry_date, 'qty', b.qty_on_hand);

  if cnt = 1 then
    select * into p from _parts;
    select id into target from public.product_batches
     where item_id = b.item_id and location_id = b.location_id and batch_no = p.bn and expiry_date is not distinct from p.exp and id <> b.id;
    if target is null then
      update public.product_batches set batch_no = p.bn, expiry_date = p.exp where id = b.id;   -- simple correction
    elsif b.qty_on_hand > 0 then                                                                  -- same details as another batch: merge
      insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, reason)
      values (b.id, b.item_id, b.location_id, -b.qty_on_hand, 'transfer_out', why),
             (target, b.item_id, b.location_id, b.qty_on_hand, 'transfer_in', why);
    end if;
  else
    for p in select * from _parts loop
      continue when p.bn = b.batch_no and p.exp is not distinct from b.expiry_date;   -- this part stays where it is
      insert into public.product_batches (item_id, location_id, batch_no, expiry_date) values (b.item_id, b.location_id, p.bn, p.exp)
      on conflict (item_id, location_id, batch_no, expiry_date) do nothing;
      select id into target from public.product_batches
       where item_id = b.item_id and location_id = b.location_id and batch_no = p.bn and expiry_date is not distinct from p.exp;
      insert into public.inventory_movements (batch_id, item_id, location_id, qty, kind, reason)
      values (b.id, b.item_id, b.location_id, -p.qty, 'transfer_out', why),
             (target, b.item_id, b.location_id, p.qty, 'transfer_in', why);
    end loop;
  end if;

  insert into public.audit_logs (actor_id, action, table_name, record_id, reason, context)
  values ((select auth.uid()), 'batch.edited', 'product_batches', p_batch::text, why,
          jsonb_build_object('item', (select name from public.catalog_items where id = b.item_id), 'before', before,
                             'after', (select jsonb_agg(jsonb_build_object('batch_no', bn, 'expiry', exp, 'qty', qty) order by exp nulls last) from _parts)));
  drop table _parts;
end $$;
revoke execute on function public.set_batch_details(uuid, jsonb, text) from public, anon;
grant execute on function public.set_batch_details(uuid, jsonb, text) to authenticated;
