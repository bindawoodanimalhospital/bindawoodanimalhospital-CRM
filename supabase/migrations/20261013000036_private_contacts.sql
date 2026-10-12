-- =============================================================================
-- Private contact details. Pet owners asked that only the clinic owner can see or change their
-- phone numbers and email. Those fields move out of public.customers into public.customer_contacts,
-- readable and writable only with the new permission customers.contact (Owner role by default;
-- the owner can grant it to another role in "Who can do what").
--  * Phone is now optional.
--  * Search: with the permission, any part of a number or the email finds the owner (and the number
--    is shown). Without it, only the complete number finds the owner, and it is never shown.
--  * Messages no longer store the number; the screen reads it live (so only permitted staff see it),
--    and a guard keeps messages.to_phone empty.
--  * Duplicate check, campaigns, reminders, data checks and the open-alerts view updated.
-- =============================================================================

-- 1) Permission ----------------------------------------------------------------------------
insert into public.permissions (key, module, action, label, description, is_sensitive, sort_order)
values ('customers.contact', 'customers', 'contact', 'See & edit phone numbers and email',
        'Only these staff can see, add or change pet owners'' phone, WhatsApp, other number and email.', true, 105)
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission_key)
select id, 'customers.contact' from public.roles where key = 'owner'
on conflict do nothing;

-- 2) The private table ---------------------------------------------------------------------
create table public.customer_contacts (
  customer_id uuid primary key references public.customers (id) on delete cascade,
  phone       text check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp    text check (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  alt_phone   text check (alt_phone ~ '^\+[1-9][0-9]{7,14}$'),
  email       extensions.citext,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.staff (id) default auth.uid()
);
create index customer_contacts_phone_idx on public.customer_contacts (phone);
create index customer_contacts_whatsapp_idx on public.customer_contacts (whatsapp);
create index customer_contacts_alt_phone_idx on public.customer_contacts (alt_phone);

insert into public.customer_contacts (customer_id, phone, whatsapp, alt_phone, email, updated_by)
select id, phone, whatsapp, alt_phone, email, created_by from public.customers
 where coalesce(phone, whatsapp, alt_phone, email::text) is not null;

alter table public.customer_contacts enable row level security;
create policy customer_contacts_select on public.customer_contacts for select to authenticated
  using ((select private.has_permission('customers.contact')));
create policy customer_contacts_insert on public.customer_contacts for insert to authenticated
  with check ((select private.has_permission('customers.contact')));
create policy customer_contacts_update on public.customer_contacts for update to authenticated
  using ((select private.has_permission('customers.contact'))) with check ((select private.has_permission('customers.contact')));
create policy customer_contacts_delete on public.customer_contacts for delete to authenticated
  using ((select private.has_permission('customers.contact')));
grant select, insert, update, delete on public.customer_contacts to authenticated;
revoke all on public.customer_contacts from anon;

create trigger customer_contacts_updated_at before update on public.customer_contacts
  for each row execute function private.set_updated_at();
create trigger audit_customer_contacts after insert or update or delete on public.customer_contacts
  for each row execute function private.audit_row();

-- 3) Remove the fields from customers (the open-alerts view lists them, so rebuild it) ---------
drop view public.open_alerts;
alter table public.customers drop column phone, drop column whatsapp, drop column alt_phone, drop column email;

create view public.open_alerts with (security_invoker = true) as SELECT 'payment'::text AS kind,
        CASE
            WHEN (du.promised_date < private.clinic_today()) THEN 'critical'::text
            WHEN (du.promised_date = private.clinic_today()) THEN 'warning'::text
            ELSE 'info'::text
        END AS severity,
    ((c.full_name || ' — Rs. '::text) || to_char(i.balance, 'FM999,999,999'::text)) AS title,
    (('Bill '::text || i.number) ||
        CASE
            WHEN (du.missed_promises > 0) THEN ((' · '::text || du.missed_promises) || ' missed promise(s)'::text)
            ELSE ''::text
        END) AS subtitle,
    du.promised_date AS due_on,
    (private.clinic_today() - du.promised_date) AS days_overdue,
    du.created_by AS responsible_id,
    '/billing/dues'::text AS link,
    'dues'::text AS source_table,
    du.id AS source_id,
    du.customer_id,
    du.pet_id
   FROM ((dues du
     JOIN invoices i ON ((i.id = du.invoice_id)))
     JOIN customers c ON ((c.id = du.customer_id)))
  WHERE ((du.status = 'open'::text) AND (i.balance > (0)::numeric) AND (du.promised_date <= private.clinic_today()))
UNION ALL
 SELECT 'due_approval'::text AS kind,
    'warning'::text AS severity,
    ((c.full_name || ' — Rs. '::text) || to_char(i.balance, 'FM999,999,999'::text)) AS title,
    'Pay-later needs manager approval'::text AS subtitle,
    (du.created_at)::date AS due_on,
    0 AS days_overdue,
    du.created_by AS responsible_id,
    '/billing/dues?view=approval'::text AS link,
    'dues'::text AS source_table,
    du.id AS source_id,
    du.customer_id,
    du.pet_id
   FROM ((dues du
     JOIN invoices i ON ((i.id = du.invoice_id)))
     JOIN customers c ON ((c.id = du.customer_id)))
  WHERE ((du.status = 'open'::text) AND (du.approval_status = 'pending'::text))
UNION ALL
 SELECT
        CASE
            WHEN (di.kind = 'vaccination'::due_kind) THEN 'vaccination'::text
            ELSE 'follow_up'::text
        END AS kind,
        CASE
            WHEN (di.due_on < (private.clinic_today() - 7)) THEN 'critical'::text
            WHEN (di.due_on < private.clinic_today()) THEN 'warning'::text
            ELSE 'info'::text
        END AS severity,
    ((p.name || ' — '::text) || di.title) AS title,
    COALESCE(c.full_name, ''::text) AS subtitle,
    di.due_on,
    (private.clinic_today() - di.due_on) AS days_overdue,
    di.assigned_to AS responsible_id,
    '/due'::text AS link,
    'due_items'::text AS source_table,
    di.id AS source_id,
    c.id AS customer_id,
    p.id AS pet_id
   FROM ((due_items di
     JOIN pets p ON ((p.id = di.pet_id)))
     LEFT JOIN LATERAL ( SELECT c2.id,
            c2.code,
            c2.full_name,
            c2.full_name_ur,
            c2.address,
            c2.area,
            c2.city,
            c2.preferred_channel,
            c2.marketing_opt_in,
            c2.referral_source,
            c2.notes,
            c2.status,
            c2.merged_into_id,
            c2.custom_fields,
            c2.search_text,
            c2.created_by,
            c2.created_at,
            c2.updated_at,
            c2.preferred_language
           FROM (pet_owners po
             JOIN customers c2 ON ((c2.id = po.customer_id)))
          WHERE (po.pet_id = p.id)
          ORDER BY po.is_primary DESC
         LIMIT 1) c ON (true))
  WHERE ((di.status = 'pending'::due_status) AND (p.status = 'active'::pet_status) AND (di.due_on <= private.clinic_today()))
UNION ALL
 SELECT 'diagnostic'::text AS kind,
        CASE
            WHEN (d.status = 'resulted'::diagnostic_status) THEN 'warning'::text
            ELSE 'info'::text
        END AS severity,
    ((p.name || ' — '::text) || dt.name) AS title,
        CASE
            WHEN (d.status = 'resulted'::diagnostic_status) THEN 'Result ready — needs doctor review'::text
            ELSE 'Result pending'::text
        END AS subtitle,
    (d.created_at)::date AS due_on,
    (private.clinic_today() - (d.created_at)::date) AS days_overdue,
    d.ordered_by AS responsible_id,
    (('/visits/'::text || d.visit_id) || '?tab=tests'::text) AS link,
    'diagnostic_orders'::text AS source_table,
    d.id AS source_id,
    NULL::uuid AS customer_id,
    p.id AS pet_id
   FROM ((diagnostic_orders d
     JOIN pets p ON ((p.id = d.pet_id)))
     JOIN diagnostic_types dt ON ((dt.id = d.type_id)))
  WHERE ((d.status = 'resulted'::diagnostic_status) OR ((d.status = ANY (ARRAY['ordered'::diagnostic_status, 'in_progress'::diagnostic_status])) AND (d.created_at < (now() - '24:00:00'::interval))))
UNION ALL
 SELECT 'record'::text AS kind,
    'warning'::text AS severity,
    (p.name || ' — consultation not finalized'::text) AS title,
    ('Draft since '::text || to_char((co.created_at AT TIME ZONE 'Asia/Karachi'::text), 'DD Mon HH12:MI AM'::text)) AS subtitle,
    (co.created_at)::date AS due_on,
    (private.clinic_today() - (co.created_at)::date) AS days_overdue,
    co.doctor_id AS responsible_id,
    ('/visits/'::text || co.visit_id) AS link,
    'consultations'::text AS source_table,
    co.id AS source_id,
    NULL::uuid AS customer_id,
    p.id AS pet_id
   FROM (consultations co
     JOIN pets p ON ((p.id = co.pet_id)))
  WHERE ((co.status = 'draft'::record_status) AND (co.created_at < (now() - '12:00:00'::interval)) AND (co.visit_id IS NOT NULL))
UNION ALL
 SELECT 'task'::text AS kind,
        CASE
            WHEN ((tk.priority = ANY (ARRAY['high'::text, 'urgent'::text])) OR (((tk.due_at AT TIME ZONE 'Asia/Karachi'::text))::date < (private.clinic_today() - 1))) THEN 'critical'::text
            ELSE 'warning'::text
        END AS severity,
    tk.title,
    'Task overdue'::text AS subtitle,
    ((tk.due_at AT TIME ZONE 'Asia/Karachi'::text))::date AS due_on,
    (private.clinic_today() - ((tk.due_at AT TIME ZONE 'Asia/Karachi'::text))::date) AS days_overdue,
    tk.assigned_to AS responsible_id,
    '/tasks'::text AS link,
    'tasks'::text AS source_table,
    tk.id AS source_id,
    tk.customer_id,
    tk.pet_id
   FROM tasks tk
  WHERE ((tk.status = ANY (ARRAY['open'::text, 'in_progress'::text])) AND (tk.due_at < now()))
UNION ALL
 SELECT 'stock'::text AS kind,
        CASE
            WHEN (sl.expired_qty > (0)::numeric) THEN 'critical'::text
            ELSE 'warning'::text
        END AS severity,
    sl.name AS title,
        CASE
            WHEN (sl.expired_qty > (0)::numeric) THEN (sl.expired_qty || ' expired on the shelf'::text)
            WHEN ((sl.reorder_level IS NOT NULL) AND (sl.usable_qty <= sl.reorder_level)) THEN (('Low: '::text || sl.usable_qty) || ' left'::text)
            ELSE ('Expires '::text || to_char((sl.next_expiry)::timestamp with time zone, 'DD Mon YYYY'::text))
        END AS subtitle,
    COALESCE(sl.next_expiry, private.clinic_today()) AS due_on,
    0 AS days_overdue,
    NULL::uuid AS responsible_id,
    ('/inventory/'::text || sl.item_id) AS link,
    'catalog_items'::text AS source_table,
    sl.item_id AS source_id,
    NULL::uuid AS customer_id,
    NULL::uuid AS pet_id
   FROM stock_levels sl
  WHERE ((sl.expired_qty > (0)::numeric) OR ((sl.reorder_level IS NOT NULL) AND (sl.usable_qty <= sl.reorder_level)) OR ((sl.next_expiry IS NOT NULL) AND (sl.next_expiry <= (private.clinic_today() + 30))))
UNION ALL
 SELECT 'no_show'::text AS kind,
    'info'::text AS severity,
    (COALESCE(p.name, c.full_name) || ' — missed appointment'::text) AS title,
    c.full_name AS subtitle,
    ((a.starts_at AT TIME ZONE 'Asia/Karachi'::text))::date AS due_on,
    0 AS days_overdue,
    a.created_by AS responsible_id,
    ('/appointments?date='::text || to_char((a.starts_at AT TIME ZONE 'Asia/Karachi'::text), 'YYYY-MM-DD'::text)) AS link,
    'appointments'::text AS source_table,
    a.id AS source_id,
    c.id AS customer_id,
    p.id AS pet_id
   FROM ((appointments a
     JOIN customers c ON ((c.id = a.customer_id)))
     LEFT JOIN pets p ON ((p.id = a.pet_id)))
  WHERE ((a.status = 'no_show'::appointment_status) AND (a.starts_at > (now() - '3 days'::interval)));

-- Owners' search text no longer contains numbers or email.
create or replace function private.customers_search_text()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.search_text := private.search_norm(concat_ws(' ', new.code, new.full_name, new.full_name_ur, new.area));
  return new;
end $$;
update public.customers set search_text = private.search_norm(concat_ws(' ', code, full_name, full_name_ur, area));

-- 4) Matching on contact details without revealing them ------------------------------------
-- Returns owners whose phone / WhatsApp / other number / email matches p_raw.
--  * with customers.contact: any 4+ digits of a number, or the email
--  * without it: only the complete number (it proves nothing the person didn't already type)
create or replace function private.customer_ids_by_contact(p_raw text)
returns setof uuid language plpgsql stable security definer set search_path = '' as $$
declare
  digits text := nullif(regexp_replace(coalesce(p_raw, ''), '\D', '', 'g'), '');
  local text;
  full_access boolean := private.has_permission('customers.contact');
begin
  if not private.is_active_staff() or not private.has_permission('customers.view') then return; end if;
  if trim(coalesce(p_raw, '')) like '%@%' then
    if full_access then
      return query select cc.customer_id from public.customer_contacts cc where cc.email = trim(p_raw)::extensions.citext;
    end if;
    return;
  end if;
  if digits is null or length(digits) < 4 then return; end if;
  -- 0300…, 300…, 92300…, +92300… all mean the same number
  local := case when digits like '92%' and length(digits) >= 11 then substr(digits, 3)
                when digits like '0%' then substr(digits, 2) else digits end;
  if full_access then
    return query select cc.customer_id from public.customer_contacts cc
      where concat_ws(' ', cc.phone, cc.whatsapp, cc.alt_phone) like '%' || local || '%';
  elsif length(local) >= 10 then
    return query select cc.customer_id from public.customer_contacts cc
      where right(cc.phone, 10) = right(local, 10) or right(cc.whatsapp, 10) = right(local, 10) or right(cc.alt_phone, 10) = right(local, 10);
  end if;
end $$;
revoke execute on function private.customer_ids_by_contact(text) from public, anon;
grant execute on function private.customer_ids_by_contact(text) to authenticated;

-- Search (same as migration 033, with private contact matching). Load pg_trgm so its threshold setting is recognised.
select extensions.similarity('a', 'b');
CREATE OR REPLACE FUNCTION public.smart_search(q text, p_scope text DEFAULT 'all'::text, max_results integer DEFAULT 30)
 RETURNS TABLE(kind text, id uuid, code text, title text, subtitle text, badge text, badge_tone text, href text, rank real)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET "pg_trgm.word_similarity_threshold" TO '0.45'
AS $function$
declare
  raw   text := left(coalesce(q, ''), 100);
  scope text := coalesce(nullif(p_scope, ''), 'all');
  t     text;          -- normalised search text (lower, no accents)
  words text[];
  phone_ids uuid[] := '{}';   -- owners whose phone / email matches (see private.customer_ids_by_contact)
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
  -- Contact details are private: the helper decides what this user may match on.
  if (digits is not null and length(digits) >= 4) or raw like '%@%' then
    phone_ids := array(select private.customer_ids_by_contact(raw));
  end if;

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
           concat_ws(' · ', (select cc.phone from public.customer_contacts cc where cc.customer_id = c.id), nullif(c.area, ''),
             (select string_agg(p.name, ', ' order by p.name) from public.pet_owners po join public.pets p on p.id = po.pet_id
               where po.customer_id = c.id and p.status = 'active')),
           case when c.status = 'inactive' then 'Inactive' end, 'neutral', '/customers/' || c.id,
           (case when lower(c.code) = t then 3.0
                 when c.id = any(phone_ids) and (length(coalesce(local_phone, '')) >= 10 or raw like '%@%') then 2.5
                 when c.search_text like '% ' || t || '%' or c.search_text like t || '%' then 1.6
                 when c.search_text like '%' || t || '%' then 1.3
                 when c.id = any(phone_ids) then 1.2
                 when cardinality(words) > 1 then 1.0  -- every word matched, allowing typos ("ahmad raza")
                 else extensions.word_similarity(t, c.search_text) end)::real
      from public.customers c
     where scope in ('all', 'owner') and c.status <> 'merged' and tok is null
       and (c.search_text like '%' || t || '%'
            or c.id = any(phone_ids)
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
          coalesce(o.by_contact, false) as by_phone
        from (select string_agg(c.search_text, ' ') as names, bool_or(c.id = any(phone_ids)) as by_contact
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
end $function$;

-- Duplicate check on the new-owner form: same number (only for staff allowed to enter numbers) or similar name.
drop function if exists public.find_customer_duplicates(text, text, uuid);
create or replace function public.find_customer_duplicates(p_phone text default null, p_name text default null, p_exclude uuid default null)
returns table (id uuid, code text, full_name text, phone text, area text, reason text, score real)
language sql stable set search_path = '' as $$
  select c.id, c.code, c.full_name, cc.phone, c.area,
         case when p_phone is not null and p_phone in (cc.phone, cc.whatsapp, cc.alt_phone) then 'same phone' else 'similar name' end,
         greatest(
           case when p_phone is not null and p_phone in (cc.phone, cc.whatsapp, cc.alt_phone) then 1.0 else 0 end,
           case when p_name is not null then extensions.similarity(private.search_norm(c.full_name), private.search_norm(p_name)) else 0 end
         )::real as score
    from public.customers c
    left join public.customer_contacts cc on cc.customer_id = c.id   -- RLS: no rows without customers.contact
   where c.status <> 'merged'
     and (p_exclude is null or c.id <> p_exclude)
     and ((p_phone is not null and p_phone in (cc.phone, cc.whatsapp, cc.alt_phone))
          or (p_name is not null and length(p_name) >= 3
              and private.search_norm(c.full_name) operator(extensions.%) private.search_norm(p_name)))
   order by score desc
   limit 10;
$$;
revoke execute on function public.find_customer_duplicates(text, text, uuid) from public, anon;
grant execute on function public.find_customer_duplicates(text, text, uuid) to authenticated;

-- The old search is replaced by smart_search everywhere in the app.
drop function if exists public.global_search(text, integer);
drop function if exists private.global_search_impl(text, integer);

-- 5) Messages never keep a phone number --------------------------------------------------------
update public.messages set to_phone = null where to_phone is not null;
create or replace function private.messages_no_phone()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.to_phone := null;   -- numbers are private; the messages screen reads them from customer_contacts
  return new;
end $$;
create trigger messages_no_phone before insert or update on public.messages
  for each row execute function private.messages_no_phone();

-- Reminders, campaigns and data checks (unchanged except the contact fields)
CREATE OR REPLACE FUNCTION private.run_reminders()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  today date := private.clinic_today();
  clinic jsonb := coalesce((select value from public.system_settings where key = 'clinic.profile'), '{}'::jsonb);
  t record; rule public.reminder_rules; d int; max_off int; send_customer boolean; alert_staff boolean;
  lvl jsonb; i int; tpl public.message_templates; lang text; cust public.customers; vars jsonb; body text; link text;
  n_msgs int := 0; n_alerts int := 0; n_esc int := 0; n_closed int := 0;
begin
  -- 1) Current open items from every source.
  drop table if exists _open_sources;
  create temp table _open_sources (rule_key text, source_table text, source_id uuid, customer_id uuid, pet_id uuid,
    assigned_to uuid, title text, due_on date, extra jsonb) on commit drop;

  insert into _open_sources
  select case when di.kind = 'vaccination' then 'vaccination_due' else 'follow_up_due' end, 'due_items', di.id,
         (select po.customer_id from public.pet_owners po where po.pet_id = di.pet_id order by po.is_primary desc limit 1),
         di.pet_id, di.assigned_to, di.title, di.due_on, '{}'::jsonb
  from public.due_items di join public.pets p on p.id = di.pet_id
  where di.status = 'pending' and p.status = 'active';

  insert into _open_sources
  select 'payment_due', 'dues', du.id, du.customer_id, du.pet_id, du.created_by, 'Unpaid bill ' || i.number, du.promised_date,
         jsonb_build_object('amount', to_char(i.balance, 'FM999,999,999'), 'invoice', i.number)
  from public.dues du join public.invoices i on i.id = du.invoice_id
  where du.status = 'open' and i.balance > 0
    -- cash on delivery: no "payment due" reminders while the order is still on its way
    and not (i.fulfilment = 'home_delivery' and i.delivery_status in ('pending', 'dispatched'));

  insert into _open_sources
  select 'appointment', 'appointments', a.id, a.customer_id, a.pet_id, a.doctor_id,
         coalesce(at.name, 'Appointment'), (a.starts_at at time zone 'Asia/Karachi')::date,
         jsonb_build_object('time', to_char(a.starts_at at time zone 'Asia/Karachi', 'HH12:MI AM'))
  from public.appointments a join public.appointment_types at on at.id = a.appointment_type_id
  where a.status in ('booked', 'confirmed') and (a.starts_at at time zone 'Asia/Karachi')::date >= today;

  insert into _open_sources
  select 'task_overdue', 'tasks', tk.id, tk.customer_id, tk.pet_id, tk.assigned_to, tk.title,
         (tk.due_at at time zone 'Asia/Karachi')::date, jsonb_build_object('priority', tk.priority)
  from public.tasks tk where tk.status in ('open', 'in_progress') and tk.due_at is not null;

  -- 2) Keep tracks in step with their sources.
  insert into public.reminder_tracks (rule_key, source_table, source_id, customer_id, pet_id, assigned_to, title, due_on)
  select rule_key, source_table, source_id, customer_id, pet_id, assigned_to, title, due_on from _open_sources
  on conflict (source_table, source_id) do update
    set due_on = excluded.due_on, title = excluded.title, assigned_to = excluded.assigned_to, customer_id = excluded.customer_id,
        closed_at = null,
        -- a new promised / due date restarts the escalation ladder
        escalation_level = case when public.reminder_tracks.due_on <> excluded.due_on then 0 else public.reminder_tracks.escalation_level end;

  with gone as (
    update public.reminder_tracks rt set closed_at = now()
    where rt.closed_at is null
      and not exists (select 1 from _open_sources s where s.source_table = rt.source_table and s.source_id = rt.source_id)
    returning rt.id)
  select count(*) into n_closed from gone;
  update public.messages m set status = 'cancelled', outcome_note = 'Resolved before sending'
   where m.status in ('to_send', 'queued') and m.track_id in (select id from public.reminder_tracks where closed_at is not null);

  -- 3) Reminders, alerts and escalation for each open track.
  for t in select rt.*, s.extra from public.reminder_tracks rt
           join _open_sources s on s.source_table = rt.source_table and s.source_id = rt.source_id
           where rt.closed_at is null loop
    select * into rule from public.reminder_rules where key = t.rule_key and is_active;
    continue when not found;
    continue when t.paused_until is not null and t.paused_until >= today;
    d := today - t.due_on;
    link := case t.source_table when 'dues' then '/billing/dues' when 'tasks' then '/tasks' when 'appointments' then '/appointments'
                 else '/due' end;

    -- Customer reminder
    max_off := (select max(x) from unnest(rule.customer_offsets) x);
    send_customer := t.customer_id is not null and coalesce(array_length(rule.customer_offsets, 1), 0) > 0
      and (d = any (rule.customer_offsets)
           or (rule.customer_repeat_days is not null and d > max_off and (d - max_off) % rule.customer_repeat_days = 0))
      and t.last_customer_msg_on is distinct from today;
    if send_customer then
      select * into cust from public.customers where id = t.customer_id;
      if found and cust.status = 'active' then
        lang := coalesce(cust.preferred_language, 'ur');
        select * into tpl from public.message_templates where key = rule.customer_template and language = lang;
        if not found then select * into tpl from public.message_templates where key = rule.customer_template and language = 'en'; end if;
        vars := jsonb_build_object(
          'owner', cust.full_name, 'pet', coalesce((select name from public.pets where id = t.pet_id), 'your pet'),
          'title', t.title, 'date', to_char(t.due_on, 'DD Mon YYYY'),
          'clinic', coalesce(nullif(clinic ->> 'name', ''), 'Bin Dawood Animal Hospital'),
          'clinic_phone', coalesce(nullif(clinic ->> 'phone', ''), '')) || coalesce(t.extra, '{}'::jsonb);
        body := private.render_template(coalesce(tpl.body, t.title), vars);
        insert into public.messages (channel, status, customer_id, to_phone, template_key, language, body, source_table, source_id, track_id, scheduled_for)
        values (case when cust.preferred_channel in ('sms', 'call', 'email') then cust.preferred_channel::text else 'whatsapp' end,
                'to_send', cust.id, null, rule.customer_template, lang, body,
                t.source_table, t.source_id, t.id, today)
        on conflict (track_id, scheduled_for) where track_id is not null do nothing;
        if found then
          n_msgs := n_msgs + 1;
          update public.reminder_tracks set customer_msgs = customer_msgs + 1, last_customer_msg_on = today where id = t.id;
          insert into public.reminder_events (track_id, kind, detail) values (t.id, 'customer_message', jsonb_build_object('days_from_due', d));
        end if;
      end if;
    end if;

    -- Internal alert to the responsible person (or the rule's role)
    max_off := (select max(x) from unnest(rule.staff_offsets) x);
    alert_staff := coalesce(array_length(rule.staff_offsets, 1), 0) > 0
      and (d = any (rule.staff_offsets) or (rule.staff_repeat_days is not null and d > max_off and (d - max_off) % rule.staff_repeat_days = 0))
      and t.last_staff_alert_on is distinct from today;
    if alert_staff then
      if t.assigned_to is not null then
        perform private.notify(t.assigned_to, t.rule_key, case when d > 0 then 'warning' else 'info' end, t.title,
          case when d > 0 then d || ' day(s) overdue' when d = 0 then 'Due today' else 'Due in ' || -d || ' day(s)' end, link, t.id || ':' || today);
      elsif rule.staff_role is not null then
        perform private.notify_role(rule.staff_role, t.rule_key, case when d > 0 then 'warning' else 'info' end, t.title,
          case when d > 0 then d || ' day(s) overdue' when d = 0 then 'Due today' else 'Due in ' || -d || ' day(s)' end, link, t.id || ':' || today);
      end if;
      update public.reminder_tracks set last_staff_alert_on = today where id = t.id;
      insert into public.reminder_events (track_id, kind, detail) values (t.id, 'staff_alert', jsonb_build_object('days_from_due', d));
      n_alerts := n_alerts + 1;
    end if;

    -- Escalation ladder
    i := 0;
    for lvl in select * from jsonb_array_elements(rule.escalation) loop
      i := i + 1;
      if d >= (lvl ->> 'after_days')::int and t.escalation_level < i then
        update public.reminder_tracks set escalation_level = i, escalated_at = now() where id = t.id;
        perform private.notify_role(lvl ->> 'role', 'escalation', 'critical', 'Escalated: ' || t.title,
          d || ' day(s) overdue with no outcome recorded', link, t.id || ':esc:' || i);
        insert into public.reminder_events (track_id, kind, detail) values (t.id, 'escalated', jsonb_build_object('level', i, 'role', lvl ->> 'role', 'days_from_due', d));
        t.escalation_level := i;
        n_esc := n_esc + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('messages', n_msgs, 'alerts', n_alerts, 'escalations', n_esc, 'closed', n_closed, 'ran_at', now());
end $function$;

CREATE OR REPLACE FUNCTION public.campaign_audience(p_audience text)
 RETURNS TABLE(customer_id uuid, pet_id uuid, owner text, pet text, phone text, language text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id, p.id, c.full_name, p.name, case when private.has_permission('customers.contact') then (select coalesce(cc.whatsapp, cc.phone) from public.customer_contacts cc where cc.customer_id = c.id) end, c.preferred_language
  from public.customers c
  join public.pet_owners po on po.customer_id = c.id and po.is_primary
  join public.pets p on p.id = po.pet_id and p.status = 'active'
  where private.has_permission('crm.campaigns')
    and c.status = 'active' and c.marketing_opt_in                     -- opted-in only, always
    and case p_audience
      when 'birthdays_this_month' then p.date_of_birth is not null and not p.dob_is_estimate
        and extract(month from p.date_of_birth) = extract(month from private.clinic_today())
      when 'inactive_6_months' then not exists (
        select 1 from public.visits v where v.pet_id = p.id and v.checked_in_at > now() - interval '6 months')
        and exists (select 1 from public.visits v where v.pet_id = p.id)
      else false end;
$function$;

CREATE OR REPLACE FUNCTION public.create_campaign(p_name text, p_audience text, p_template text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare cid uuid; n int; clinic text := coalesce((select value ->> 'name' from public.system_settings where key = 'clinic.profile'), 'Bin Dawood Animal Hospital');
begin
  if not private.has_permission('crm.campaigns') then raise exception 'permission denied: crm.campaigns' using errcode = '42501'; end if;
  if not exists (select 1 from public.message_templates where key = p_template and is_promotional) then
    raise exception 'choose a promotional template';
  end if;
  insert into public.campaigns (name, audience, template_key) values (coalesce(nullif(trim(p_name), ''), p_template), p_audience, p_template) returning id into cid;
  insert into public.messages (channel, status, customer_id, to_phone, template_key, language, body, is_promotional, campaign_id, scheduled_for, created_by)
  select 'whatsapp', 'to_send', a.customer_id, null, p_template, a.language,
         private.render_template(coalesce(t.body, e.body), jsonb_build_object('owner', a.owner, 'pet', a.pet, 'clinic', clinic)),
         true, cid, private.clinic_today(), (select auth.uid())
  from public.campaign_audience(p_audience) a
  left join public.message_templates t on t.key = p_template and t.language = a.language
  left join public.message_templates e on e.key = p_template and e.language = 'en';
  get diagnostics n = row_count;
  update public.campaigns set message_count = n where id = cid;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.report_data_quality()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  today date := private.clinic_today();
  see_cost boolean := private.has_permission('inventory.view_cost');
begin
  if not (private.has_permission('reports.view') or private.has_permission('reports.financial')) then
    raise exception 'permission denied: reports.view' using errcode = '42501';
  end if;
  return jsonb_path_query_array(jsonb_build_array(
    jsonb_build_object('key', 'shared_phone', 'severity', 'warning', 'href', '/customers',
      'label', 'Owners sharing the same mobile number (possible duplicates)',
      'count', (select count(*) from (select cc.phone from public.customer_contacts cc join public.customers c on c.id = cc.customer_id where c.status <> 'merged' and cc.phone is not null group by cc.phone having count(*) > 1) x)),
    jsonb_build_object('key', 'stuck_visits', 'severity', 'warning', 'href', '/queue',
      'label', 'Visits from earlier days never marked complete',
      'count', (select count(*) from public.visits where visit_date < today and status not in ('completed', 'cancelled'))),
    jsonb_build_object('key', 'draft_notes', 'severity', 'warning', 'href', '/queue',
      'label', 'Consultation notes still in draft from earlier days',
      'count', (select count(*) from public.consultations c join public.visits v on v.id = c.visit_id
                 where c.status = 'draft' and v.visit_date < today)),
    jsonb_build_object('key', 'unbilled_visits', 'severity', 'warning', 'href', '/billing',
      'label', 'Completed visits in the last 30 days with no bill',
      'count', (select count(*) from public.visits v where v.status = 'completed' and v.visit_date >= today - 30
                 and not exists (select 1 from public.invoices i where i.visit_id = v.id and i.status <> 'void'))),
    jsonb_build_object('key', 'balance_no_promise', 'severity', 'warning', 'href', '/billing?view=unpaid',
      'label', 'Bills with money still owed but no promised payment date (e.g. refunded without a return)',
      'count', (select count(*) from public.invoices i where i.status = 'issued' and i.balance > 0
                 and not exists (select 1 from public.dues d where d.invoice_id = i.id and d.status = 'open'))),
    jsonb_build_object('key', 'old_drafts', 'severity', 'info', 'href', '/billing',
      'label', 'Draft bills older than 2 days',
      'count', (select count(*) from public.invoices where status = 'draft' and created_at < now() - interval '2 days')),
    jsonb_build_object('key', 'missed_promises', 'severity', 'warning', 'href', '/billing/dues',
      'label', 'Dues past their promised payment date',
      'count', (select count(*) from public.dues where status = 'open' and promised_date < today)),
    jsonb_build_object('key', 'no_area', 'severity', 'info', 'href', '/customers',
      'label', 'Owners without an area / society (needed for area reports)',
      'count', (select count(*) from public.customers where status = 'active' and coalesce(trim(area), '') = '')),
    jsonb_build_object('key', 'no_referral', 'severity', 'info', 'href', '/customers',
      'label', 'Owners registered in the last 90 days without “how did they find us”',
      'count', (select count(*) from public.customers where status = 'active' and coalesce(trim(referral_source), '') = ''
                 and created_at > now() - interval '90 days')),
    jsonb_build_object('key', 'no_dob', 'severity', 'info', 'href', '/pets',
      'label', 'Active pets without a date of birth (needed for age-based vaccine schedules)',
      'count', (select count(*) from public.pets where status = 'active' and date_of_birth is null)),
    jsonb_build_object('key', 'no_reorder', 'severity', 'info', 'href', '/inventory',
      'label', 'Stock items with no reorder level (no low-stock alert)',
      'count', (select count(*) from public.catalog_items where is_active and track_stock and reorder_level is null)),
    jsonb_build_object('key', 'zero_price', 'severity', 'info', 'href', '/settings',
      'label', 'Price-list items priced at Rs. 0',
      'count', (select count(*) from public.catalog_items where is_active and sale_price = 0 and not price_is_editable)),
    case when see_cost then jsonb_build_object('key', 'no_cost', 'severity', 'info', 'href', '/inventory',
      'label', 'Stock items with no purchase cost (profit estimate leaves them out)',
      'count', (select count(*) from public.catalog_items ci where ci.is_active and ci.track_stock
                 and not exists (select 1 from public.catalog_costs cc where cc.item_id = ci.id)
                 and not exists (select 1 from public.product_batches b join public.batch_costs bc on bc.batch_id = b.id where b.item_id = ci.id))) end
  ), '$[*] ? (@ != null)');
end $function$;

-- 6) The activity log keeps before/after values; changes to numbers are only readable by staff who
--    may see numbers (matters if the owner ever gives "audit.view" to another role).
drop policy audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
  using ((select private.has_permission('audit.view'))
         and (table_name is distinct from 'customer_contacts' or (select private.has_permission('customers.contact'))));
