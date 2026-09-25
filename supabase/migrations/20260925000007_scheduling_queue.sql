-- =============================================================================
-- Phase 2 — Appointments, visits & live queue (spec §8, §9)
--
-- appointment : a booking (Booked → Confirmed → Arrived | Cancelled | No-show → Completed)
-- visit       : a pet actually at the clinic today. Created on check-in or as a walk-in.
--               Waiting → With doctor → Treatment / diagnostics → Ready for billing → Completed
-- =============================================================================

create type public.appointment_status as enum ('booked', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show');
create type public.booking_source as enum ('phone', 'whatsapp', 'in_person', 'online', 'walk_in');
create type public.visit_status as enum ('waiting', 'with_doctor', 'in_treatment', 'ready_for_billing', 'completed', 'cancelled');
create type public.visit_priority as enum ('normal', 'urgent', 'emergency');

-- "Today" for the clinic, regardless of server timezone.
create or replace function private.clinic_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Karachi')::date;
$$;

-- -----------------------------------------------------------------------------
-- Configurable appointment / visit types
-- -----------------------------------------------------------------------------
create table public.appointment_types (
  id                uuid primary key default gen_random_uuid(),
  name              text not null unique,
  default_minutes   int not null default 15 check (default_minutes between 5 and 480),
  tone              text not null default 'neutral',   -- UI colour: neutral|brand|info|success|warning|danger
  requires_doctor   boolean not null default true,
  is_active         boolean not null default true,
  sort_order        int not null default 100
);

insert into public.appointment_types (name, default_minutes, tone, sort_order) values
  ('Consultation', 15, 'brand', 1),
  ('Vaccination', 10, 'success', 2),
  ('Follow-up', 10, 'info', 3),
  ('Emergency', 20, 'danger', 4),
  ('Dressing / wound care', 15, 'neutral', 5),
  ('Ultrasound', 20, 'info', 6),
  ('X-ray', 15, 'info', 7),
  ('Lab test', 10, 'neutral', 8),
  ('Surgery', 60, 'warning', 9),
  ('Grooming', 60, 'neutral', 10);

-- Doctor working hours (weekday 0 = Sunday … 6 = Saturday, clinic local time).
create table public.staff_schedules (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff (id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),
  start_time  time not null,
  end_time    time not null,
  check (end_time > start_time)
);
create index staff_schedules_staff_idx on public.staff_schedules (staff_id, weekday);

-- -----------------------------------------------------------------------------
-- Appointments
-- -----------------------------------------------------------------------------
create table public.appointments (
  id                      uuid primary key default gen_random_uuid(),
  customer_id             uuid not null references public.customers (id),
  pet_id                  uuid references public.pets (id),          -- optional: new pet may not be registered yet
  doctor_id               uuid references public.staff (id),         -- null = any available doctor
  appointment_type_id     uuid not null references public.appointment_types (id),
  starts_at               timestamptz not null,
  ends_at                 timestamptz not null,
  status                  public.appointment_status not null default 'booked',
  source                  public.booking_source not null default 'phone',
  is_urgent               boolean not null default false,
  reason                  text,
  notes                   text,
  pre_visit_instructions  text,
  cancel_reason           text,
  visit_id                uuid,                                        -- set on check-in (FK below)
  created_by              uuid references public.staff (id) default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (ends_at > starts_at),
  check (status <> 'cancelled' or cancel_reason is not null)
);
create index appointments_time_idx on public.appointments (starts_at);
create index appointments_doctor_time_idx on public.appointments (doctor_id, starts_at);
create index appointments_customer_idx on public.appointments (customer_id, starts_at desc);
create index appointments_pet_idx on public.appointments (pet_id, starts_at desc);

-- -----------------------------------------------------------------------------
-- Visits (the live queue)
-- -----------------------------------------------------------------------------
create table public.visit_token_counters (
  visit_date  date primary key,
  last_token  int not null default 0
);

create table public.visits (
  id                  uuid primary key default gen_random_uuid(),
  visit_date          date not null default private.clinic_today(),
  token_no            int not null default 0,                       -- assigned by trigger
  pet_id              uuid not null references public.pets (id),
  customer_id         uuid not null references public.customers (id),  -- who brought the pet
  appointment_id      uuid references public.appointments (id),
  doctor_id           uuid references public.staff (id),
  visit_type_id       uuid references public.appointment_types (id),
  reason              text,
  priority            public.visit_priority not null default 'normal',
  status              public.visit_status not null default 'waiting',
  checked_in_at       timestamptz not null default now(),
  started_at          timestamptz,                                  -- first time "with doctor"
  completed_at        timestamptz,
  status_changed_at   timestamptz not null default now(),
  cancel_reason       text,
  notes               text,
  created_by          uuid references public.staff (id) default auth.uid(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (visit_date, token_no),
  check (status <> 'cancelled' or cancel_reason is not null)
);
create index visits_date_status_idx on public.visits (visit_date, status);
create index visits_pet_idx on public.visits (pet_id, checked_in_at desc);
create index visits_customer_idx on public.visits (customer_id, checked_in_at desc);
create index visits_doctor_idx on public.visits (doctor_id, visit_date);

alter table public.appointments
  add constraint appointments_visit_fk foreign key (visit_id) references public.visits (id);
alter table public.pet_weights
  add constraint pet_weights_visit_fk foreign key (visit_id) references public.visits (id);

-- Every stage change is recorded (waiting times, doctor workload, peak hours — spec §26).
create table public.visit_status_events (
  id          bigint generated always as identity primary key,
  visit_id    uuid not null references public.visits (id) on delete cascade,
  from_status public.visit_status,
  to_status   public.visit_status not null,
  changed_at  timestamptz not null default now(),
  changed_by  uuid default auth.uid()
);
create index visit_status_events_visit_idx on public.visit_status_events (visit_id, changed_at);

-- Daily token: atomic counter, safe when two receptionists check in at the same moment.
create or replace function private.assign_visit_token()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.visit_token_counters as c (visit_date, last_token)
  values (new.visit_date, 1)
  on conflict (visit_date) do update set last_token = c.last_token + 1
  returning last_token into new.token_no;
  return new;
end $$;
create trigger visits_token before insert on public.visits
  for each row execute function private.assign_visit_token();

create or replace function private.visit_status_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.visit_status_events (visit_id, from_status, to_status) values (new.id, null, new.status);
    return null;
  end if;
  if new.status is distinct from old.status then
    insert into public.visit_status_events (visit_id, from_status, to_status) values (new.id, old.status, new.status);
  end if;
  return null;
end $$;
create trigger visits_status_events after insert or update of status on public.visits
  for each row execute function private.visit_status_change();

create or replace function private.visit_timestamps()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then
    new.status_changed_at := now();
    if new.status = 'with_doctor' and old.started_at is null then new.started_at := now(); end if;
    if new.status = 'completed' then new.completed_at := now(); end if;
    if old.status in ('completed', 'cancelled') and new.status not in ('completed', 'cancelled') then
      new.completed_at := null;   -- re-opened
    end if;
  end if;
  return new;
end $$;
create trigger visits_timestamps before update on public.visits
  for each row execute function private.visit_timestamps();

-- When a visit completes, its appointment completes too.
create or replace function private.visit_completes_appointment()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'completed' and old.status <> 'completed' and new.appointment_id is not null then
    update public.appointments set status = 'completed' where id = new.appointment_id and status = 'arrived';
  end if;
  return null;
end $$;
create trigger visits_complete_appointment after update of status on public.visits
  for each row execute function private.visit_completes_appointment();

create trigger appointments_updated_at before update on public.appointments
  for each row execute function private.set_updated_at();
create trigger visits_updated_at before update on public.visits
  for each row execute function private.set_updated_at();

create trigger audit_appointment_types after insert or update or delete on public.appointment_types
  for each row execute function private.audit_row();
create trigger audit_staff_schedules after insert or update or delete on public.staff_schedules
  for each row execute function private.audit_row();
create trigger audit_appointments after insert or update or delete on public.appointments
  for each row execute function private.audit_row();
create trigger audit_visits after insert or update or delete on public.visits
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- Check-in: appointment → visit, atomically.
-- -----------------------------------------------------------------------------
create or replace function public.check_in_appointment(p_appointment_id uuid, p_pet_id uuid default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  a public.appointments;
  v_id uuid;
begin
  select * into a from public.appointments where id = p_appointment_id for update;
  if not found then raise exception 'appointment not found'; end if;
  if a.status not in ('booked', 'confirmed') then
    raise exception 'this appointment is already %', a.status;
  end if;
  if coalesce(p_pet_id, a.pet_id) is null then
    raise exception 'choose which pet has arrived';
  end if;

  insert into public.visits (pet_id, customer_id, appointment_id, doctor_id, visit_type_id, reason, priority)
  values (coalesce(p_pet_id, a.pet_id), a.customer_id, a.id, a.doctor_id, a.appointment_type_id, a.reason,
          case when a.is_urgent then 'urgent'::public.visit_priority else 'normal' end)
  returning id into v_id;

  update public.appointments
     set status = 'arrived', visit_id = v_id, pet_id = coalesce(p_pet_id, a.pet_id)
   where id = a.id;
  return v_id;
end $$;
revoke execute on function public.check_in_appointment(uuid, uuid) from public, anon;
grant execute on function public.check_in_appointment(uuid, uuid) to authenticated;

-- Overlap warnings (spec §8) — a warning, not a hard block: vets double-book on purpose.
create or replace function public.appointment_conflicts(p_doctor uuid, p_starts timestamptz, p_ends timestamptz,
  p_exclude uuid default null)
returns table (id uuid, starts_at timestamptz, ends_at timestamptz, customer_name text, pet_name text)
language sql stable security invoker set search_path = '' as $$
  select a.id, a.starts_at, a.ends_at, c.full_name, p.name
  from public.appointments a
  join public.customers c on c.id = a.customer_id
  left join public.pets p on p.id = a.pet_id
  where p_doctor is not null and a.doctor_id = p_doctor
    and a.status in ('booked', 'confirmed', 'arrived')
    and (p_exclude is null or a.id <> p_exclude)
    and a.starts_at < p_ends and a.ends_at > p_starts
  order by a.starts_at;
$$;
revoke execute on function public.appointment_conflicts(uuid, timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.appointment_conflicts(uuid, timestamptz, timestamptz, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.appointment_types    enable row level security;
alter table public.staff_schedules      enable row level security;
alter table public.appointments         enable row level security;
alter table public.visits               enable row level security;
alter table public.visit_status_events  enable row level security;
alter table public.visit_token_counters enable row level security;  -- no policies: trigger-only

create policy appointment_types_select on public.appointment_types for select to authenticated
  using ((select private.is_active_staff()));
create policy appointment_types_manage on public.appointment_types for all to authenticated
  using ((select private.has_permission('settings.manage')))
  with check ((select private.has_permission('settings.manage')));

create policy staff_schedules_select on public.staff_schedules for select to authenticated
  using ((select private.is_active_staff()));
create policy staff_schedules_manage on public.staff_schedules for all to authenticated
  using ((select private.has_permission('staff.manage')))
  with check ((select private.has_permission('staff.manage')));

create policy appointments_select on public.appointments for select to authenticated
  using ((select private.has_permission('appointments.view')));
create policy appointments_insert on public.appointments for insert to authenticated
  with check ((select private.has_permission('appointments.manage')));
create policy appointments_update on public.appointments for update to authenticated
  using ((select private.has_permission('appointments.manage')) or (select private.has_permission('queue.manage')))
  with check ((select private.has_permission('appointments.manage')) or (select private.has_permission('queue.manage')));

-- Visits: reception runs the queue; doctors/interns see it and move their patients.
create policy visits_select on public.visits for select to authenticated
  using ((select private.has_permission('queue.manage')) or (select private.has_permission('appointments.view'))
         or (select private.has_permission('clinical.view')));
create policy visits_insert on public.visits for insert to authenticated
  with check ((select private.has_permission('queue.manage')));
create policy visits_update on public.visits for update to authenticated
  using ((select private.has_permission('queue.manage')) or (select private.has_permission('clinical.create')))
  with check ((select private.has_permission('queue.manage')) or (select private.has_permission('clinical.create')));

create policy visit_status_events_select on public.visit_status_events for select to authenticated
  using ((select private.has_permission('queue.manage')) or (select private.has_permission('reports.view')));

-- Live queue board updates over Supabase Realtime (RLS still applies to subscribers).
alter publication supabase_realtime add table public.visits, public.appointments;
