-- =============================================================================
-- Phase 2 — Vaccinations & multi-stage protocols (spec §11, §47, §52)
--
-- Safety:
--  * Protocols are seeded as DRAFTS (is_approved = false) and are never used for suggestions
--    until a senior doctor approves them. Editing an approved protocol un-approves it.
--  * The next due date is entered/confirmed by the doctor on each vaccination; the app may
--    pre-fill it from an approved protocol but never sets it silently.
--  * An expired batch can't be recorded as administered.
-- =============================================================================

create table public.vaccines (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  protects_against text,
  species_ids     uuid[] not null default '{}',     -- which species it's for (empty = any)
  default_manufacturer text,
  default_route   text,                              -- SC, IM, intranasal, oral…
  default_dose    text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

create table public.vaccination_protocols (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null unique,
  species_id             uuid references public.species (id),
  description            text,
  booster_interval_days  int check (booster_interval_days between 1 and 3650),  -- repeat after the last step
  is_approved            boolean not null default false,
  approved_by            uuid references public.staff (id),
  approved_at            timestamptz,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check (not is_approved or (approved_by is not null and approved_at is not null))
);

create table public.vaccination_protocol_steps (
  id                  uuid primary key default gen_random_uuid(),
  protocol_id         uuid not null references public.vaccination_protocols (id) on delete cascade,
  step_no             int not null check (step_no >= 1),
  label               text not null,                   -- "Dose 1", "Dose 2", "Booster"
  vaccine_id          uuid not null references public.vaccines (id),
  min_age_weeks       int check (min_age_weeks between 0 and 520),
  days_after_previous int check (days_after_previous between 1 and 3650),   -- null for the first step
  unique (protocol_id, step_no)
);

create table public.vaccinations (
  id               uuid primary key default gen_random_uuid(),
  pet_id           uuid not null references public.pets (id),
  visit_id         uuid references public.visits (id),
  vaccine_id       uuid not null references public.vaccines (id),
  vaccine_name     text not null,                    -- snapshot for the certificate
  manufacturer     text,
  batch_no         text,
  expiry_date      date,
  administered_at  timestamptz not null default now(),
  dose             text,
  route            text,
  site             text,
  administered_by  uuid references public.staff (id) default auth.uid(),
  protocol_id      uuid references public.vaccination_protocols (id),
  protocol_step    int,
  next_due_date    date,
  next_due_label   text,
  adverse_reaction text,
  notes            text,
  voided_at        timestamptz,
  void_reason      text,
  created_by       uuid references public.staff (id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (expiry_date is null or expiry_date >= (administered_at at time zone 'Asia/Karachi')::date),
  check (next_due_date is null or next_due_date > (administered_at at time zone 'Asia/Karachi')::date),
  check ((voided_at is null) = (void_reason is null))
);
create index vaccinations_pet_idx on public.vaccinations (pet_id, administered_at desc);
create index vaccinations_batch_idx on public.vaccinations (batch_no);

alter table public.due_items
  add constraint due_items_vaccine_fk foreign key (vaccine_id) references public.vaccines (id),
  add constraint due_items_protocol_fk foreign key (protocol_id) references public.vaccination_protocols (id);

-- Recording a dose closes whatever was due for that vaccine and opens the next one (if the doctor set a date).
create or replace function private.vaccination_due_items()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.due_items
     set status = 'done', outcome = 'administered', completed_at = now(), completed_by = new.administered_by
   where pet_id = new.pet_id and kind = 'vaccination' and status = 'pending'
     and (vaccine_id = new.vaccine_id or (new.protocol_id is not null and protocol_id = new.protocol_id));

  if new.next_due_date is not null then
    insert into public.due_items (pet_id, kind, title, due_on, vaccine_id, protocol_id, protocol_step,
                                  source_table, source_id, assigned_to)
    values (new.pet_id, 'vaccination',
            coalesce(nullif(trim(new.next_due_label), ''), new.vaccine_name || ' — next dose'),
            new.next_due_date, new.vaccine_id, new.protocol_id,
            case when new.protocol_step is not null then new.protocol_step + 1 end,
            'vaccinations', new.id, new.administered_by);
  end if;
  return null;
end $$;
create trigger vaccinations_due after insert on public.vaccinations
  for each row execute function private.vaccination_due_items();

-- Voiding a record (entered by mistake) re-opens nothing automatically, but cancels the due item it created.
create or replace function private.vaccination_voided()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.voided_at is not null and old.voided_at is null then
    update public.due_items set status = 'cancelled', outcome = 'record voided', outcome_reason = new.void_reason
     where source_table = 'vaccinations' and source_id = new.id and status = 'pending';
  end if;
  return null;
end $$;
create trigger vaccinations_voided after update of voided_at on public.vaccinations
  for each row execute function private.vaccination_voided();

-- Changing a protocol's steps un-approves it, so a doctor must look again.
create or replace function private.protocol_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.vaccination_protocols
     set is_approved = false, approved_by = null, approved_at = null
   where id = coalesce(new.protocol_id, old.protocol_id) and is_approved;
  return null;
end $$;
create trigger protocol_steps_changed after insert or update or delete on public.vaccination_protocol_steps
  for each row execute function private.protocol_changed();

create or replace function private.protocol_self_changed()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.is_approved and new.is_approved
     and (new.booster_interval_days is distinct from old.booster_interval_days
          or new.species_id is distinct from old.species_id) then
    new.is_approved := false; new.approved_by := null; new.approved_at := null;
  end if;
  -- Only approve_protocol() may set approval.
  if new.is_approved and not old.is_approved and current_setting('bdah.protocol_approve', true) is distinct from new.id::text then
    raise exception 'use approve_protocol() to approve' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger protocols_guard before update on public.vaccination_protocols
  for each row execute function private.protocol_self_changed();

create or replace function public.approve_protocol(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  -- Senior clinical sign-off: same permission as reopening finalized records.
  if not private.has_permission('clinical.reopen') then
    raise exception 'only a senior doctor can approve vaccination protocols' using errcode = '42501';
  end if;
  if not exists (select 1 from public.vaccination_protocol_steps where protocol_id = p_id) then
    raise exception 'add at least one step before approving';
  end if;
  perform set_config('bdah.protocol_approve', p_id::text, true);
  update public.vaccination_protocols
     set is_approved = true, approved_by = (select auth.uid()), approved_at = now()
   where id = p_id;
  perform set_config('bdah.protocol_approve', '', true);
end $$;
revoke execute on function public.approve_protocol(uuid) from public, anon;
grant execute on function public.approve_protocol(uuid) to authenticated;

create trigger vaccinations_updated_at before update on public.vaccinations
  for each row execute function private.set_updated_at();
create trigger protocols_updated_at before update on public.vaccination_protocols
  for each row execute function private.set_updated_at();

create trigger audit_vaccines after insert or update or delete on public.vaccines
  for each row execute function private.audit_row();
create trigger audit_vaccination_protocols after insert or update or delete on public.vaccination_protocols
  for each row execute function private.audit_row();
create trigger audit_vaccination_protocol_steps after insert or update or delete on public.vaccination_protocol_steps
  for each row execute function private.audit_row();
create trigger audit_vaccinations after insert or update or delete on public.vaccinations
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.vaccines                    enable row level security;
alter table public.vaccination_protocols       enable row level security;
alter table public.vaccination_protocol_steps  enable row level security;
alter table public.vaccinations                enable row level security;

create policy vaccines_select on public.vaccines for select to authenticated
  using ((select private.is_active_staff()));
create policy vaccines_manage on public.vaccines for all to authenticated
  using ((select private.has_permission('settings.manage')) or (select private.has_permission('clinical.reopen')))
  with check ((select private.has_permission('settings.manage')) or (select private.has_permission('clinical.reopen')));

create policy protocols_select on public.vaccination_protocols for select to authenticated
  using ((select private.is_active_staff()));
create policy protocols_manage on public.vaccination_protocols for all to authenticated
  using ((select private.has_permission('clinical.reopen')))
  with check ((select private.has_permission('clinical.reopen')));
create policy protocol_steps_select on public.vaccination_protocol_steps for select to authenticated
  using ((select private.is_active_staff()));
create policy protocol_steps_manage on public.vaccination_protocol_steps for all to authenticated
  using ((select private.has_permission('clinical.reopen')))
  with check ((select private.has_permission('clinical.reopen')));

-- Vaccination history is shown on certificates and to reception for reminders.
create policy vaccinations_select on public.vaccinations for select to authenticated
  using ((select private.has_permission('clinical.view')) or (select private.has_permission('crm.view')));
create policy vaccinations_insert on public.vaccinations for insert to authenticated
  with check ((select private.has_permission('vaccinations.manage')) and voided_at is null);
create policy vaccinations_update on public.vaccinations for update to authenticated
  using ((select private.has_permission('vaccinations.manage')))
  with check ((select private.has_permission('vaccinations.manage')));
-- No delete: mistakes are voided with a reason.

-- -----------------------------------------------------------------------------
-- Seed: vaccine catalogue (generic names; brands go in "manufacturer") and DRAFT protocols.
-- -----------------------------------------------------------------------------
insert into public.vaccines (name, protects_against, species_ids, default_route)
select v.name, v.against, coalesce(array_agg(s.id) filter (where s.id is not null), '{}'), v.route
from (values
  ('DHPPi', 'Distemper, Hepatitis, Parvovirus, Parainfluenza', array['Dog'], 'SC'),
  ('DHPPi + L', 'DHPPi with Leptospirosis', array['Dog'], 'SC'),
  ('Parvo (puppy)', 'Canine parvovirus', array['Dog'], 'SC'),
  ('Leptospirosis', 'Leptospirosis', array['Dog'], 'SC'),
  ('Kennel cough', 'Bordetella / canine parainfluenza', array['Dog'], 'Intranasal'),
  ('Rabies', 'Rabies', array['Dog', 'Cat'], 'SC'),
  ('FVRCP', 'Feline rhinotracheitis, calicivirus, panleukopenia', array['Cat'], 'SC'),
  ('FeLV', 'Feline leukaemia virus', array['Cat'], 'SC'),
  ('Newcastle disease (ND)', 'Newcastle disease', array['Bird'], 'Oral / eye drop'),
  ('FMD', 'Foot and mouth disease', array['Cow', 'Buffalo', 'Goat', 'Sheep'], 'SC'),
  ('HS', 'Haemorrhagic septicaemia', array['Cow', 'Buffalo'], 'SC'),
  ('PPR', 'Peste des petits ruminants', array['Goat', 'Sheep'], 'SC'),
  ('Enterotoxaemia', 'Clostridial enterotoxaemia', array['Goat', 'Sheep'], 'SC'),
  ('Black quarter', 'Blackleg (Clostridium chauvoei)', array['Cow', 'Buffalo'], 'SC')
) as v(name, against, species, route)
left join public.species s on s.name = any (v.species)
group by v.name, v.against, v.route;

insert into public.vaccination_protocols (name, species_id, description, booster_interval_days)
select p.name, s.id, p.descr, p.booster
from (values
  ('Puppy core (DRAFT)', 'Dog', 'EXAMPLE ONLY — intervals must be reviewed and approved by the clinic before use.', 365),
  ('Kitten core (DRAFT)', 'Cat', 'EXAMPLE ONLY — intervals must be reviewed and approved by the clinic before use.', 365),
  ('Adult dog rabies (DRAFT)', 'Dog', 'EXAMPLE ONLY — review before use.', 365)
) as p(name, species, descr, booster)
join public.species s on s.name = p.species;

insert into public.vaccination_protocol_steps (protocol_id, step_no, label, vaccine_id, min_age_weeks, days_after_previous)
select pr.id, st.step_no, st.label, v.id, st.min_age, st.after_days
from (values
  ('Puppy core (DRAFT)', 1, 'Dose 1', 'DHPPi', 6, null),
  ('Puppy core (DRAFT)', 2, 'Dose 2', 'DHPPi + L', null, 21),
  ('Puppy core (DRAFT)', 3, 'Dose 3', 'DHPPi + L', null, 21),
  ('Puppy core (DRAFT)', 4, 'Rabies', 'Rabies', 12, null),
  ('Kitten core (DRAFT)', 1, 'Dose 1', 'FVRCP', 8, null),
  ('Kitten core (DRAFT)', 2, 'Dose 2', 'FVRCP', null, 21),
  ('Kitten core (DRAFT)', 3, 'Rabies', 'Rabies', 12, null),
  ('Adult dog rabies (DRAFT)', 1, 'Rabies', 'Rabies', 12, null)
) as st(protocol, step_no, label, vaccine, min_age, after_days)
join public.vaccination_protocols pr on pr.name = st.protocol
join public.vaccines v on v.name = st.vaccine;

-- Seeding steps fired protocol_changed(); make sure drafts stay unapproved (they already are).
