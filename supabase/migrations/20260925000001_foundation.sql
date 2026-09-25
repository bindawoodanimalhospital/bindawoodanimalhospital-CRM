-- =============================================================================
-- Bin Dawood Animal Hospital CRM — Phase 1 Foundation
-- Identity & RBAC, staff, settings, audit log.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists citext with schema extensions;

-- Functions that must never be callable through the public API live here.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------
create or replace function private.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Staff (one identity per person — see spec §49 unified Intern + Store role)
-- -----------------------------------------------------------------------------
create table public.staff (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text not null default '',
  display_name  text,
  email         extensions.citext,
  phone         text,
  title         text,                       -- e.g. "Senior Veterinarian"
  pmdc_number   text,                       -- vet council / licence no., printed on Rx
  is_active     boolean not null default false, -- activated by an admin
  is_doctor     boolean not null default false,
  color         text,                       -- calendar colour
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger staff_updated_at before update on public.staff
  for each row execute function private.set_updated_at();

-- Every new auth user gets an inactive staff row with no roles. Until an admin activates
-- the account and assigns roles, a stray sign-up cannot see anything.
create or replace function private.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.staff (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- Roles & permissions (configurable without code — spec §23)
-- -----------------------------------------------------------------------------
create table public.permissions (
  key          text primary key,            -- "<module>.<action>"
  module       text not null,
  action       text not null,
  label        text not null,
  description  text,
  is_sensitive boolean not null default false,
  sort_order   int not null default 0
);

create table public.roles (
  id           uuid primary key default gen_random_uuid(),
  key          text not null unique,
  name         text not null,
  description  text,
  is_system    boolean not null default false,  -- system roles can't be deleted
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger roles_updated_at before update on public.roles
  for each row execute function private.set_updated_at();

create table public.role_permissions (
  role_id        uuid not null references public.roles (id) on delete cascade,
  permission_key text not null references public.permissions (key) on delete cascade,
  primary key (role_id, permission_key)
);

-- Multiple roles per person, optionally time-boxed for shift cover.
create table public.staff_roles (
  staff_id    uuid not null references public.staff (id) on delete cascade,
  role_id     uuid not null references public.roles (id) on delete cascade,
  valid_from  timestamptz not null default now(),
  valid_until timestamptz,
  granted_by  uuid references public.staff (id),
  created_at  timestamptz not null default now(),
  primary key (staff_id, role_id),
  check (valid_until is null or valid_until > valid_from)
);
create index staff_roles_role_idx on public.staff_roles (role_id);

-- -----------------------------------------------------------------------------
-- Authorization helpers (used by every RLS policy)
-- -----------------------------------------------------------------------------
create or replace function private.has_permission(perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.staff s
    join public.staff_roles sr on sr.staff_id = s.id
    join public.role_permissions rp on rp.role_id = sr.role_id
    where s.id = (select auth.uid())
      and s.is_active
      and sr.valid_from <= now()
      and (sr.valid_until is null or sr.valid_until > now())
      and rp.permission_key = perm
  );
$$;

create or replace function private.is_active_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where id = (select auth.uid()) and is_active);
$$;

-- Public, read-only wrapper so the UI can ask "what can I do?" in one round trip.
create or replace function public.my_permissions()
returns setof text language sql stable security definer set search_path = '' as $$
  select distinct rp.permission_key
  from public.staff s
  join public.staff_roles sr on sr.staff_id = s.id
  join public.role_permissions rp on rp.role_id = sr.role_id
  where s.id = (select auth.uid())
    and s.is_active
    and sr.valid_from <= now()
    and (sr.valid_until is null or sr.valid_until > now());
$$;
revoke execute on function public.my_permissions() from public, anon;
grant execute on function public.my_permissions() to authenticated;

grant execute on function private.has_permission(text) to authenticated;
grant execute on function private.is_active_staff() to authenticated;

-- -----------------------------------------------------------------------------
-- System settings (key/value, spec §39)
-- -----------------------------------------------------------------------------
create table public.system_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references public.staff (id),
  updated_at  timestamptz not null default now()
);
create trigger system_settings_updated_at before update on public.system_settings
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Audit log (append-only, spec §24)
-- -----------------------------------------------------------------------------
create table public.audit_logs (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid,                       -- auth.uid(); null for system jobs
  action      text not null,              -- insert / update / delete / or a domain verb
  table_name  text,
  record_id   text,
  old_data    jsonb,
  new_data    jsonb,
  changed     text[],                     -- columns that changed on update
  reason      text,
  context     jsonb
);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id, occurred_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_id, occurred_at desc);
create index audit_logs_time_idx on public.audit_logs (occurred_at desc);

create or replace function private.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  old_j jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  new_j jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
  diff  text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(k) into diff
    from jsonb_object_keys(new_j) k
    where k <> 'updated_at' and new_j -> k is distinct from old_j -> k;
    if diff is null then return new; end if;   -- no-op update, don't log
  end if;

  insert into public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data, changed)
  values (
    (select auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce(new_j ->> 'id', old_j ->> 'id',
             new_j ->> 'key', old_j ->> 'key',
             concat_ws(':', coalesce(new_j, old_j) ->> 'staff_id', coalesce(new_j, old_j) ->> 'role_id',
                            coalesce(new_j, old_j) ->> 'pet_id', coalesce(new_j, old_j) ->> 'customer_id',
                            coalesce(new_j, old_j) ->> 'permission_key')),
    old_j, new_j, diff
  );
  return coalesce(new, old);
end $$;

-- Explicit domain events (e.g. "customer.merged", "data.exported").
create or replace function public.log_event(p_action text, p_table text default null,
  p_record_id text default null, p_reason text default null, p_context jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_active_staff() then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  insert into public.audit_logs (actor_id, action, table_name, record_id, reason, context)
  values ((select auth.uid()), p_action, p_table, p_record_id, p_reason, p_context);
end $$;
revoke execute on function public.log_event(text, text, text, text, jsonb) from public, anon;
grant execute on function public.log_event(text, text, text, text, jsonb) to authenticated;

create trigger audit_staff after insert or update or delete on public.staff
  for each row execute function private.audit_row();
create trigger audit_roles after insert or update or delete on public.roles
  for each row execute function private.audit_row();
create trigger audit_role_permissions after insert or update or delete on public.role_permissions
  for each row execute function private.audit_row();
create trigger audit_staff_roles after insert or update or delete on public.staff_roles
  for each row execute function private.audit_row();
create trigger audit_system_settings after insert or update or delete on public.system_settings
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
alter table public.staff            enable row level security;
alter table public.permissions      enable row level security;
alter table public.roles            enable row level security;
alter table public.role_permissions enable row level security;
alter table public.staff_roles      enable row level security;
alter table public.system_settings  enable row level security;
alter table public.audit_logs       enable row level security;

-- Staff directory: any active staff can see colleagues (needed for assignment pickers).
create policy staff_select on public.staff for select to authenticated
  using ((select private.is_active_staff()) or id = (select auth.uid()));
create policy staff_update_self on public.staff for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy staff_manage on public.staff for update to authenticated
  using ((select private.has_permission('staff.manage')))
  with check ((select private.has_permission('staff.manage')));

-- Stop a user promoting themselves via the self-update policy.
create or replace function private.guard_staff_self_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.is_active is distinct from old.is_active or new.is_doctor is distinct from old.is_doctor
      or new.email is distinct from old.email)
     and not private.has_permission('staff.manage')
     and current_user = 'authenticated' then
    raise exception 'only staff managers can change these fields' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger staff_guard before update on public.staff
  for each row execute function private.guard_staff_self_update();

create policy permissions_select on public.permissions for select to authenticated
  using ((select private.is_active_staff()));

create policy roles_select on public.roles for select to authenticated
  using ((select private.is_active_staff()));
create policy roles_manage on public.roles for all to authenticated
  using ((select private.has_permission('staff.manage')))
  with check ((select private.has_permission('staff.manage')));

create policy role_permissions_select on public.role_permissions for select to authenticated
  using ((select private.is_active_staff()));
create policy role_permissions_manage on public.role_permissions for all to authenticated
  using ((select private.has_permission('staff.manage')))
  with check ((select private.has_permission('staff.manage')));

create policy staff_roles_select on public.staff_roles for select to authenticated
  using (staff_id = (select auth.uid()) or (select private.has_permission('staff.view')));
create policy staff_roles_manage on public.staff_roles for all to authenticated
  using ((select private.has_permission('staff.manage')))
  with check ((select private.has_permission('staff.manage')));

create policy settings_select on public.system_settings for select to authenticated
  using ((select private.is_active_staff()));
create policy settings_manage on public.system_settings for all to authenticated
  using ((select private.has_permission('settings.manage')))
  with check ((select private.has_permission('settings.manage')));

-- Audit: read-only for auditors; nobody writes directly (triggers are security definer).
create policy audit_select on public.audit_logs for select to authenticated
  using ((select private.has_permission('audit.view')));
revoke insert, update, delete, truncate on public.audit_logs from authenticated, anon;
