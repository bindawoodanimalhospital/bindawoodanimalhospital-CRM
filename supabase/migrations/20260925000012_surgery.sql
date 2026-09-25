-- =============================================================================
-- Phase 3 — Surgery (spec §14, §37)
-- Planned → Scheduled → Admitted → Pre-op → In surgery → Recovery → Discharged  (or Cancelled)
--
-- Safety gates enforced here, not only in the UI:
--  * Can't start surgery without a recorded owner consent AND a completed pre-op check —
--    except a life-saving EMERGENCY, which needs a written override reason (logged).
--  * Status moves only along allowed steps; timestamps are set by the database.
--  * After discharge the record is locked; a senior doctor can reopen with a reason (snapshot kept).
--  * Anaesthesia drugs/doses are free text written by the vet — nothing is calculated.
-- =============================================================================

create type public.surgery_status as enum
  ('planned', 'scheduled', 'admitted', 'pre_op', 'in_surgery', 'recovery', 'discharged', 'cancelled');
create type public.surgery_urgency as enum ('elective', 'urgent', 'emergency');
create type public.consent_method as enum ('signed_paper', 'signed_on_screen', 'verbal_phone');

-- New fine-grained permissions (spec §23: interns assist; reception collects consent).
insert into public.permissions (key, module, action, label, is_sensitive, sort_order) values
  ('surgery.assist',  'surgery',   'assist',  'Record anaesthesia monitoring & materials used', true, 441),
  ('surgery.consent', 'surgery',   'consent', 'Record owner consent for surgery', true, 442),
  ('inpatient.care',  'inpatient', 'care',    'Give ward treatments, feeding & progress notes', true, 451);

insert into public.role_permissions (role_id, permission_key)
select r.id, x.perm from public.roles r
join (values
  ('owner', 'surgery.assist'), ('owner', 'surgery.consent'), ('owner', 'inpatient.care'),
  ('senior_doctor', 'surgery.assist'), ('senior_doctor', 'surgery.consent'), ('senior_doctor', 'inpatient.care'),
  ('junior_doctor', 'surgery.assist'), ('junior_doctor', 'surgery.consent'), ('junior_doctor', 'inpatient.care'),
  ('intern', 'surgery.assist'), ('intern', 'inpatient.care'),
  ('reception', 'surgery.consent')
) as x(role_key, perm) on x.role_key = r.key
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Procedure catalogue
-- -----------------------------------------------------------------------------
create table public.surgery_procedures (
  id               uuid primary key default gen_random_uuid(),
  name             text not null unique,
  category         text,
  default_minutes  int check (default_minutes between 5 and 1440),
  fasting_hours    int check (fasting_hours between 0 and 48),   -- guidance printed on instructions; clinic sets it
  is_active        boolean not null default true,
  sort_order       int not null default 100
);

insert into public.surgery_procedures (name, category, default_minutes, sort_order) values
  ('Spay (ovariohysterectomy)', 'Soft tissue', 60, 1),
  ('Castration', 'Soft tissue', 30, 2),
  ('Caesarean section', 'Soft tissue', 90, 3),
  ('Wound repair / suturing', 'Soft tissue', 30, 4),
  ('Lump / tumour removal', 'Soft tissue', 60, 5),
  ('Abscess drainage', 'Soft tissue', 20, 6),
  ('Hernia repair', 'Soft tissue', 60, 7),
  ('Foreign body removal (GI)', 'Soft tissue', 90, 8),
  ('Pyometra surgery', 'Soft tissue', 90, 9),
  ('Aural haematoma repair', 'Soft tissue', 40, 10),
  ('Cherry eye repair', 'Ophthalmic', 30, 11),
  ('Eye enucleation', 'Ophthalmic', 60, 12),
  ('Dental scaling & extraction', 'Dental', 60, 13),
  ('Fracture repair', 'Orthopaedic', 120, 14),
  ('Amputation', 'Orthopaedic', 90, 15),
  ('Other procedure', 'Other', 60, 99);

-- -----------------------------------------------------------------------------
-- Surgeries
-- -----------------------------------------------------------------------------
create sequence public.surgery_code_seq start 1;

create table public.surgeries (
  id                     uuid primary key default gen_random_uuid(),
  code                   text not null unique default 'SX-' || lpad(nextval('public.surgery_code_seq')::text, 6, '0'),
  pet_id                 uuid not null references public.pets (id),
  customer_id            uuid not null references public.customers (id),
  visit_id               uuid references public.visits (id),              -- where it was recommended
  consultation_id        uuid references public.consultations (id),
  procedure_id           uuid references public.surgery_procedures (id),
  procedure_name         text not null check (length(trim(procedure_name)) > 0),
  indication             text,                                             -- why
  urgency                public.surgery_urgency not null default 'elective',
  status                 public.surgery_status not null default 'planned',
  scheduled_at           timestamptz,
  surgeon_id             uuid references public.staff (id),
  estimate_amount        numeric(12,2) check (estimate_amount >= 0),       -- PKR, told to owner before consent
  estimate_notes         text,
  pre_op_instructions    text,                                             -- e.g. fasting, given to owner
  -- Pre-op check (done on the day)
  preop_weight_kg        numeric(7,3) check (preop_weight_kg > 0 and preop_weight_kg < 2000),
  preop_temperature_c    numeric(4,1) check (preop_temperature_c between 25 and 45),
  preop_heart_rate       int check (preop_heart_rate between 10 and 400),
  preop_resp_rate        int check (preop_resp_rate between 2 and 200),
  asa_class              smallint check (asa_class between 1 and 5),       -- anaesthetic risk grade
  fasting_confirmed      boolean,
  preop_checklist        jsonb not null default '{}'::jsonb,               -- { "IV line placed": true, ... }
  preop_notes            text,
  preop_checked_at       timestamptz,
  preop_checked_by       uuid references public.staff (id),
  -- Anaesthesia & procedure (written by the vet; never calculated)
  anaesthesia_protocol   text,
  anaesthesia_start      timestamptz,
  anaesthesia_end        timestamptz,
  procedure_start        timestamptz,
  procedure_end          timestamptz,
  intra_op_notes         text,
  complications          text,
  -- Recovery & discharge
  recovery_notes         text,
  discharge_instructions text,
  discharged_at          timestamptz,
  discharged_by          uuid references public.staff (id),
  follow_up_date         date,
  -- Emergency without consent / pre-op check
  emergency_override_reason text,
  emergency_override_by  uuid references public.staff (id),
  cancel_reason          text,
  reopened_reason        text,
  created_by             uuid references public.staff (id) default auth.uid(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  check ((status = 'cancelled') = (cancel_reason is not null)),
  check (procedure_end is null or procedure_start is null or procedure_end >= procedure_start)
);
create index surgeries_pet_idx on public.surgeries (pet_id, created_at desc);
create index surgeries_schedule_idx on public.surgeries (scheduled_at) where status not in ('discharged', 'cancelled');
create index surgeries_active_idx on public.surgeries (status) where status not in ('discharged', 'cancelled');

create table public.surgery_team (
  surgery_id uuid not null references public.surgeries (id) on delete cascade,
  staff_id   uuid not null references public.staff (id),
  role       text not null check (role in ('surgeon', 'assistant', 'anaesthesia', 'nurse')),
  primary key (surgery_id, staff_id, role)
);

create table public.surgery_consents (
  id                     uuid primary key default gen_random_uuid(),
  surgery_id             uuid not null references public.surgeries (id) on delete cascade,
  signed_by_name         text not null check (length(trim(signed_by_name)) > 1),
  relationship           text,                          -- owner, son, driver…
  signer_phone           text,
  method                 public.consent_method not null,
  consent_text           text not null,                 -- exact text agreed to (snapshot)
  risks_explained        boolean not null,
  estimate_explained     boolean not null,
  estimate_amount        numeric(12,2),
  witnessed_by           uuid references public.staff (id) default auth.uid(),
  document_id            uuid references public.documents (id),   -- scanned signed form / on-screen signature image
  signed_at              timestamptz not null default now(),
  revoked_at             timestamptz,
  revoked_reason         text,
  check (risks_explained and estimate_explained),        -- both must be explained to count as consent
  check ((revoked_at is null) = (revoked_reason is null))
);
create index surgery_consents_idx on public.surgery_consents (surgery_id);

-- Everything that happens, in order: status changes, anaesthesia monitoring, drugs, complications, notes.
create table public.surgery_events (
  id          bigint generated always as identity primary key,
  surgery_id  uuid not null references public.surgeries (id) on delete cascade,
  kind        text not null check (kind in ('status', 'monitoring', 'drug', 'complication', 'note', 'override')),
  at          timestamptz not null default now(),
  data        jsonb not null default '{}'::jsonb,       -- monitoring: {hr, rr, spo2, temp, bp, depth}; drug: {name, dose, route}
  note        text,
  recorded_by uuid default auth.uid()
);
create index surgery_events_idx on public.surgery_events (surgery_id, at);

-- Materials used (for cost & stock analysis; linked to inventory in Phase 4).
create table public.surgery_consumables (
  id           uuid primary key default gen_random_uuid(),
  surgery_id   uuid not null references public.surgeries (id) on delete cascade,
  item_name    text not null check (length(trim(item_name)) > 0),
  quantity     numeric(10,2) not null check (quantity > 0),
  unit         text,
  batch_no     text,
  product_id   uuid,                                    -- Phase 4 FK to products
  notes        text,
  recorded_by  uuid references public.staff (id) default auth.uid(),
  created_at   timestamptz not null default now()
);
create index surgery_consumables_idx on public.surgery_consumables (surgery_id);

create table public.surgery_revisions (
  id          bigint generated always as identity primary key,
  surgery_id  uuid not null references public.surgeries (id) on delete cascade,
  snapshot    jsonb not null,
  reason      text not null,
  reopened_by uuid,
  reopened_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Guards
-- -----------------------------------------------------------------------------
create or replace function private.has_valid_consent(p_surgery uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.surgery_consents where surgery_id = p_surgery and revoked_at is null);
$$;

create or replace function private.guard_surgery()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  allowed jsonb := '{
    "planned":    ["scheduled","admitted","pre_op","cancelled"],
    "scheduled":  ["planned","admitted","pre_op","cancelled"],
    "admitted":   ["pre_op","cancelled"],
    "pre_op":     ["scheduled","in_surgery","cancelled"],
    "in_surgery": ["recovery"],
    "recovery":   ["in_surgery","discharged"],
    "discharged": [],
    "cancelled":  []
  }';
  unlocked boolean := current_setting('bdah.surgery_unlock', true) is not distinct from old.id::text;
begin
  if tg_op = 'DELETE' then
    raise exception 'surgery records cannot be deleted — cancel with a reason' using errcode = '42501';
  end if;

  if old.status in ('discharged', 'cancelled') and not unlocked then
    raise exception 'this surgery record is closed — a senior doctor can reopen it with a reason' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and not unlocked then
    if not (allowed -> old.status::text) ? new.status::text then
      raise exception 'cannot move a surgery from % to %', old.status, new.status;
    end if;

    -- Gate: starting surgery.
    if new.status = 'in_surgery' and old.status = 'pre_op' then
      if not private.has_valid_consent(new.id) or new.preop_checked_at is null then
        if new.urgency <> 'emergency' or coalesce(trim(new.emergency_override_reason), '') = '' then
          raise exception 'before surgery: record the owner''s consent and complete the pre-op check (emergencies need an override reason)';
        end if;
        new.emergency_override_by := (select auth.uid());
        insert into public.surgery_events (surgery_id, kind, note, data)
        values (new.id, 'override', new.emergency_override_reason,
                jsonb_build_object('consent', private.has_valid_consent(new.id), 'preop_checked', new.preop_checked_at is not null));
      end if;
      new.procedure_start := coalesce(new.procedure_start, now());
    end if;
    if new.status = 'recovery' and old.status = 'in_surgery' then
      new.procedure_end := coalesce(new.procedure_end, now());
    end if;
    if new.status = 'discharged' then
      if coalesce(trim(new.discharge_instructions), '') = '' then
        raise exception 'write discharge instructions for the owner before discharging';
      end if;
      new.discharged_at := now(); new.discharged_by := (select auth.uid());
    end if;

    insert into public.surgery_events (surgery_id, kind, data)
    values (new.id, 'status', jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  -- Pre-op check stamp.
  if new.preop_checked_at is not null and old.preop_checked_at is null then
    new.preop_checked_at := now(); new.preop_checked_by := (select auth.uid());
  end if;
  return new;
end $$;
create trigger surgeries_guard before update or delete on public.surgeries
  for each row execute function private.guard_surgery();

create or replace function private.surgery_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.surgery_events (surgery_id, kind, data) values (new.id, 'status', jsonb_build_object('to', new.status));
  return null;
end $$;
create trigger surgeries_created after insert on public.surgeries
  for each row execute function private.surgery_created();

-- Discharge → follow-up due item + weight onto the chart.
create or replace function private.surgery_discharged()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'discharged' and old.status <> 'discharged' then
    if new.follow_up_date is not null and not exists (
         select 1 from public.due_items where source_table = 'surgeries' and source_id = new.id and status = 'pending') then
      insert into public.due_items (pet_id, kind, title, due_on, source_table, source_id, assigned_to)
      values (new.pet_id, 'follow_up', 'Post-op check — ' || new.procedure_name, new.follow_up_date, 'surgeries', new.id, new.surgeon_id);
    end if;
    if new.preop_weight_kg is not null then
      insert into public.pet_weights (pet_id, weight_kg, visit_id, recorded_by, note)
      values (new.pet_id, new.preop_weight_kg, new.visit_id, (select auth.uid()), 'Pre-op weight');
    end if;
  end if;
  return null;
end $$;
create trigger surgeries_discharged after update of status on public.surgeries
  for each row execute function private.surgery_discharged();

-- Children of a closed surgery are read-only too.
create or replace function private.guard_surgery_child()
returns trigger language plpgsql security definer set search_path = '' as $$
declare sid uuid := coalesce(new.surgery_id, old.surgery_id);
begin
  if exists (select 1 from public.surgeries where id = sid and status in ('discharged', 'cancelled'))
     and current_setting('bdah.surgery_unlock', true) is distinct from sid::text then
    raise exception 'this surgery record is closed' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger surgery_consumables_guard before insert or update or delete on public.surgery_consumables
  for each row execute function private.guard_surgery_child();
create trigger surgery_team_guard before insert or update or delete on public.surgery_team
  for each row execute function private.guard_surgery_child();
create trigger surgery_events_guard before insert on public.surgery_events
  for each row when (new.kind not in ('status', 'override'))
  execute function private.guard_surgery_child();

create or replace function public.reopen_surgery(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.surgeries;
begin
  if not private.has_permission('clinical.reopen') then
    raise exception 'only a senior doctor can reopen a closed surgery record' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required'; end if;
  select * into s from public.surgeries where id = p_id for update;
  if not found or s.status <> 'discharged' then raise exception 'only discharged surgeries can be reopened'; end if;

  insert into public.surgery_revisions (surgery_id, snapshot, reason, reopened_by)
  values (p_id, to_jsonb(s), p_reason, (select auth.uid()));
  perform set_config('bdah.surgery_unlock', p_id::text, true);
  update public.surgeries set status = 'recovery', reopened_reason = p_reason, discharged_at = null, discharged_by = null
   where id = p_id;
  insert into public.surgery_events (surgery_id, kind, note, data)
  values (p_id, 'status', p_reason, jsonb_build_object('from', 'discharged', 'to', 'recovery', 'reopened', true));
  perform set_config('bdah.surgery_unlock', '', true);
end $$;
revoke execute on function public.reopen_surgery(uuid, text) from public, anon;
grant execute on function public.reopen_surgery(uuid, text) to authenticated;

create trigger surgeries_updated_at before update on public.surgeries
  for each row execute function private.set_updated_at();

create trigger audit_surgery_procedures after insert or update or delete on public.surgery_procedures
  for each row execute function private.audit_row();
create trigger audit_surgeries after insert or update or delete on public.surgeries
  for each row execute function private.audit_row();
create trigger audit_surgery_team after insert or update or delete on public.surgery_team
  for each row execute function private.audit_row();
create trigger audit_surgery_consents after insert or update or delete on public.surgery_consents
  for each row execute function private.audit_row();
create trigger audit_surgery_consumables after insert or update or delete on public.surgery_consumables
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.surgery_procedures  enable row level security;
alter table public.surgeries           enable row level security;
alter table public.surgery_team        enable row level security;
alter table public.surgery_consents    enable row level security;
alter table public.surgery_events      enable row level security;
alter table public.surgery_consumables enable row level security;
alter table public.surgery_revisions   enable row level security;

create policy surgery_procedures_select on public.surgery_procedures for select to authenticated
  using ((select private.is_active_staff()));
create policy surgery_procedures_manage on public.surgery_procedures for all to authenticated
  using ((select private.has_permission('settings.manage'))) with check ((select private.has_permission('settings.manage')));

-- Reception needs to see the surgery list (scheduling, consent, estimate) but not clinical notes;
-- the UI shows clinical sections only to clinical.view. Row access: surgery staff + consent takers.
create policy surgeries_select on public.surgeries for select to authenticated
  using ((select private.has_permission('clinical.view')) or (select private.has_permission('surgery.consent')));
create policy surgeries_insert on public.surgeries for insert to authenticated
  with check ((select private.has_permission('surgery.manage')) and status in ('planned', 'scheduled'));
create policy surgeries_update on public.surgeries for update to authenticated
  using ((select private.has_permission('surgery.manage')))
  with check ((select private.has_permission('surgery.manage')));

create policy surgery_team_select on public.surgery_team for select to authenticated
  using ((select private.has_permission('clinical.view')) or (select private.has_permission('surgery.consent')));
create policy surgery_team_write on public.surgery_team for all to authenticated
  using ((select private.has_permission('surgery.manage'))) with check ((select private.has_permission('surgery.manage')));

create policy surgery_consents_select on public.surgery_consents for select to authenticated
  using ((select private.has_permission('clinical.view')) or (select private.has_permission('surgery.consent')));
create policy surgery_consents_insert on public.surgery_consents for insert to authenticated
  with check ((select private.has_permission('surgery.consent')) and revoked_at is null);
-- Only revoking is allowed after signing (who/what was agreed never changes).
create policy surgery_consents_update on public.surgery_consents for update to authenticated
  using ((select private.has_permission('surgery.consent'))) with check ((select private.has_permission('surgery.consent')));

create or replace function private.guard_consent()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (to_jsonb(new) - 'revoked_at' - 'revoked_reason') is distinct from (to_jsonb(old) - 'revoked_at' - 'revoked_reason') then
    raise exception 'a signed consent cannot be changed — revoke it and record a new one' using errcode = '42501';
  end if;
  if old.revoked_at is not null then raise exception 'already revoked' using errcode = '42501'; end if;
  return new;
end $$;
create trigger surgery_consents_guard before update on public.surgery_consents
  for each row execute function private.guard_consent();

create policy surgery_events_select on public.surgery_events for select to authenticated
  using ((select private.has_permission('clinical.view')));
create policy surgery_events_insert on public.surgery_events for insert to authenticated
  with check (kind in ('monitoring', 'drug', 'complication', 'note')
    and ((select private.has_permission('surgery.manage')) or (select private.has_permission('surgery.assist'))));
-- Append-only: no update/delete policies. Corrections are new notes.

create policy surgery_consumables_select on public.surgery_consumables for select to authenticated
  using ((select private.has_permission('clinical.view')) or (select private.has_permission('inventory.view')));
create policy surgery_consumables_write on public.surgery_consumables for all to authenticated
  using ((select private.has_permission('surgery.manage')) or (select private.has_permission('surgery.assist')))
  with check ((select private.has_permission('surgery.manage')) or (select private.has_permission('surgery.assist')));

create policy surgery_revisions_select on public.surgery_revisions for select to authenticated
  using ((select private.has_permission('clinical.view')));

-- -----------------------------------------------------------------------------
-- Consent wording (DRAFT — to be reviewed by the clinic before use)
-- -----------------------------------------------------------------------------
insert into public.system_settings (key, value, description) values
('surgery.consent_text', jsonb_build_object(
  'status', 'draft',
  'en', 'I, the undersigned owner or authorised representative of the animal named above, consent to the procedure described and to the anaesthesia and medicines the veterinary surgeon considers necessary. The nature of the procedure, its risks (including anaesthetic risk, bleeding, infection and, rarely, death) and the estimated cost have been explained to me. I understand that no guarantee of outcome can be given, and that if unexpected findings arise the surgeon may carry out additional procedures in the animal''s best interest, contacting me where possible. I confirm the animal has been fasted as instructed, unless this is an emergency.',
  'ur', 'میں، مذکورہ جانور کا مالک یا مجاز نمائندہ، اوپر درج آپریشن اور اس کے لیے ڈاکٹر کی جانب سے ضروری سمجھی جانے والی بے ہوشی اور ادویات کی اجازت دیتا / دیتی ہوں۔ مجھے آپریشن کی نوعیت، اس کے خطرات (بشمول بے ہوشی کا خطرہ، خون بہنا، انفیکشن اور شاذ و نادر صورت میں موت) اور متوقع اخراجات سے آگاہ کر دیا گیا ہے۔ میں سمجھتا / سمجھتی ہوں کہ نتیجے کی کوئی ضمانت نہیں دی جا سکتی، اور اگر آپریشن کے دوران غیر متوقع صورتحال پیش آئے تو ڈاکٹر جانور کے بہترین مفاد میں اضافی عمل کر سکتے ہیں اور جہاں ممکن ہو مجھ سے رابطہ کریں گے۔ میں تصدیق کرتا / کرتی ہوں کہ ہدایت کے مطابق جانور کو خالی پیٹ رکھا گیا ہے، سوائے ایمرجنسی کے۔'
), 'Surgery consent wording shown to the owner (English & Urdu). DRAFT until the clinic reviews it.'),
('surgery.preop_checklist', jsonb_build_array(
  'Owner consent recorded', 'Fasting confirmed', 'Weight taken today', 'Physical exam done', 'Blood test reviewed (if needed)',
  'IV line placed', 'Surgical site clipped & cleaned', 'Emergency drugs ready'
), 'Pre-op checklist items (editable)')
on conflict (key) do nothing;
