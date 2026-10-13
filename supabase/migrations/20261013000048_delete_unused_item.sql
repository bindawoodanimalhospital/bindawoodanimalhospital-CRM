-- =============================================================================
-- Delete a price-list item that was never used (e.g. created by mistake or a typo duplicate).
-- "Used" = anything points at it: bill lines, stock batches or movements, supplier deliveries,
-- borrowed/lent stock, surgery materials. Used items can only be hidden (untick Active), so
-- history stays complete. Built-in items (delivery charge etc.) are protected by
-- private.guard_system_catalog_item. The deletion is recorded in the activity log.
-- =============================================================================

create or replace function private.item_uses(p_item uuid) returns text
language sql stable security definer set search_path = '' as $$
  select nullif(concat_ws(', ',
    case when exists (select 1 from public.invoice_items where item_id = p_item) then 'bills' end,
    case when exists (select 1 from public.product_batches where item_id = p_item)
           or exists (select 1 from public.inventory_movements where item_id = p_item) then 'stock' end,
    case when exists (select 1 from public.purchase_lines where item_id = p_item) then 'supplier deliveries' end,
    case when exists (select 1 from public.stock_loan_lines where item_id = p_item) then 'borrowed / lent stock' end,
    case when exists (select 1 from public.surgery_consumables where product_id = p_item) then 'surgery materials' end), '');
$$;
revoke execute on function private.item_uses(uuid) from public, anon, authenticated;

/** True when the item can be deleted (never used, not built-in). For showing the Delete button. */
create or replace function public.item_is_deletable(p_item uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (private.has_permission('inventory.manage') or private.has_permission('settings.manage'))
     and exists (select 1 from public.catalog_items where id = p_item and system_role is null)
     and private.item_uses(p_item) is null;
$$;
revoke execute on function public.item_is_deletable(uuid) from public, anon;
grant execute on function public.item_is_deletable(uuid) to authenticated;

create or replace function public.delete_unused_item(p_item uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare it public.catalog_items; uses text;
begin
  if not (private.has_permission('inventory.manage') or private.has_permission('settings.manage')) then
    raise exception 'permission denied: inventory.manage' using errcode = '42501';
  end if;
  select * into it from public.catalog_items where id = p_item for update;
  if not found then raise exception 'item not found'; end if;
  if it.system_role is not null then
    raise exception '"%" is a built-in item and can''t be deleted', it.name using errcode = '42501';
  end if;
  uses := private.item_uses(p_item);
  if uses is not null then
    raise exception '"%" has been used (%) — it can''t be deleted. Hide it instead: Edit → untick Active.', it.name, uses
      using errcode = '23503';
  end if;
  insert into public.audit_logs (actor_id, action, table_name, record_id, reason, context)
  values ((select auth.uid()), 'item.deleted', 'catalog_items', p_item::text, nullif(trim(p_reason), ''),
          jsonb_build_object('name', it.name, 'kind', it.kind, 'price', it.sale_price));
  delete from public.catalog_items where id = p_item;   -- its saved cost goes with it (cascade)
end $$;
revoke execute on function public.delete_unused_item(uuid, text) from public, anon;
grant execute on function public.delete_unused_item(uuid, text) to authenticated;
