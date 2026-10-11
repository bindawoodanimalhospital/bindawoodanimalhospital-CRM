-- =============================================================================
-- Phase 3 — In-patient / observation / hospitalisation (spec §15)
--
-- * One patient per kennel, one open admission per pet (enforced by unique indexes).
-- * Treatment orders are written by a doctor (inpatient.manage). Nurses/interns (inpatient.care)
--   record each dose as given / skipped / refused — skipping needs a reason.
-- * Progress notes and the treatment log are append-only: mistakes are corrected with a new entry.
-- * Discharge needs a written summary for the owner; afterwards the admission is closed.
-- =============================================================================

create type public.admission_status as enum ('admitted', 'discharged', 'cancelled');
create type public.admission_outcome as enum ('discharged_home', 'transferred', 'deceased', 'left_against_advice');

create table public.kennels (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  ward          text not null default 'General',
  is_isolation  boolean not null default false,
  is_active     boolean not null default true,
  sort_order    int not null default 100
);

insert into public.kennels (name, ward, is_isolation, sort_order) values
  ('Kennel 1', 'Dogs', false, 1), ('Kennel 2', 'Dogs', false, 2), ('Kennel 3', 'Dogs', false, 3),
  ('Kennel 4', 'Dogs', false, 4), ('Cat cage 1', 'Cats', false, 11), ('Cat cage 2', 'Cats', false, 12),
  ('Cat cage 3', 'Cats', false, 13), ('ICU 1', 'ICU', false, 21), ('Isolation 1', 'Isolation', true, 31);

create sequence public.admission_code_seq start 1;

create table public.admissions (
  id                      uuid primary key default gen_random_uuid(),
  code                    text not null unique default 'IP-' || lpad(nextval('public.admission_code_seq')::text, 6, '0'),
  pet_id                  uuid not null references public.pets (id),
  customer_id             uuid not null references public.customers (id),
  visit_id                uuid references public.visits (id),
  surgery_id              uuid references public.surgeries (id),
  kennel_id               uuid references public.kennels (id),
  attending_doctor_id     uuid references public.staff (id),
  reason                  text not null check (length(trim(reason)) > 0),
  status                  public.admission_status not null default 'admitted',
  admitted_at             timestamptz not null default now(),
  admitted_by             uuid references public.staff (id) default auth.uid(),
  expected_discharge_on   date,
  feeding_plan            text,
  care_notes              text,                     -- handling, restrictions ("no food", "cone on")
  discharge_summary       text,
  discharge_instructions  text,
  outcome                 public.admission_outcome,
  discharged_at           timestamptz,
  discharged_by           uuid references public.staff (id),
  follow_up_date          date,
  cancel_reason           text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check ((status = 'cancelled') = (cancel_reason is not null)),
  check (status <> 'discharged' or (outcome is not null and discharged_at is not null and coalesce(trim(discharge_summary), '') <> ''))
);
create unique index admissions_one_per_kennel on public.admissions (kennel_id) where status = 'admitted' and kennel_id is not null;
create unique index admissions_one_per_pet on public.admissions (pet_id) where status = 'admitted';
create index admissions_pet_idx on public.admissions (pet_id, admitted_at desc);

-- Treatment plan: what should be given, how often.
create table public.admission_orders (
  id              uuid primary key default gen_random_uuid(),
  admission_id    uuid not null references public.admissions (id) on delete cascade,
  kind            text not null check (kind in ('medication', 'fluids', 'feeding', 'procedure', 'monitoring')),
  description     text not null check (length(trim(description)) > 0),   -- "Ceftriaxone", "Wound cleaning"
  dose            text,                                                   -- written by the doctor
  route           text,
  every_hours     numeric(5,2) check (every_hours > 0 and every_hours <= 168),  -- null = once / as needed
  starts_at       timestamptz not null default now(),
  ends_at         timestamptz,
  instructions    text,
  ordered_by      uuid references public.staff (id) default auth.uid(),
  status          text not null default 'active' check (status in ('active', 'stopped')),
  stopped_at      timestamptz,
  stopped_by      uuid references public.staff (id),
  stop_reason     text,
  created_at      timestamptz not null default now(),
  check (ends_at is null or ends_at > starts_at),
  check ((status = 'stopped') = (stop_reason is not null))
);
create index admission_orders_idx on public.admission_orders (admission_id, status);

-- Treatment log ("MAR"): one row per dose actually given / skipped.
create table public.admission_administrations (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references public.admission_orders (id) on delete cascade,
  admission_id  uuid not null references public.admissions (id) on delete cascade,
  due_at        timestamptz,                 -- the scheduled slot this satisfies (null for "as needed")
  result        text not null check (result in ('given', 'skipped', 'refused')),
  given_at      timestamptz not null default now(),
  given_by      uuid references public.staff (id) default auth.uid(),
  note          text,
  check (result = 'given' or coalesce(trim(note), '') <> '')          -- skipping/refusal needs a reason
);
create index admission_administrations_idx on public.admission_administrations (admission_id, given_at desc);
create unique index admission_administrations_slot on public.admission_administrations (order_id, due_at) where due_at is not null;

-- Daily progress / vitals / feeding / owner-communication notes.
create table public.admission_notes (
  id            uuid primary key default gen_random_uuid(),
  admission_id  uuid not null references public.admissions (id) on delete cascade,
  kind          text not null check (kind in ('progress', 'vitals', 'feeding', 'owner_update', 'procedure')),
  note          text,
  vitals        jsonb not null default '{}'::jsonb,  -- {temp, hr, rr, weight, appetite, urine, stool, pain}
  created_by    uuid references public.staff (id) default auth.uid(),
  created_at    timestamptz not null default now(),
  check (coalesce(trim(note), '') <> '' or vitals <> '{}'::jsonb)
);
create index admission_notes_idx on public.admission_notes (admission_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Guards
-- -----------------------------------------------------------------------------
create or replace function private.guard_admission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'admissions cannot be deleted — cancel with a reason' using errcode = '42501'; end if;
  if old.status <> 'admitted' then
    raise exception 'this admission is closed' using errcode = '42501';
  end if;
  if new.status = 'discharged' then
    new.discharged_at := coalesce(new.discharged_at, now());
    new.discharged_by := (select auth.uid());
  end if;
  return new;
end $$;
create trigger admissions_guard before update or delete on public.admissions
  for each row execute function private.guard_admission();

-- Discharge: stop open orders; follow-up due item.
create or replace function private.admission_discharged()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'admitted' and old.status = 'admitted' then
    update public.admission_orders set status = 'stopped', stopped_at = now(), stopped_by = (select auth.uid()),
           stop_reason = 'Patient ' || new.status::text
     where admission_id = new.id and status = 'active';
    if new.follow_up_date is not null and new.status = 'discharged' then
      insert into public.due_items (pet_id, kind, title, due_on, source_table, source_id, assigned_to)
      values (new.pet_id, 'follow_up', 'Check after hospital stay', new.follow_up_date, 'admissions', new.id, new.attending_doctor_id);
    end if;
    if new.outcome = 'deceased' then
      update public.pets set status = 'deceased' where id = new.pet_id and status = 'active';
    end if;
  end if;
  return null;
end $$;
create trigger admissions_discharged after update of status on public.admissions
  for each row execute function private.admission_discharged();

-- Orders, doses and notes can't be added to a closed admission; orders may only be stopped.
create or replace function private.guard_admission_child()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  aid uuid := coalesce(new.admission_id, old.admission_id);
  closed boolean := exists (select 1 from public.admissions where id = aid and status <> 'admitted');
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
begin
  if tg_table_name = 'admission_orders' then
    if tg_op = 'INSERT' then
      if closed then raise exception 'this admission is closed' using errcode = '42501'; end if;
      return new;
    end if;
    -- UPDATE: the only allowed change is stopping an active order (also allowed after discharge).
    if (n - 'status' - 'stopped_at' - 'stopped_by' - 'stop_reason') is distinct from (o - 'status' - 'stopped_at' - 'stopped_by' - 'stop_reason')
       or n ->> 'status' <> 'stopped' then
      raise exception 'treatment orders can''t be edited — stop it and write a new one' using errcode = '42501';
    end if;
    if o ->> 'status' = 'stopped' then raise exception 'already stopped' using errcode = '42501'; end if;
    new.stopped_at := now();
    new.stopped_by := coalesce((select auth.uid()), new.stopped_by);
    return new;
  end if;

  if closed then raise exception 'this admission is closed' using errcode = '42501'; end if;

  if tg_table_name = 'admission_administrations' then
    if not exists (select 1 from public.admission_orders ao
                   where ao.id = (n ->> 'order_id')::uuid and ao.admission_id = aid and ao.status = 'active') then
      raise exception 'this treatment order is not active';
    end if;
  end if;
  return new;
end $$;
create trigger admission_orders_guard before insert or update on public.admission_orders
  for each row execute function private.guard_admission_child();
create trigger admission_administrations_guard before insert on public.admission_administrations
  for each row execute function private.guard_admission_child();
create trigger admission_notes_guard before insert on public.admission_notes
  for each row execute function private.guard_admission_child();

create trigger admissions_updated_at before update on public.admissions
  for each row execute function private.set_updated_at();

create trigger audit_kennels after insert or update or delete on public.kennels
  for each row execute function private.audit_row();
create trigger audit_admissions after insert or update or delete on public.admissions
  for each row execute function private.audit_row();
create trigger audit_admission_orders after insert or update or delete on public.admission_orders
  for each row execute function private.audit_row();
create trigger audit_admission_administrations after insert on public.admission_administrations
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.kennels                    enable row level security;
alter table public.admissions                 enable row level security;
alter table public.admission_orders           enable row level security;
alter table public.admission_administrations  enable row level security;
alter table public.admission_notes            enable row level security;

create policy kennels_select on public.kennels for select to authenticated using ((select private.is_active_staff()));
create policy kennels_manage on public.kennels for all to authenticated
  using ((select private.has_permission('settings.manage'))) with check ((select private.has_permission('settings.manage')));

create policy admissions_select on public.admissions for select to authenticated
  using ((select private.has_permission('clinical.view')) or (select private.has_permission('queue.manage')));
create policy admissions_insert on public.admissions for insert to authenticated
  with check ((select private.has_permission('inpatient.manage')) and status = 'admitted');
-- Doctors change the plan/discharge; carers may move the patient to another kennel (UI limits them to that).
create policy admissions_update on public.admissions for update to authenticated
  using ((select private.has_permission('inpatient.manage')) or (select private.has_permission('inpatient.care')))
  with check ((select private.has_permission('inpatient.manage')) or (select private.has_permission('inpatient.care')));

create or replace function private.guard_admission_carer()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Carers without inpatient.manage may only change the kennel.
  if not private.has_permission('inpatient.manage') and current_user = 'authenticated'
     and (to_jsonb(new) - 'kennel_id' - 'updated_at') is distinct from (to_jsonb(old) - 'kennel_id' - 'updated_at') then
    raise exception 'only a doctor can change the treatment plan or discharge' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger admissions_carer_guard before update on public.admissions
  for each row execute function private.guard_admission_carer();

create policy admission_orders_select on public.admission_orders for select to authenticated
  using ((select private.has_permission('clinical.view')));
create policy admission_orders_insert on public.admission_orders for insert to authenticated
  with check ((select private.has_permission('inpatient.manage')) and status = 'active');
create policy admission_orders_update on public.admission_orders for update to authenticated
  using ((select private.has_permission('inpatient.manage'))) with check ((select private.has_permission('inpatient.manage')));

create policy admission_administrations_select on public.admission_administrations for select to authenticated
  using ((select private.has_permission('clinical.view')));
create policy admission_administrations_insert on public.admission_administrations for insert to authenticated
  with check (((select private.has_permission('inpatient.care')) or (select private.has_permission('inpatient.manage')))
              and given_by = (select auth.uid()));

create policy admission_notes_select on public.admission_notes for select to authenticated
  using ((select private.has_permission('clinical.view')));
create policy admission_notes_insert on public.admission_notes for insert to authenticated
  with check (((select private.has_permission('inpatient.care')) or (select private.has_permission('inpatient.manage')))
              and created_by = (select auth.uid()));

-- Ward board updates live.
alter publication supabase_realtime add table public.admissions, public.admission_administrations, public.surgeries;
