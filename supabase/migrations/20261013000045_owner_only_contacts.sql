-- =============================================================================
-- Every kind of pet-owner contact detail is for the hospital owner only.
-- 036 hid phone numbers and email behind customers.contact. This finishes the job:
--  * customers.contact can only ever belong to the Owner role (it can't be given to another role).
--  * The owner's home address (house, block, address, area, city) moves into customer_contacts.
--  * Delivery addresses and home-visit addresses (bills, visits, appointments) and the phone of
--    whoever signs a surgery consent move into owner-only tables. The old columns stay as a
--    write-through: whatever is written is moved to the private table and the column is left empty,
--    so the existing checkout / check-in / delivery functions keep working.
--  * Only the owner can enter or change an address. When other staff book a home visit or a home
--    delivery, the client's saved address is used automatically (the owner can change it).
--  * Other staff can no longer find a client by typing their phone number; area no longer
--    appears in or matches search.
--  * Contact details are removed from the activity-log history.
-- =============================================================================

-- 1) The permission belongs to the Owner role only ------------------------------------------
delete from public.role_permissions rp using public.roles r
 where rp.role_id = r.id and rp.permission_key = 'customers.contact' and r.key <> 'owner';
update public.permissions set label = 'See & edit contact details (owner only)',
  description = 'Pet owners'' phone numbers, email and addresses (home, delivery, home visit). Only the hospital owner — this can''t be given to any other role.'
 where key = 'customers.contact';

create or replace function private.contact_owner_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.permission_key = 'customers.contact'
     and (select key from public.roles where id = new.role_id) is distinct from 'owner' then
    raise exception 'contact details are for the hospital owner only — this permission can''t be given to another role'
      using errcode = '42501';
  end if;
  return new;
end $$;
create trigger role_permissions_contact_owner_only before insert or update on public.role_permissions
  for each row execute function private.contact_owner_only();

-- The Owner role's key is what the rule above relies on, so it can't be renamed.
create or replace function private.owner_role_key_fixed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.key = 'owner' and new.key is distinct from 'owner' then
    raise exception 'the Owner role can''t be renamed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger roles_owner_key_fixed before update on public.roles
  for each row execute function private.owner_role_key_fixed();

-- 2) Home address moves into customer_contacts ----------------------------------------------
alter table public.customer_contacts
  add column house_no text, add column block text, add column address text,
  add column area text, add column city text;

alter table public.customers disable trigger audit_customers;
insert into public.customer_contacts (customer_id, house_no, block, address, area, city, updated_by)
select id, nullif(trim(house_no), ''), nullif(trim(block), ''), nullif(trim(address), ''), nullif(trim(area), ''),
       nullif(trim(city), ''), created_by
  from public.customers
 where coalesce(nullif(trim(house_no), ''), nullif(trim(block), ''), nullif(trim(address), ''), nullif(trim(area), '')) is not null
on conflict (customer_id) do update set house_no = excluded.house_no, block = excluded.block,
  address = excluded.address, area = excluded.area, city = excluded.city;

drop view public.open_alerts;
alter table public.customers drop column house_no, drop column block, drop column address,
  drop column area, drop column city;


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


-- Area no longer goes into the search text (searching "DHA" would reveal who lives there).
create or replace function private.customers_search_text() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.search_text := private.search_norm(concat_ws(' ', new.code, new.full_name, new.full_name_ur));
  return new;
end $$;
update public.customers set search_text = private.search_norm(concat_ws(' ', code, full_name, full_name_ur));
alter table public.customers enable trigger audit_customers;

-- One-line address, read through RLS: empty for anyone but the owner.
create or replace function public.customer_address_line(p_customer uuid) returns text
language sql stable set search_path = '' as $$
  select nullif(concat_ws(', ',
    nullif('House ' || nullif(trim(cc.house_no), ''), 'House '),
    nullif(trim(cc.block), ''), nullif(trim(cc.address), ''), nullif(trim(cc.area), ''), nullif(trim(cc.city), '')), '')
  from public.customer_contacts cc where cc.customer_id = p_customer;
$$;

-- Same, for the system (triggers below) when it fills in a saved address.
create or replace function private.saved_address(p_customer uuid) returns text
language sql stable security definer set search_path = '' as $$
  select nullif(concat_ws(', ',
    nullif('House ' || nullif(trim(cc.house_no), ''), 'House '),
    nullif(trim(cc.block), ''), nullif(trim(cc.address), ''), nullif(trim(cc.area), ''), nullif(trim(cc.city), '')), '')
  from public.customer_contacts cc where cc.customer_id = p_customer;
$$;
revoke execute on function private.saved_address(uuid) from public, anon, authenticated;

-- 3) Owner-only tables for delivery / home-visit addresses and the consent signer's phone ------
create table public.appointment_addresses (
  appointment_id uuid primary key references public.appointments (id) on delete cascade deferrable initially deferred,
  address    text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id) default auth.uid()
);
create table public.visit_addresses (
  visit_id   uuid primary key references public.visits (id) on delete cascade deferrable initially deferred,
  address    text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff (id) default auth.uid()
);
create table public.invoice_addresses (
  invoice_id       uuid primary key references public.invoices (id) on delete cascade deferrable initially deferred,
  delivery_address text,
  service_address  text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references public.staff (id) default auth.uid()
);
create table public.consent_contacts (
  consent_id   uuid primary key references public.surgery_consents (id) on delete cascade deferrable initially deferred,
  signer_phone text not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.staff (id) default auth.uid()
);

do $$
declare t text;
begin
  foreach t in array array['appointment_addresses', 'visit_addresses', 'invoice_addresses', 'consent_contacts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select private.has_permission(''customers.contact'')))', t || '_select', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('create trigger %I before update on public.%I for each row execute function private.set_updated_at()', t || '_updated_at', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function private.audit_row()', 'audit_' || t, t);
  end loop;
end $$;

-- The address now lives in the private tables, so the "address required" checks go (when no
-- address is on file the screens say so, and the owner adds it).
alter table public.appointments drop constraint appointments_service_address_ck;
alter table public.visits drop constraint visits_service_address_ck;
alter table public.invoices drop constraint invoices_service_address_ck;
alter table public.invoices drop constraint invoices_delivery_needs_customer_ck;
alter table public.invoices add constraint invoices_delivery_needs_customer_ck
  check (fulfilment = 'in_store' or customer_id is not null);

-- Existing data moves over, then the old columns are emptied (history is cleaned in step 6).
alter table public.invoices disable trigger user;
alter table public.visits disable trigger user;
alter table public.appointments disable trigger user;
alter table public.surgery_consents disable trigger user;
insert into public.invoice_addresses (invoice_id, delivery_address, service_address)
select id, nullif(trim(delivery_address), ''), nullif(trim(service_address), '') from public.invoices
 where coalesce(nullif(trim(delivery_address), ''), nullif(trim(service_address), '')) is not null;
insert into public.visit_addresses (visit_id, address)
select id, trim(service_address) from public.visits where coalesce(trim(service_address), '') <> '';
insert into public.appointment_addresses (appointment_id, address)
select id, trim(service_address) from public.appointments where coalesce(trim(service_address), '') <> '';
insert into public.consent_contacts (consent_id, signer_phone)
select id, trim(signer_phone) from public.surgery_consents where coalesce(trim(signer_phone), '') <> '';
update public.invoices set delivery_address = null, service_address = null where delivery_address is not null or service_address is not null;
update public.visits set service_address = null where service_address is not null;
update public.appointments set service_address = null where service_address is not null;
update public.surgery_consents set signer_phone = null where signer_phone is not null;
alter table public.invoices enable trigger user;
alter table public.visits enable trigger user;
alter table public.appointments enable trigger user;
alter table public.surgery_consents enable trigger user;

comment on column public.invoices.delivery_address is 'Write-only: moved to invoice_addresses (owner only) by a trigger; always empty.';
comment on column public.invoices.service_address is 'Write-only: moved to invoice_addresses (owner only) by a trigger; always empty.';
comment on column public.visits.service_address is 'Write-only: moved to visit_addresses (owner only) by a trigger; always empty.';
comment on column public.appointments.service_address is 'Write-only: moved to appointment_addresses (owner only) by a trigger; always empty.';
comment on column public.surgery_consents.signer_phone is 'Write-only: moved to consent_contacts (owner only) by a trigger; always empty.';

-- 4) Write-through triggers ------------------------------------------------------------------
-- Only the owner may type an address / phone. The system may copy one (saved address, the
-- appointment's address onto its visit, the visit's address onto its bill).
create or replace function private.owner_may_write(p_value text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if nullif(trim(coalesce(p_value, '')), '') is not null and not private.has_permission('customers.contact') then
    raise exception 'only the hospital owner can enter or change contact details and addresses' using errcode = '42501';
  end if;
end $$;

create or replace function private.appointment_private_address() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v text := nullif(trim(coalesce(new.service_address, '')), '');
begin
  perform private.owner_may_write(v);
  new.service_address := null;
  if new.service_location <> 'home_visit' then
    delete from public.appointment_addresses where appointment_id = new.id;
  elsif v is not null then
    insert into public.appointment_addresses (appointment_id, address) values (new.id, v)
    on conflict (appointment_id) do update set address = excluded.address, updated_by = auth.uid();
  elsif not exists (select 1 from public.appointment_addresses where appointment_id = new.id) then
    insert into public.appointment_addresses (appointment_id, address)
    select new.id, a from private.saved_address(new.customer_id) a where a is not null;
  end if;
  return new;
end $$;
create trigger zz_appointments_private_address before insert or update of service_location, service_address on public.appointments
  for each row execute function private.appointment_private_address();

create or replace function private.visit_private_address() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v text := nullif(trim(coalesce(new.service_address, '')), '');
begin
  perform private.owner_may_write(v);
  new.service_address := null;
  if new.service_location <> 'home_visit' then
    delete from public.visit_addresses where visit_id = new.id;
  elsif v is not null then
    insert into public.visit_addresses (visit_id, address) values (new.id, v)
    on conflict (visit_id) do update set address = excluded.address, updated_by = auth.uid();
  elsif not exists (select 1 from public.visit_addresses where visit_id = new.id) then
    insert into public.visit_addresses (visit_id, address)
    select new.id, coalesce(
      (select aa.address from public.appointment_addresses aa where aa.appointment_id = new.appointment_id),
      private.saved_address(new.customer_id))
    where coalesce((select aa.address from public.appointment_addresses aa where aa.appointment_id = new.appointment_id),
                   private.saved_address(new.customer_id)) is not null;
  end if;
  return new;
end $$;
create trigger zz_visits_private_address before insert or update of service_location, service_address on public.visits
  for each row execute function private.visit_private_address();

create or replace function private.invoice_private_address() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  d text := nullif(trim(coalesce(new.delivery_address, '')), '');
  s text := nullif(trim(coalesce(new.service_address, '')), '');
  cur public.invoice_addresses;
begin
  perform private.owner_may_write(d);
  perform private.owner_may_write(s);
  new.delivery_address := null;
  new.service_address := null;
  select * into cur from public.invoice_addresses where invoice_id = new.id;
  if new.fulfilment <> 'home_delivery' then d := null;
  elsif d is null then d := coalesce(cur.delivery_address, private.saved_address(new.customer_id));
  end if;
  if new.service_location <> 'home_visit' then s := null;
  elsif s is null then
    s := coalesce(cur.service_address,
                  (select va.address from public.visit_addresses va where va.visit_id = new.visit_id),
                  private.saved_address(new.customer_id));
  end if;
  if d is null and s is null then
    delete from public.invoice_addresses where invoice_id = new.id;
  elsif d is distinct from cur.delivery_address or s is distinct from cur.service_address or cur.invoice_id is null then
    insert into public.invoice_addresses (invoice_id, delivery_address, service_address) values (new.id, d, s)
    on conflict (invoice_id) do update set delivery_address = excluded.delivery_address,
      service_address = excluded.service_address, updated_by = auth.uid();
  end if;
  return new;
end $$;
create trigger zz_invoices_private_address before insert or update of fulfilment, service_location, delivery_address, service_address, customer_id
  on public.invoices for each row execute function private.invoice_private_address();

create or replace function private.consent_private_phone() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v text := nullif(trim(coalesce(new.signer_phone, '')), '');
begin
  perform private.owner_may_write(v);
  new.signer_phone := null;
  if v is not null then
    insert into public.consent_contacts (consent_id, signer_phone) values (new.id, v);
  end if;
  return new;
end $$;
create trigger aa_surgery_consents_private_phone before insert on public.surgery_consents
  for each row execute function private.consent_private_phone();

-- A visit's address change follows it onto its draft bill.
create or replace function private.visit_location_to_draft_bill() returns trigger
language plpgsql security definer set search_path = '' as $$
declare inv uuid; v text := (select va.address from public.visit_addresses va where va.visit_id = new.id);
begin
  for inv in update public.invoices set service_location = new.service_location
              where visit_id = new.id and status = 'draft' returning id loop
    if new.service_location = 'home_visit' and v is not null then
      insert into public.invoice_addresses (invoice_id, service_address) values (inv, v)
      on conflict (invoice_id) do update set service_address = excluded.service_address, updated_by = auth.uid();
    end if;
  end loop;
  return null;
end $$;

-- A bill made from a visit inherits where the service was given (the address is copied by the
-- private-address trigger).
create or replace function private.invoice_fulfilment_rules() returns trigger
language plpgsql security definer set search_path = '' as $$
declare has_line boolean; v record;
begin
  if tg_op = 'INSERT' and new.visit_id is not null and new.service_location = 'clinic' then
    select service_location into v from public.visits where id = new.visit_id;
    if found then new.service_location := v.service_location; end if;
  end if;

  if tg_op = 'INSERT' or old.status = 'draft' then
    if new.fulfilment = 'home_delivery' then
      new.delivery_status := coalesce(new.delivery_status, 'pending');
    else
      new.delivery_status := null;
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
end $$;

-- 5) Functions that read or wrote the moved fields ------------------------------------------
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

CREATE OR REPLACE FUNCTION public.update_delivery(p_invoice uuid, p_status text DEFAULT NULL::text, p_charge numeric DEFAULT NULL::numeric, p_address text DEFAULT NULL::text, p_rider text DEFAULT NULL::text, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare inv public.invoices; line public.invoice_items; before jsonb;
begin
  select * into inv from public.invoices where id = p_invoice for update;
  if not found then raise exception 'order not found'; end if;
  if not private.can_write_invoice(inv.kind) then raise exception 'permission denied' using errcode = '42501'; end if;
  if inv.fulfilment <> 'home_delivery' then raise exception 'this is not a home delivery order'; end if;
  if inv.status = 'void' then raise exception 'this order was voided'; end if;
  if inv.status = 'draft' then raise exception 'finish the sale first — draft orders are edited on the bill'; end if;
  if p_status is not null and p_status not in ('pending', 'dispatched', 'delivered') then raise exception 'unknown delivery status'; end if;
  if inv.delivery_status = 'delivered' and p_status is distinct from 'delivered' and p_status is not null then
    raise exception 'this order is already delivered';
  end if;
  if (p_charge is not null or p_address is not null) and inv.delivery_status <> 'pending' then
    raise exception 'the order has left the shop — the delivery charge and address are locked';
  end if;
  before := jsonb_build_object('status', inv.delivery_status, 'total', inv.total);

  perform set_config('bdah.billing', 'on', true);

  if p_address is not null then
    if trim(p_address) = '' then raise exception 'enter the delivery address'; end if;
    update public.invoices set delivery_address = trim(p_address) where id = p_invoice;
  end if;

  if p_charge is not null then
    if p_charge < 0 then raise exception 'the delivery charge can''t be negative'; end if;
    select * into line from public.invoice_items where invoice_id = p_invoice and line_role = 'delivery_charge' for update;
    if not found then raise exception 'this order has no delivery charge line'; end if;
    if line.unit_price is distinct from p_charge then
      if inv.amount_paid <> 0 or inv.returned_amount <> 0 then
        raise exception 'money was already taken on this order, so the delivery charge is locked — use a refund/return instead';
      end if;
      if p_charge = 0 and not private.has_permission('billing.discount') then
        raise exception 'only staff who can give discounts can waive the delivery charge (Rs. 0)' using errcode = '42501';
      end if;
      perform set_config('bdah.delivery', 'on', true);
      update public.invoice_items set unit_price = p_charge where id = line.id;
      perform set_config('bdah.delivery', '', true);
      -- Re-total the issued bill (same formula as recalc_invoice, which only touches drafts).
      update public.invoices i set
        subtotal = t.subtotal, line_discounts = t.disc, tax_total = t.tax, total = greatest(0, t.total - i.invoice_discount)
      from (select coalesce(sum(line_subtotal), 0) subtotal, coalesce(sum(discount_amount), 0) disc,
                   coalesce(sum(tax_amount), 0) tax, coalesce(sum(line_total), 0) total
            from public.invoice_items where invoice_id = p_invoice) t
      where i.id = p_invoice;
      -- Keep the cash-on-delivery due equal to what is now owed.
      select * into inv from public.invoices where id = p_invoice;
      if inv.balance > 0 then
        insert into public.dues (invoice_id, customer_id, pet_id, original_amount, reason, promised_date)
        values (p_invoice, inv.customer_id, inv.pet_id, inv.balance, 'Cash on delivery', private.clinic_today())
        on conflict (invoice_id) do update set original_amount = excluded.original_amount, status = 'open', closed_at = null;
      end if;
      insert into public.audit_logs (actor_id, action, table_name, record_id, reason, context)
      values ((select auth.uid()), 'delivery.charge_changed', 'invoices', p_invoice::text, nullif(trim(p_note), ''),
              jsonb_build_object('from', line.unit_price, 'to', p_charge));
    end if;
  end if;

  update public.invoices set
    delivery_status = coalesce(p_status, delivery_status),
    dispatched_at = case when p_status in ('dispatched', 'delivered') then coalesce(dispatched_at, now())
                         when p_status = 'pending' then null else dispatched_at end,
    dispatched_by = case when p_status in ('dispatched', 'delivered') then coalesce(dispatched_by, (select auth.uid()))
                         when p_status = 'pending' then null else dispatched_by end,
    delivered_at  = case when p_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
    delivered_by  = case when p_status = 'delivered' then coalesce(delivered_by, (select auth.uid())) else delivered_by end,
    delivery_rider = coalesce(nullif(trim(p_rider), ''), delivery_rider),
    delivery_notes = case when nullif(trim(p_note), '') is null then delivery_notes
                          else concat_ws(E'\n', delivery_notes, trim(p_note)) end
  where id = p_invoice;
  perform set_config('bdah.billing', '', true);

  if p_status is not null and p_status is distinct from before ->> 'status' then
    insert into public.audit_logs (actor_id, action, table_name, record_id, reason, context)
    values ((select auth.uid()), 'delivery.' || p_status, 'invoices', p_invoice::text, nullif(trim(p_note), ''), before);
  end if;
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
    -- Owners: name (fuzzy, Urdu), code; phone (any format, partial) and email for the owner only
    select 'customer', c.id, c.code, c.full_name,
           concat_ws(' · ', (select cc.phone from public.customer_contacts cc where cc.customer_id = c.id),
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
  select c.id, c.code, c.full_name, cc.phone, cc.area,
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
      'count', (select count(*) from public.customers c where c.status = 'active' and not exists (select 1 from public.customer_contacts cc where cc.customer_id = c.id and coalesce(trim(cc.area), '') <> ''))),
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

CREATE OR REPLACE FUNCTION private.customer_ids_by_contact(p_raw text)
 RETURNS SETOF uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  end if;  -- other staff: numbers never find anyone
end $function$;

-- 6) Activity log: the private tables are owner-only, and contact details are removed from the
--    history of the other tables (all of it, including from before 036).
drop policy audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
  using ((select private.has_permission('audit.view'))
         and (table_name not in ('customer_contacts', 'appointment_addresses', 'visit_addresses', 'invoice_addresses', 'consent_contacts')
              or (select private.has_permission('customers.contact'))));

update public.audit_logs set
  old_data = old_data - array['phone', 'whatsapp', 'alt_phone', 'email', 'house_no', 'block', 'address', 'area', 'city',
                              'service_address', 'delivery_address', 'signer_phone', 'to_phone'],
  new_data = new_data - array['phone', 'whatsapp', 'alt_phone', 'email', 'house_no', 'block', 'address', 'area', 'city',
                              'service_address', 'delivery_address', 'signer_phone', 'to_phone'],
  changed = case when changed is null then null else array(select x from unnest(changed) x where x not in ('phone', 'whatsapp', 'alt_phone', 'email', 'house_no', 'block',
                  'address', 'area', 'city', 'service_address', 'delivery_address', 'signer_phone', 'to_phone')) end
 where table_name in ('customers', 'invoices', 'visits', 'appointments', 'surgery_consents', 'messages')
   and (coalesce(old_data, '{}') ?| array['phone', 'whatsapp', 'alt_phone', 'email', 'house_no', 'block', 'address', 'area', 'city',
                                          'service_address', 'delivery_address', 'signer_phone', 'to_phone']
        or coalesce(new_data, '{}') ?| array['phone', 'whatsapp', 'alt_phone', 'email', 'house_no', 'block', 'address', 'area', 'city',
                                             'service_address', 'delivery_address', 'signer_phone', 'to_phone']);
update public.audit_logs set context = context - 'address'
 where action like 'delivery.%' and context ? 'address';
