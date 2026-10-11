-- =============================================================================
-- Smart search: one box that finds owners, pets, bills, price-list items and today's tokens.
--  * Phones in any format and partially ("0300-1234567", "+92 300…", "92300…", last 4+ digits)
--  * IDs (C-00012, P-00034, BD-26-000123 or just "123"), microchip / tag, SKU / barcode
--  * Typos and partial words (trigram, per word), Urdu names, multi-word "tiger ahmed" = pet Tiger of owner Ahmed
--  * Scope by prefix ("pet: tiger", "owner:", "bill:", "item:") or by the p_scope argument;
--    "#12" / "token 12" finds today's queue token
--  * Security invoker: every row still passes the caller's RLS (store staff never see clinic bills).
-- Returns ready-to-show rows (title, subtitle, badge, link) ranked best-first.
-- =============================================================================
-- Load pg_trgm in this session so its word_similarity_threshold setting is recognised below.
select extensions.similarity('a', 'b');

create or replace function public.smart_search(q text, p_scope text default 'all', max_results int default 30)
returns table (kind text, id uuid, code text, title text, subtitle text, badge text, badge_tone text, href text, rank real)
language plpgsql stable security invoker set search_path = '' set pg_trgm.word_similarity_threshold = 0.45 as $$
declare
  raw   text := left(coalesce(q, ''), 100);
  scope text := coalesce(nullif(p_scope, ''), 'all');
  t     text;          -- normalised search text (lower, no accents)
  words text[];
  digits text;         -- digits only (phones, bill numbers, tokens)
  local_phone text;    -- 92300… → 0300…
  tok int;
  lim int := least(greatest(coalesce(max_results, 30), 1), 60);
begin
  -- "pet: tiger", "owner: ali", "bill: 123", "item: food"
  if raw ~* '^\s*(pet|pets|owner|owners|customer|bill|bills|invoice|item|items|product)\s*:' then
    scope := case lower(substring(raw from '^\s*([a-zA-Z]+)'))
               when 'pets' then 'pet' when 'owners' then 'owner' when 'customer' then 'owner'
               when 'bills' then 'bill' when 'invoice' then 'bill' when 'items' then 'item' when 'product' then 'item'
               else lower(substring(raw from '^\s*([a-zA-Z]+)')) end;
    raw := regexp_replace(raw, '^\s*[a-zA-Z]+\s*:\s*', '');
  end if;
  -- "#12" or "token 12" → today's queue token
  if raw ~* '^\s*(#|token\s*)\d{1,4}\s*$' then
    tok := (regexp_replace(raw, '\D', '', 'g'))::int;
  end if;

  t := private.search_norm(trim(raw));
  words := array_remove(regexp_split_to_array(t, '\s+'), '');
  digits := nullif(regexp_replace(raw, '\D', '', 'g'), '');
  local_phone := case when digits like '92%' and length(digits) >= 11 then '0' || substr(digits, 3) else digits end;
  if length(t) < 2 and tok is null and not (scope = 'bill' and digits is not null) then return; end if;

  return query
  with hits as (
    -- Today's queue by token
    select 'visit'::text as kind, v.id, '#' || v.token_no as code, p.name as title,
           concat_ws(' · ', 'Token #' || v.token_no, c.full_name, replace(v.status::text, '_', ' ')) as subtitle,
           null::text as badge, null::text as badge_tone, '/visits/' || v.id as href, 3.0::real as rank
      from public.visits v join public.pets p on p.id = v.pet_id join public.customers c on c.id = v.customer_id
     where tok is not null and v.visit_date = private.clinic_today() and v.token_no = tok and scope in ('all', 'visit')

    union all
    -- Owners: name (fuzzy, Urdu), phone (any format, partial), email, area, code
    select 'customer', c.id, c.code, c.full_name,
           concat_ws(' · ', c.phone, nullif(c.area, ''),
             (select string_agg(p.name, ', ' order by p.name) from public.pet_owners po join public.pets p on p.id = po.pet_id
               where po.customer_id = c.id and p.status = 'active')),
           case when c.status = 'inactive' then 'Inactive' end, 'neutral', '/customers/' || c.id,
           (case when lower(c.code) = t then 3.0
                 when local_phone is not null and length(local_phone) >= 10 and c.search_text like '%' || local_phone || '%' then 2.5
                 when c.search_text like '% ' || t || '%' or c.search_text like t || '%' then 1.6
                 when c.search_text like '%' || t || '%' then 1.3
                 when digits is not null and length(digits) >= 4 and c.search_text like '%' || digits || '%' then 1.2
                 when cardinality(words) > 1 then 1.0  -- every word matched, allowing typos ("ahmad raza")
                 else extensions.word_similarity(t, c.search_text) end)::real
      from public.customers c
     where scope in ('all', 'owner') and c.status <> 'merged' and tok is null
       and (c.search_text like '%' || t || '%'
            or (digits is not null and length(digits) >= 4 and (c.search_text like '%' || digits || '%' or c.search_text like '%' || local_phone || '%'))
            or t operator(extensions.<%) c.search_text
            or (cardinality(words) > 1 and (select bool_and(c.search_text like '%' || w || '%'
                  or (length(w) >= 3 and w operator(extensions.<%) c.search_text)) from unnest(words) w)))

    union all
    -- Pets: name / code / microchip / tag / breed / colour, plus "pet + owner" multi-word and owner's phone
    select 'pet', p.id, p.code, p.name,
           concat_ws(' · ', s.name, coalesce(b.name, nullif(p.breed_text, '')),
             (select string_agg(c.full_name, ', ') from public.pet_owners po join public.customers c on c.id = po.customer_id where po.pet_id = p.id)),
           case when p.status <> 'active' then initcap(p.status::text)
                when exists (select 1 from public.pet_alerts a where a.pet_id = p.id and a.is_active and a.severity = 'critical') then 'Alert'
                when nullif(trim(p.special_handling), '') is not null then 'Handle with care' end,
           case when p.status <> 'active' then 'neutral' else 'danger' end,
           '/pets/' || p.id,
           (case when lower(p.code) = t or lower(coalesce(p.microchip_no, '')) = t then 3.0
                 when private.search_norm(p.name) = t then 2.2
                 when p.search_text like t || '%' or p.search_text like '% ' || t || '%' then 1.6
                 when p.search_text like '%' || t || '%' then 1.3
                 when cardinality(words) > 1 and m.all_words and m.pet_word then 1.5
                 when cardinality(words) > 1 and m.all_words then 0.8   -- only the owner's name matched
                 when m.by_phone then 1.1
                 else extensions.word_similarity(t, p.search_text) end)::real
      from public.pets p
      join public.species s on s.id = p.species_id
      left join public.breeds b on b.id = p.breed_id
      cross join lateral (
        select
          -- every word appears (or nearly, for typos) in the pet's text or its owners' names ("tiger ahmed", "tigr ahmad")
          (select bool_and(x.txt like '%' || w || '%' or (length(w) >= 3 and w operator(extensions.<%) x.txt))
             from unnest(words) w, (select p.search_text || ' ' || coalesce(o.names, '') as txt) x) as all_words,
          -- at least one word is about the pet itself, not just its owner
          (select bool_or(p.search_text like '%' || w || '%' or (length(w) >= 3 and w operator(extensions.<%) p.search_text)) from unnest(words) w) as pet_word,
          (digits is not null and length(digits) >= 4 and coalesce(o.phones, '') like '%' || digits || '%') as by_phone
        from (select string_agg(c.search_text, ' ') as names, string_agg(c.search_text, ' ') as phones
                from public.pet_owners po join public.customers c on c.id = po.customer_id
               where po.pet_id = p.id and c.status <> 'merged') o
      ) m
     where scope in ('all', 'pet') and tok is null
       and (p.search_text like '%' || t || '%' or t operator(extensions.<%) p.search_text
            or (cardinality(words) > 1 and m.all_words) or m.by_phone)

    union all
    -- Bills by number ("BD-26-000123", "26-123", "123")
    select 'bill', i.id, i.number, coalesce(c.full_name, 'Walk-in sale'),
           concat_ws(' · ', i.number, to_char(i.issued_at at time zone 'Asia/Karachi', 'DD Mon YYYY'), 'Rs. ' || to_char(i.total, 'FM999,999,990')),
           case when i.status = 'void' then 'Void' when i.status = 'draft' then 'Draft'
                when i.balance > 0 then 'Owes Rs. ' || to_char(i.balance, 'FM999,999,990') else 'Paid' end,
           case when i.status <> 'issued' then 'neutral' when i.balance > 0 then 'danger' else 'success' end,
           '/billing/' || i.id,
           (case when lower(i.number) = t then 3.0
                 when digits is not null and length(digits) <= 9 and nullif(regexp_replace(i.number, '^.*-', ''), '')::bigint = digits::bigint then 2.5
                 else 1.4 end)::real
      from public.invoices i left join public.customers c on c.id = i.customer_id
     where scope in ('all', 'bill') and tok is null and i.number is not null
       and (lower(i.number) like '%' || t || '%'
            or (digits is not null and (length(digits) >= 3 or scope = 'bill') and regexp_replace(i.number, '\D', '', 'g') like '%' || digits))

    union all
    -- Price-list items: name / SKU / barcode / category
    select 'item', ci.id, coalesce(ci.sku, ci.barcode), ci.name,
           concat_ws(' · ', coalesce(ci.category, case when ci.kind = 'service' then 'Service' else 'Product' end),
             case when ci.price_is_editable then 'price at billing' else 'Rs. ' || to_char(ci.sale_price, 'FM999,999,990') end,
             case when ci.track_stock then coalesce((select to_char(sl.usable_qty, 'FM999,990.##') from public.stock_levels sl where sl.item_id = ci.id), '0') || ' ' || ci.unit || ' in stock' end),
           case when ci.track_stock and coalesce((select sl.usable_qty from public.stock_levels sl where sl.item_id = ci.id), 0) <= 0 then 'Out of stock' end,
           'danger', '/inventory/' || ci.id,
           (case when lower(coalesce(ci.barcode, '')) = t or lower(coalesce(ci.sku, '')) = t then 3.0
                 when lower(ci.name) like t || '%' then 1.4
                 when lower(ci.name) like '%' || t || '%' then 1.2
                 else extensions.word_similarity(t, lower(ci.name)) end)::real
      from public.catalog_items ci
     where scope in ('all', 'item') and ci.is_active and tok is null and ci.system_role is null
       and (lower(ci.name) like '%' || t || '%' or lower(coalesce(ci.category, '')) like '%' || t || '%'
            or lower(coalesce(ci.sku, '')) = t or lower(coalesce(ci.barcode, '')) = t
            or t operator(extensions.<%) lower(ci.name))
  )
  select h.kind, h.id, h.code, h.title, h.subtitle, h.badge, h.badge_tone, h.href, h.rank
    from (select distinct on (h0.kind, h0.id) h0.* from hits h0 order by h0.kind, h0.id, h0.rank desc) h
   -- In "all", items rank a little lower so people and pets come first for the same strength of match.
   order by h.rank * case when h.kind = 'item' and scope = 'all' then 0.85 else 1 end desc, h.title
   limit lim;
end $$;

revoke execute on function public.smart_search(text, text, int) from public, anon;
grant execute on function public.smart_search(text, text, int) to authenticated;
