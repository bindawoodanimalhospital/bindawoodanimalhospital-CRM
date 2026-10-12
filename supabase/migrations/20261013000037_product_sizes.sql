-- =============================================================================
-- Product sizes. Many products come in several weights (Petline Kitten 400 g / 1.5 kg, Royal
-- Canin 2 kg / 4 kg / 10 kg) and a size is sometimes in the shop and sometimes not.
--  * Each size stays its own price-list item (own price, barcode, stock), so bills, stock,
--    returns and reports are unchanged. Sizes are linked through product_families.
--  * catalog_items.size_label ("1.5 kg") and size_grams (for ordering sizes small → large).
--  * catalog_items.is_available: "in the shop right now". Untick when a size runs out or isn't
--    stocked this month (separate from is_active = discontinued, and from tracked stock).
--  * public.group_sizes(): turn existing items into sizes of one product in one step.
-- =============================================================================
create table public.product_families (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 1),
  brand      text,
  category   text,
  created_by uuid references public.staff (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.product_families enable row level security;
create policy product_families_select on public.product_families for select to authenticated
  using ((select private.is_active_staff()));
create policy product_families_manage on public.product_families for all to authenticated
  using ((select private.has_permission('inventory.manage')) or (select private.has_permission('settings.manage')))
  with check ((select private.has_permission('inventory.manage')) or (select private.has_permission('settings.manage')));
grant select, insert, update, delete on public.product_families to authenticated;
create trigger product_families_updated_at before update on public.product_families
  for each row execute function private.set_updated_at();
create trigger audit_product_families after insert or update or delete on public.product_families
  for each row execute function private.audit_row();

alter table public.catalog_items
  add column family_id    uuid references public.product_families (id) on delete set null,
  add column size_label   text,
  add column size_grams   numeric,
  add column is_available boolean not null default true;
create index catalog_items_family_idx on public.catalog_items (family_id);

-- "330g", "1.5 kg", "10L", "500 ml" → label and a number to sort by (grams / ml).
create or replace function private.parse_size(p_text text, out label text, out grams numeric)
language plpgsql immutable set search_path = '' as $$
declare m text[];
begin
  m := regexp_match(coalesce(p_text, ''), '(\d+(?:\.\d+)?)\s*(kg|kgs|g|gm|gms|gram|grams|ml|l|ltr|litre|liter|lb|lbs)(?![a-z])', 'i');
  if m is null then return; end if;
  case lower(m[2])
    when 'kg', 'kgs' then label := m[1] || ' kg'; grams := m[1]::numeric * 1000;
    when 'g', 'gm', 'gms', 'gram', 'grams' then label := m[1] || ' g'; grams := m[1]::numeric;
    when 'ml' then label := m[1] || ' ml'; grams := m[1]::numeric;
    when 'l', 'ltr', 'litre', 'liter' then label := m[1] || ' L'; grams := m[1]::numeric * 1000;
    when 'lb', 'lbs' then label := m[1] || ' lb'; grams := round(m[1]::numeric * 453.6);
  end case;
end $$;

-- Keep size_grams in step with the label, so sizes always sort small → large.
create or replace function private.catalog_size_sort()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.size_label := nullif(trim(new.size_label), '');
  new.size_grams := (private.parse_size(new.size_label)).grams;
  return new;
end $$;
create trigger catalog_items_size_sort before insert or update of size_label on public.catalog_items
  for each row execute function private.catalog_size_sort();

-- Group items as the sizes of one product. p_items: [{"id": "...", "size_label": "1.5 kg"}, …]
-- p_family: an existing family to add to (or null to create one named p_name).
create or replace function public.group_sizes(p_name text, p_items jsonb, p_family uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare fam uuid := p_family; it jsonb; n int := 0; kinds int;
begin
  if not (private.has_permission('inventory.manage') or private.has_permission('settings.manage')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'choose the items to group'; end if;
  select count(distinct kind) into kinds from public.catalog_items
   where id in (select (x ->> 'id')::uuid from jsonb_array_elements(p_items) x);
  if kinds > 1 then raise exception 'only products can be grouped as sizes'; end if;
  if fam is null then
    if coalesce(trim(p_name), '') = '' then raise exception 'give the product a name'; end if;
    insert into public.product_families (name, brand, category)
    select trim(p_name), max(brand), max(category) from public.catalog_items
     where id in (select (x ->> 'id')::uuid from jsonb_array_elements(p_items) x)
    returning id into fam;
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    if coalesce(trim(it ->> 'size_label'), '') = '' then raise exception 'every size needs a label, e.g. 1.5 kg'; end if;
    update public.catalog_items set family_id = fam, size_label = trim(it ->> 'size_label')
     where id = (it ->> 'id')::uuid and kind = 'product';
    if not found then raise exception 'item not found or not a product'; end if;
    n := n + 1;
  end loop;
  return fam;
end $$;
revoke execute on function public.group_sizes(text, jsonb, uuid) from public, anon;
grant execute on function public.group_sizes(text, jsonb, uuid) to authenticated;

-- A family with no items left is removed.
create or replace function private.drop_empty_families()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.family_id is not null and old.family_id is distinct from new.family_id
     and not exists (select 1 from public.catalog_items where family_id = old.family_id) then
    delete from public.product_families where id = old.family_id;
  end if;
  return null;
end $$;
create trigger catalog_items_drop_empty_families after update of family_id on public.catalog_items
  for each row execute function private.drop_empty_families();
