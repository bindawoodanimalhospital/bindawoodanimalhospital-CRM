-- =============================================================================
-- Addresses are NOT private after all (owner's decision): home address, area/city and the
-- delivery / home-visit addresses on appointments, visits and bills are visible to all staff again,
-- exactly as before 045. Phone numbers (and email) stay owner-only, as 045 made them:
--   * customers.contact can only belong to the Owner role; the Owner role can't be renamed;
--   * other staff can't find anyone by typing a phone number;
--   * the phone of whoever signs a surgery consent is owner-only (consent_contacts);
--   * numbers stay out of the activity-log history.
-- =============================================================================

-- 1) Home address back on customers ----------------------------------------------------------
alter table public.customers add column house_no text, add column block text, add column address text,
  add column area text, add column city text not null default 'Lahore';
alter table public.customers disable trigger audit_customers;
update public.customers c set house_no = cc.house_no, block = cc.block, address = cc.address, area = cc.area,
       city = coalesce(cc.city, 'Lahore')
  from public.customer_contacts cc where cc.customer_id = c.id;
alter table public.customer_contacts drop column house_no, drop column block, drop column address,
  drop column area, drop column city;
-- rows that only held an address are now empty
delete from public.customer_contacts where coalesce(phone, whatsapp, alt_phone, email::text) is null;

drop view if exists public.open_alerts;
create view public.open_alerts with (security_invoker = true) as  SELECT 'payment'::text AS kind,
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
CREATE OR REPLACE FUNCTION private.customers_search_text()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.search_text := private.search_norm(concat_ws(' ', new.code, new.full_name, new.full_name_ur, new.area));
  return new;
end $function$;

update public.customers set search_text = private.search_norm(concat_ws(' ', code, full_name, full_name_ur, area));
alter table public.customers enable trigger audit_customers;
drop function private.saved_address(uuid);

-- 2) Delivery / home-visit addresses back on their rows ----------------------------------------
drop trigger zz_appointments_private_address on public.appointments;
drop trigger zz_visits_private_address on public.visits;
drop trigger zz_invoices_private_address on public.invoices;
drop function private.appointment_private_address();
drop function private.visit_private_address();
drop function private.invoice_private_address();

alter table public.invoices disable trigger user;
alter table public.visits disable trigger user;
alter table public.appointments disable trigger user;
update public.invoices i set delivery_address = a.delivery_address, service_address = a.service_address
  from public.invoice_addresses a where a.invoice_id = i.id;
update public.visits v set service_address = a.address from public.visit_addresses a where a.visit_id = v.id;
update public.appointments p set service_address = a.address from public.appointment_addresses a where a.appointment_id = p.id;
alter table public.invoices enable trigger user;
alter table public.visits enable trigger user;
alter table public.appointments enable trigger user;
drop table public.invoice_addresses, public.visit_addresses, public.appointment_addresses;

comment on column public.invoices.delivery_address is null;
comment on column public.invoices.service_address is null;
comment on column public.visits.service_address is null;
comment on column public.appointments.service_address is null;

alter table public.appointments add constraint appointments_service_address_ck
  check (service_location = 'clinic' or coalesce(trim(service_address), '') <> '');
alter table public.visits add constraint visits_service_address_ck
  check (service_location = 'clinic' or coalesce(trim(service_address), '') <> '');
alter table public.invoices add constraint invoices_service_address_ck
  check (service_location = 'clinic' or coalesce(trim(service_address), '') <> '');
alter table public.invoices drop constraint invoices_delivery_needs_customer_ck;
alter table public.invoices add constraint invoices_delivery_needs_customer_ck
  check (fulfilment = 'in_store' or (customer_id is not null and coalesce(trim(delivery_address), '') <> ''));

update public.permissions set label = 'See & edit phone numbers and email (owner only)',
  description = 'Pet owners'' phone numbers, WhatsApp and email. Only the hospital owner — this can''t be given to any other role.'
 where key = 'customers.contact';

drop policy audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
  using ((select private.has_permission('audit.view'))
         and (table_name not in ('customer_contacts', 'consent_contacts') or (select private.has_permission('customers.contact'))));

-- 3) Functions back to their address-aware versions (phone handling unchanged) ------------------
CREATE OR REPLACE FUNCTION public.customer_address_line(p_customer uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select nullif(concat_ws(', ',
    nullif('House ' || nullif(trim(c.house_no), ''), 'House '),
    nullif(trim(c.block), ''), nullif(trim(c.address), ''), nullif(trim(c.area), ''), nullif(trim(c.city), '')), '')
  from public.customers c where c.id = p_customer;
$function$;

CREATE OR REPLACE FUNCTION private.invoice_fulfilment_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare has_line boolean; v record;
begin
  -- A bill made from a visit inherits where the service was given.
  if tg_op = 'INSERT' and new.visit_id is not null and new.service_location = 'clinic' and new.service_address is null then
    select service_location, service_address into v from public.visits where id = new.visit_id;
    if found then new.service_location := v.service_location; new.service_address := v.service_address; end if;
  end if;
  if new.service_location = 'clinic' then new.service_address := null; end if;

  if tg_op = 'INSERT' or old.status = 'draft' then
    if new.fulfilment = 'home_delivery' then
      new.delivery_status := coalesce(new.delivery_status, 'pending');
    else
      new.delivery_status := null; new.delivery_address := null;
    end if;
  end if;

  if tg_op = 'UPDATE' and old.status = 'draft' and new.status = 'issued' then
    has_line := exists (select 1 from public.invoice_items where invoice_id = new.id and line_role = 'delivery_charge');
    if new.fulfilment = 'home_delivery' and not has_line then
      raise exception 'add the delivery charge to this home delivery order (Rs. 0 if waived)';
    end if;
    if new.fulfilment = 'in_store' and has_line then
      raise exception 'remove the delivery charge, or mark the order as home delivery';
    end if;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION private.visit_location_to_draft_bill()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.invoices set service_location = new.service_location, service_address = new.service_address
   where visit_id = new.id and status = 'draft';
  return null;
end $function$;

CREATE OR REPLACE FUNCTION public.pos_checkout(p_key text, p_customer uuid, p_pet uuid, p_lines jsonb, p_payments jsonb, p_invoice_discount numeric DEFAULT 0, p_discount_reason text DEFAULT NULL::text, p_pay_later jsonb DEFAULT NULL::jsonb, p_delivery jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv_id uuid; l jsonb; i int := 0; dl public.catalog_items; charge numeric; it public.catalog_items; price numeric;
begin
  if not private.has_permission('pos.use') then raise exception 'permission denied: pos.use' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('bdah-idem:' || p_key, 0));   -- concurrent duplicate waits here
  select id into inv_id from public.invoices where idempotency_key = p_key;
  if found then return inv_id; end if;                                -- double tap on "Pay" → same sale
  if jsonb_array_length(coalesce(p_lines, '[]')) = 0 then raise exception 'the cart is empty'; end if;

  if p_delivery is not null then
    if p_customer is null then raise exception 'choose the customer for a home delivery'; end if;
    if coalesce(trim(p_delivery ->> 'address'), '') = '' then raise exception 'enter the delivery address'; end if;
    select * into dl from public.catalog_items where system_role = 'delivery_charge';
    charge := coalesce((p_delivery ->> 'charge')::numeric, dl.sale_price);
    if charge < 0 then raise exception 'the delivery charge can''t be negative'; end if;
  end if;

  insert into public.invoices (kind, customer_id, pet_id, invoice_discount, discount_reason, fulfilment, delivery_address, delivery_notes)
  values ('store', p_customer, p_pet, coalesce(p_invoice_discount, 0), nullif(trim(p_discount_reason), ''),
          case when p_delivery is null then 'in_store' else 'home_delivery' end,
          nullif(trim(p_delivery ->> 'address'), ''), nullif(trim(p_delivery ->> 'notes'), ''))
  returning id into inv_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    i := i + 1;
    select * into it from public.catalog_items where id = (l ->> 'item_id')::uuid;
    if not found then raise exception 'item not found'; end if;
    -- "Price decided at billing" items: use the price typed in the cart, else the list price.
    -- A product can never go out at Rs. 0 by accident (that billed delivery orders at 0 before).
    price := case when it.price_is_editable then coalesce(nullif((l ->> 'unit_price')::numeric, 0), it.sale_price) else it.sale_price end;
    if coalesce(price, 0) <= 0 then raise exception 'enter the price for % before selling it', it.name; end if;
    insert into public.invoice_items (invoice_id, sort_order, item_id, quantity, unit_price, discount_amount, batch_id, batch_override_reason)
    values (inv_id, i, (l ->> 'item_id')::uuid, (l ->> 'quantity')::numeric, price,
            coalesce((l ->> 'discount_amount')::numeric, 0), nullif(l ->> 'batch_id', '')::uuid, nullif(l ->> 'batch_override_reason', ''));
  end loop;
  if p_delivery is not null then
    insert into public.invoice_items (invoice_id, sort_order, item_id, quantity, unit_price)
    values (inv_id, i + 1, dl.id, 1, charge);
  end if;
  perform public.checkout_invoice(inv_id, p_payments, p_pay_later, p_key);
  return inv_id;
end $function$;

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

CREATE OR REPLACE FUNCTION public.find_customer_duplicates(p_phone text DEFAULT NULL::text, p_name text DEFAULT NULL::text, p_exclude uuid DEFAULT NULL::uuid)
 RETURNS TABLE(id uuid, code text, full_name text, phone text, area text, reason text, score real)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$;

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
