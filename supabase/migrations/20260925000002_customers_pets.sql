-- =============================================================================
-- Phase 1 — Customers (pet owners) & Pets (patients)
-- =============================================================================

create type public.contact_channel as enum ('whatsapp', 'call', 'sms', 'email');
create type public.customer_status as enum ('active', 'inactive', 'merged');
create type public.pet_sex as enum ('male', 'female', 'unknown');
create type public.pet_status as enum ('active', 'deceased', 'transferred', 'inactive');
create type public.pet_alert_kind as enum ('allergy', 'condition', 'behaviour', 'other');
create type public.alert_severity as enum ('info', 'warning', 'critical');

-- Lower-cased, accent-free text used for fuzzy matching.
create or replace function private.search_norm(t text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, coalesce(t, '')));
$$;

-- -----------------------------------------------------------------------------
-- Customers
-- -----------------------------------------------------------------------------
create sequence public.customer_code_seq start 1;

create table public.customers (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique
                        default 'C-' || lpad(nextval('public.customer_code_seq')::text, 5, '0'),
  full_name           text not null check (length(trim(full_name)) > 0),
  -- Optional name in Urdu script, for printing/recognition.
  full_name_ur        text,
  -- Phones stored as E.164 (+923001234567); formatted for display in the app.
  phone               text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp            text check (whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  alt_phone           text check (alt_phone ~ '^\+[1-9][0-9]{7,14}$'),
  email               extensions.citext,
  -- Free-form address: local addresses rarely follow a strict structure.
  address             text,
  area                text,                    -- e.g. "DHA Phase 5", "Johar Town"
  city                text not null default 'Lahore',
  preferred_channel   public.contact_channel not null default 'whatsapp',
  marketing_opt_in    boolean not null default false,
  referral_source     text,                    -- walk-in, Google, Instagram, referral...
  notes               text,
  status              public.customer_status not null default 'active',
  merged_into_id      uuid references public.customers (id),
  custom_fields       jsonb not null default '{}'::jsonb,
  search_text         text not null default '',
  created_by          uuid references public.staff (id) default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((status = 'merged') = (merged_into_id is not null))
);
alter sequence public.customer_code_seq owned by public.customers.code;

create index customers_phone_idx on public.customers (phone);
create index customers_whatsapp_idx on public.customers (whatsapp);
create index customers_alt_phone_idx on public.customers (alt_phone);
create index customers_search_trgm on public.customers using gin (search_text extensions.gin_trgm_ops);
create index customers_name_trgm on public.customers using gin (private.search_norm(full_name) extensions.gin_trgm_ops);
create index customers_created_idx on public.customers (created_at desc);

-- -----------------------------------------------------------------------------
-- Species & breeds (configurable lists)
-- -----------------------------------------------------------------------------
create table public.species (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  name_ur     text,
  sort_order  int not null default 100,
  is_active   boolean not null default true
);

create table public.breeds (
  id          uuid primary key default gen_random_uuid(),
  species_id  uuid not null references public.species (id) on delete cascade,
  name        text not null,
  is_active   boolean not null default true,
  unique (species_id, name)
);

-- -----------------------------------------------------------------------------
-- Pets
-- -----------------------------------------------------------------------------
create sequence public.pet_code_seq start 1;

create table public.pets (
  id                uuid primary key default gen_random_uuid(),
  code              text not null unique
                      default 'P-' || lpad(nextval('public.pet_code_seq')::text, 5, '0'),
  name              text not null check (length(trim(name)) > 0),
  species_id        uuid not null references public.species (id),
  breed_id          uuid references public.breeds (id),
  breed_text        text,                    -- when not in the list, or mixed
  sex               public.pet_sex not null default 'unknown',
  is_neutered       boolean,
  date_of_birth     date,
  dob_is_estimate   boolean not null default false,
  color             text,
  markings          text,
  microchip_no      text,
  tag_no            text,
  photo_path        text,                    -- storage object path, never a public URL
  status            public.pet_status not null default 'active',
  status_changed_at timestamptz,
  special_handling  text,                    -- quick note shown on every screen
  notes             text,
  custom_fields     jsonb not null default '{}'::jsonb,
  search_text       text not null default '',
  created_by        uuid references public.staff (id) default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter sequence public.pet_code_seq owned by public.pets.code;

create unique index pets_microchip_uq on public.pets (microchip_no) where microchip_no is not null;
create index pets_species_idx on public.pets (species_id);
create index pets_search_trgm on public.pets using gin (search_text extensions.gin_trgm_ops);
create index pets_created_idx on public.pets (created_at desc);

-- A pet can have more than one owner (family members); one is primary.
create table public.pet_owners (
  pet_id       uuid not null references public.pets (id) on delete cascade,
  customer_id  uuid not null references public.customers (id) on delete restrict,
  is_primary   boolean not null default false,
  relationship text,
  created_at   timestamptz not null default now(),
  primary key (pet_id, customer_id)
);
create index pet_owners_customer_idx on public.pet_owners (customer_id);
create unique index pet_owners_one_primary on public.pet_owners (pet_id) where is_primary;

create table public.pet_weights (
  id          uuid primary key default gen_random_uuid(),
  pet_id      uuid not null references public.pets (id) on delete cascade,
  weight_kg   numeric(7,3) not null check (weight_kg > 0 and weight_kg < 2000),
  measured_at timestamptz not null default now(),
  visit_id    uuid,                          -- FK added when visits exist (Phase 2)
  recorded_by uuid references public.staff (id) default auth.uid(),
  note        text
);
create index pet_weights_pet_idx on public.pet_weights (pet_id, measured_at desc);

-- Allergies, chronic conditions and behaviour flags shown as banners.
create table public.pet_alerts (
  id          uuid primary key default gen_random_uuid(),
  pet_id      uuid not null references public.pets (id) on delete cascade,
  kind        public.pet_alert_kind not null,
  label       text not null,
  severity    public.alert_severity not null default 'warning',
  notes       text,
  is_active   boolean not null default true,
  recorded_by uuid references public.staff (id) default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index pet_alerts_pet_idx on public.pet_alerts (pet_id) where is_active;

-- -----------------------------------------------------------------------------
-- Search text maintenance
-- -----------------------------------------------------------------------------
create or replace function private.customers_search_text()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.search_text := private.search_norm(concat_ws(' ',
    new.code, new.full_name, new.full_name_ur, new.email::text, new.area,
    regexp_replace(new.phone, '\D', '', 'g'),
    -- local format 03xx... so "0300" style searches match
    '0' || right(regexp_replace(new.phone, '\D', '', 'g'), 10),
    regexp_replace(coalesce(new.whatsapp, ''), '\D', '', 'g'),
    regexp_replace(coalesce(new.alt_phone, ''), '\D', '', 'g')));
  return new;
end $$;

create or replace function private.pets_search_text()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.search_text := private.search_norm(concat_ws(' ',
    new.code, new.name, new.microchip_no, new.tag_no, new.breed_text, new.color));
  return new;
end $$;

create trigger customers_search before insert or update on public.customers
  for each row execute function private.customers_search_text();
create trigger pets_search before insert or update on public.pets
  for each row execute function private.pets_search_text();

create trigger customers_updated_at before update on public.customers
  for each row execute function private.set_updated_at();
create trigger pets_updated_at before update on public.pets
  for each row execute function private.set_updated_at();
create trigger pet_alerts_updated_at before update on public.pet_alerts
  for each row execute function private.set_updated_at();

create or replace function private.pets_status_changed()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then new.status_changed_at := now(); end if;
  return new;
end $$;
create trigger pets_status_changed before update on public.pets
  for each row execute function private.pets_status_changed();

-- Audit
create trigger audit_customers after insert or update or delete on public.customers
  for each row execute function private.audit_row();
create trigger audit_pets after insert or update or delete on public.pets
  for each row execute function private.audit_row();
create trigger audit_pet_owners after insert or update or delete on public.pet_owners
  for each row execute function private.audit_row();
create trigger audit_pet_alerts after insert or update or delete on public.pet_alerts
  for each row execute function private.audit_row();
create trigger audit_species after insert or update or delete on public.species
  for each row execute function private.audit_row();
create trigger audit_breeds after insert or update or delete on public.breeds
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.customers   enable row level security;
alter table public.species     enable row level security;
alter table public.breeds      enable row level security;
alter table public.pets        enable row level security;
alter table public.pet_owners  enable row level security;
alter table public.pet_weights enable row level security;
alter table public.pet_alerts  enable row level security;

create policy customers_select on public.customers for select to authenticated
  using ((select private.has_permission('customers.view')));
create policy customers_insert on public.customers for insert to authenticated
  with check ((select private.has_permission('customers.create')));
create policy customers_update on public.customers for update to authenticated
  using ((select private.has_permission('customers.edit')))
  with check ((select private.has_permission('customers.edit')));
create policy customers_delete on public.customers for delete to authenticated
  using ((select private.has_permission('customers.delete')));

create policy species_select on public.species for select to authenticated
  using ((select private.is_active_staff()));
create policy species_manage on public.species for all to authenticated
  using ((select private.has_permission('settings.manage')))
  with check ((select private.has_permission('settings.manage')));
create policy breeds_select on public.breeds for select to authenticated
  using ((select private.is_active_staff()));
create policy breeds_manage on public.breeds for all to authenticated
  using ((select private.has_permission('settings.manage')))
  with check ((select private.has_permission('settings.manage')));

create policy pets_select on public.pets for select to authenticated
  using ((select private.has_permission('pets.view')));
create policy pets_insert on public.pets for insert to authenticated
  with check ((select private.has_permission('pets.create')));
create policy pets_update on public.pets for update to authenticated
  using ((select private.has_permission('pets.edit')))
  with check ((select private.has_permission('pets.edit')));
create policy pets_delete on public.pets for delete to authenticated
  using ((select private.has_permission('pets.delete')));

create policy pet_owners_select on public.pet_owners for select to authenticated
  using ((select private.has_permission('pets.view')) or (select private.has_permission('customers.view')));
create policy pet_owners_write on public.pet_owners for all to authenticated
  using ((select private.has_permission('pets.edit')) or (select private.has_permission('pets.create')))
  with check ((select private.has_permission('pets.edit')) or (select private.has_permission('pets.create')));

-- Weights & alerts are clinical-adjacent but needed by reception for safe handling.
create policy pet_weights_select on public.pet_weights for select to authenticated
  using ((select private.has_permission('pets.view')));
create policy pet_weights_insert on public.pet_weights for insert to authenticated
  with check ((select private.has_permission('pets.edit')) or (select private.has_permission('clinical.create')));
create policy pet_weights_delete on public.pet_weights for delete to authenticated
  using ((select private.has_permission('clinical.edit')));

create policy pet_alerts_select on public.pet_alerts for select to authenticated
  using ((select private.has_permission('pets.view')));
create policy pet_alerts_write on public.pet_alerts for all to authenticated
  using ((select private.has_permission('pets.edit')))
  with check ((select private.has_permission('pets.edit')));

-- -----------------------------------------------------------------------------
-- Duplicate detection (spec §6): phone match or similar name.
-- -----------------------------------------------------------------------------
create or replace function public.find_customer_duplicates(p_phone text default null, p_name text default null,
  p_exclude uuid default null)
returns table (id uuid, code text, full_name text, phone text, area text, reason text, score real)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.code, c.full_name, c.phone, c.area,
         case when p_phone is not null and p_phone in (c.phone, c.whatsapp, c.alt_phone)
              then 'same phone' else 'similar name' end,
         greatest(
           case when p_phone is not null and p_phone in (c.phone, c.whatsapp, c.alt_phone) then 1.0 else 0 end,
           case when p_name is not null
                then extensions.similarity(private.search_norm(c.full_name), private.search_norm(p_name)) else 0 end
         )::real as score
  from public.customers c
  where c.status <> 'merged'
    and (p_exclude is null or c.id <> p_exclude)
    and (
      (p_phone is not null and p_phone in (c.phone, c.whatsapp, c.alt_phone))
      or (p_name is not null and length(p_name) >= 3
          and private.search_norm(c.full_name) operator(extensions.%) private.search_norm(p_name))
    )
  order by score desc
  limit 10;
$$;

-- -----------------------------------------------------------------------------
-- Controlled merge (spec §6). Moves everything from source to target.
-- Later phases add their customer-linked tables to this function.
-- -----------------------------------------------------------------------------
create or replace function public.merge_customers(p_source uuid, p_target uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('customers.merge') then
    raise exception 'permission denied: customers.merge' using errcode = '42501';
  end if;
  if p_source = p_target then raise exception 'cannot merge a customer into itself'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  perform 1 from public.customers where id in (p_source, p_target) and status <> 'merged' having count(*) = 2;
  if not found then raise exception 'both customers must exist and not already be merged'; end if;

  -- Re-point pet ownership; drop duplicates where the pet is already on the target.
  delete from public.pet_owners po
   where po.customer_id = p_source
     and exists (select 1 from public.pet_owners t where t.pet_id = po.pet_id and t.customer_id = p_target);
  update public.pet_owners set customer_id = p_target where customer_id = p_source;

  update public.customers
     set status = 'merged', merged_into_id = p_target,
         notes = concat_ws(E'\n', notes, 'Merged into target on ' || now()::date || ': ' || p_reason)
   where id = p_source;

  insert into public.audit_logs (actor_id, action, table_name, record_id, reason, context)
  values ((select auth.uid()), 'customer.merged', 'customers', p_source::text, p_reason,
          jsonb_build_object('target', p_target));
end $$;
revoke execute on function public.merge_customers(uuid, uuid, text) from public, anon;
grant execute on function public.merge_customers(uuid, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Global search (spec §32). Security invoker: RLS decides what each user sees.
-- -----------------------------------------------------------------------------
create or replace function public.global_search(q text, max_results int default 20)
returns table (kind text, id uuid, code text, title text, subtitle text, rank real)
language sql stable security invoker set search_path = '' as $$
  with term as (
    select private.search_norm(trim(q)) as t,
           nullif(regexp_replace(q, '\D', '', 'g'), '') as digits
  ), hits as (
  (
    select 'customer'::text as kind, c.id as id, c.code as code, c.full_name as title,
           concat_ws(' · ', c.phone, c.area) as subtitle,
           greatest(extensions.similarity(c.search_text, term.t),
                    case when c.search_text like '%' || term.t || '%' then 0.9 else 0 end)::real as rank
    from public.customers c, term
    where c.status <> 'merged' and length(term.t) >= 2
      and (c.search_text like '%' || term.t || '%'
           or (term.digits is not null and length(term.digits) >= 4 and c.search_text like '%' || term.digits || '%')
           or c.search_text operator(extensions.%) term.t)
  )
  union all
  (
    select 'pet', p.id, p.code, p.name,
           concat_ws(' · ', s.name, coalesce(b.name, p.breed_text),
             (select string_agg(c.full_name, ', ') from public.pet_owners po
                join public.customers c on c.id = po.customer_id where po.pet_id = p.id)),
           greatest(extensions.similarity(p.search_text, term.t),
                    case when p.search_text like '%' || term.t || '%' then 0.9 else 0 end)::real
    from public.pets p
    join public.species s on s.id = p.species_id
    left join public.breeds b on b.id = p.breed_id, term
    where length(term.t) >= 2
      and (p.search_text like '%' || term.t || '%' or p.search_text operator(extensions.%) term.t)
  )
  union all
  (
    -- Pets reachable through an owner's phone number / name.
    select 'pet', p.id, p.code, p.name, concat_ws(' · ', s.name, 'owner: ' || c.full_name), 0.5::real
    from public.customers c
    join public.pet_owners po on po.customer_id = c.id
    join public.pets p on p.id = po.pet_id
    join public.species s on s.id = p.species_id, term
    where c.status <> 'merged' and term.digits is not null and length(term.digits) >= 4
      and c.search_text like '%' || term.digits || '%'
  )
  )
  select * from (
    select distinct on (h.kind, h.id) h.* from hits h order by h.kind, h.id, h.rank desc
  ) d
  order by d.rank desc, d.title
  limit max_results;
$$;
revoke execute on function public.global_search(text, int) from public, anon;
grant execute on function public.global_search(text, int) to authenticated;
revoke execute on function public.find_customer_duplicates(text, text, uuid) from public, anon;
grant execute on function public.find_customer_duplicates(text, text, uuid) to authenticated;
