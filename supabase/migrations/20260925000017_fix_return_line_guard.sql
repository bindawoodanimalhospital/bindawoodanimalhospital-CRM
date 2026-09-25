-- In BEFORE UPDATE triggers, generated columns are not yet computed on NEW, so comparing whole rows
-- always differed and blocked legitimate returns. Compare only the stored, non-generated columns.
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
