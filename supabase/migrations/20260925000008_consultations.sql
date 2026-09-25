-- =============================================================================
-- Phase 2 — Consultations & medical records (spec §10)
--
-- Safety rules enforced in the database:
--  * A finalized consultation can't be edited or deleted by anyone.
--  * Correcting it requires clinical.reopen + a reason (reopen_consultation), which keeps the
--    finalized version in consultation_revisions. Every finalize stores a full snapshot.
--  * Interns (clinical.create without clinical.edit) may only edit drafts they wrote.
-- =============================================================================

create type public.record_status as enum ('draft', 'finalized');
create type public.due_kind as enum ('vaccination', 'follow_up', 'diagnostic', 'other');
create type public.due_status as enum ('pending', 'done', 'skipped', 'cancelled');

-- Templates decide which sections/prompts a doctor sees (routine, derm, emergency…).
create table public.clinical_templates (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  name        text not null,
  description text,
  sections    jsonb not null,     -- ordered list of section keys to show
  exam_prompts jsonb not null default '[]'::jsonb,  -- body systems for the physical exam
  is_active   boolean not null default true,
  sort_order  int not null default 100
);

insert into public.clinical_templates (key, name, description, sections, exam_prompts, sort_order) values
  ('routine', 'Routine consultation', 'General check-up or illness',
   '["complaint","history","vitals","exam","assessment","treatment","plan"]',
   '["General appearance","Eyes","Ears","Nose & throat","Mouth & teeth","Skin & coat","Lymph nodes","Heart","Lungs","Abdomen","Musculoskeletal","Neurological","Urogenital"]', 1),
  ('vaccination', 'Vaccination visit', 'Health check before vaccination',
   '["complaint","vitals","exam","plan"]',
   '["General appearance","Temperature normal?","Eyes & nose discharge","Skin & coat"]', 2),
  ('dermatology', 'Skin / dermatology', 'Itching, hair loss, wounds, ticks',
   '["complaint","history","vitals","exam","assessment","treatment","plan"]',
   '["Lesion distribution","Lesion type","Pruritus level","Parasites seen","Ears","Coat quality"]', 3),
  ('emergency', 'Emergency', 'Trauma, poisoning, collapse — vitals first',
   '["vitals","complaint","exam","assessment","treatment","plan"]',
   '["Airway","Breathing","Circulation / bleeding","Consciousness","Pain","Injuries"]', 4),
  ('post_op', 'Post-op review', 'Wound check, suture removal',
   '["complaint","vitals","exam","assessment","plan"]',
   '["Incision site","Swelling / discharge","Sutures","Appetite & activity","Pain"]', 5);

-- -----------------------------------------------------------------------------
-- Consultations
-- -----------------------------------------------------------------------------
create table public.consultations (
  id                      uuid primary key default gen_random_uuid(),
  visit_id                uuid references public.visits (id),
  pet_id                  uuid not null references public.pets (id),
  doctor_id               uuid references public.staff (id) default auth.uid(),
  template_key            text not null default 'routine' references public.clinical_templates (key) on update cascade,
  -- Findings
  chief_complaint         text,
  history                 text,
  temperature_c           numeric(4,1) check (temperature_c between 25 and 45),
  heart_rate              int check (heart_rate between 10 and 400),
  resp_rate               int check (resp_rate between 2 and 200),
  weight_kg               numeric(7,3) check (weight_kg > 0 and weight_kg < 2000),
  mucous_membranes        text,
  crt_seconds             numeric(3,1) check (crt_seconds between 0 and 10),
  hydration               text,
  body_condition_score    smallint check (body_condition_score between 1 and 9),
  pain_score              smallint check (pain_score between 0 and 10),
  exam                    jsonb not null default '{}'::jsonb,   -- { "Eyes": "NAD", ... }
  observations            text,
  assessment              text,
  treatment               text,
  medicines_administered  text,
  follow_up_plan          text,
  follow_up_date          date,
  doctor_notes            text,
  -- Record state
  status                  public.record_status not null default 'draft',
  revision                int not null default 0,          -- number of times finalized
  finalized_at            timestamptz,
  finalized_by            uuid references public.staff (id),
  reopened_reason         text,
  created_by              uuid references public.staff (id) default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index consultations_pet_idx on public.consultations (pet_id, created_at desc);
create index consultations_visit_idx on public.consultations (visit_id);
create index consultations_draft_idx on public.consultations (doctor_id) where status = 'draft';

create table public.consultation_diagnoses (
  id              uuid primary key default gen_random_uuid(),
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  label           text not null check (length(trim(label)) > 0),
  certainty       text not null default 'provisional' check (certainty in ('provisional', 'confirmed', 'ruled_out')),
  is_primary      boolean not null default false,
  created_at      timestamptz not null default now()
);
create index consultation_diagnoses_idx on public.consultation_diagnoses (consultation_id);
create index consultation_diagnoses_label_trgm on public.consultation_diagnoses
  using gin (lower(label) extensions.gin_trgm_ops);

-- Immutable snapshots of each finalized version.
create table public.consultation_revisions (
  id              bigint generated always as identity primary key,
  consultation_id uuid not null references public.consultations (id) on delete cascade,
  revision        int not null,
  snapshot        jsonb not null,
  reason          text,                -- why it was reopened after this version (filled on reopen)
  finalized_at    timestamptz not null,
  finalized_by    uuid,
  reopened_at     timestamptz,
  reopened_by     uuid,
  unique (consultation_id, revision)
);

-- Generic "something is due for this pet" list: vaccination doses, follow-ups, rechecks.
-- Phase 5's reminder/escalation engine drives notifications from these rows.
create table public.due_items (
  id              uuid primary key default gen_random_uuid(),
  pet_id          uuid not null references public.pets (id) on delete cascade,
  kind            public.due_kind not null,
  title           text not null,
  due_on          date not null,
  status          public.due_status not null default 'pending',
  vaccine_id      uuid,                           -- FK added in vaccinations migration
  protocol_id     uuid,
  protocol_step   int,
  source_table    text,                           -- what created it
  source_id       uuid,
  assigned_to     uuid references public.staff (id),
  outcome         text,                           -- administered, contacted, booked, declined, not applicable…
  outcome_reason  text,
  previous_due_on date,                           -- kept when rescheduled (spec §31)
  completed_at    timestamptz,
  completed_by    uuid references public.staff (id),
  created_by      uuid references public.staff (id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (status in ('pending', 'done') or outcome_reason is not null)   -- skip/cancel needs a reason
);
create index due_items_pending_idx on public.due_items (due_on) where status = 'pending';
create index due_items_pet_idx on public.due_items (pet_id, due_on);

-- -----------------------------------------------------------------------------
-- Locking & finalize / reopen
-- -----------------------------------------------------------------------------
create or replace function private.guard_consultation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'finalized' then raise exception 'finalized records cannot be deleted' using errcode = '42501'; end if;
    return old;
  end if;
  if old.status = 'finalized' and current_setting('bdah.consultation_unlock', true) is distinct from old.id::text then
    raise exception 'this record is finalized — reopen it with a reason to make corrections' using errcode = '42501';
  end if;
  -- Status only changes through finalize/reopen functions.
  if new.status is distinct from old.status and current_setting('bdah.consultation_unlock', true) is distinct from old.id::text then
    raise exception 'use finalize/reopen to change record status' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger consultations_guard before update or delete on public.consultations
  for each row execute function private.guard_consultation();

-- Diagnoses follow their consultation's lock.
create or replace function private.guard_consultation_child()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cid uuid := coalesce(new.consultation_id, old.consultation_id);
begin
  if exists (select 1 from public.consultations where id = cid and status = 'finalized')
     and current_setting('bdah.consultation_unlock', true) is distinct from cid::text then
    raise exception 'this record is finalized — reopen it to change diagnoses' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger consultation_diagnoses_guard before insert or update or delete on public.consultation_diagnoses
  for each row execute function private.guard_consultation_child();

create or replace function public.finalize_consultation(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.consultations;
  snap jsonb;
begin
  if not private.has_permission('clinical.finalize') then
    raise exception 'permission denied: clinical.finalize' using errcode = '42501';
  end if;
  select * into c from public.consultations where id = p_id for update;
  if not found then raise exception 'consultation not found'; end if;
  if c.status = 'finalized' then raise exception 'already finalized'; end if;
  if coalesce(trim(c.chief_complaint), '') = '' and coalesce(trim(c.assessment), '') = '' then
    raise exception 'add at least the reason for visit or an assessment before finalizing';
  end if;

  perform set_config('bdah.consultation_unlock', p_id::text, true);
  update public.consultations
     set status = 'finalized', revision = revision + 1, finalized_at = now(),
         finalized_by = (select auth.uid()), reopened_reason = null
   where id = p_id
   returning * into c;

  snap := to_jsonb(c) || jsonb_build_object('diagnoses',
    coalesce((select jsonb_agg(to_jsonb(d) order by d.is_primary desc, d.created_at)
              from public.consultation_diagnoses d where d.consultation_id = p_id), '[]'::jsonb));
  insert into public.consultation_revisions (consultation_id, revision, snapshot, finalized_at, finalized_by)
  values (p_id, c.revision, snap, c.finalized_at, c.finalized_by);

  -- Weight measured in the exam goes onto the weight chart (once per visit).
  if c.weight_kg is not null and not exists (
       select 1 from public.pet_weights w where w.pet_id = c.pet_id and w.visit_id is not distinct from c.visit_id
         and c.visit_id is not null) then
    insert into public.pet_weights (pet_id, weight_kg, visit_id, recorded_by, note)
    values (c.pet_id, c.weight_kg, c.visit_id, (select auth.uid()), 'From consultation');
  end if;

  -- Follow-up date → a due item that stays visible until someone records an outcome.
  if c.follow_up_date is not null and not exists (
       select 1 from public.due_items where source_table = 'consultations' and source_id = p_id and status = 'pending') then
    insert into public.due_items (pet_id, kind, title, due_on, source_table, source_id, assigned_to)
    values (c.pet_id, 'follow_up', coalesce(nullif(trim(c.follow_up_plan), ''), 'Follow-up visit'),
            c.follow_up_date, 'consultations', p_id, c.doctor_id);
  end if;

  perform set_config('bdah.consultation_unlock', '', true);
end $$;

create or replace function public.reopen_consultation(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('clinical.reopen') then
    raise exception 'permission denied: clinical.reopen' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required to reopen a record'; end if;
  perform 1 from public.consultations where id = p_id and status = 'finalized' for update;
  if not found then raise exception 'only finalized records can be reopened'; end if;

  perform set_config('bdah.consultation_unlock', p_id::text, true);
  update public.consultations set status = 'draft', reopened_reason = p_reason where id = p_id;
  update public.consultation_revisions
     set reason = p_reason, reopened_at = now(), reopened_by = (select auth.uid())
   where consultation_id = p_id
     and revision = (select max(revision) from public.consultation_revisions where consultation_id = p_id);
  perform set_config('bdah.consultation_unlock', '', true);

  insert into public.audit_logs (actor_id, action, table_name, record_id, reason)
  values ((select auth.uid()), 'consultation.reopened', 'consultations', p_id::text, p_reason);
end $$;

revoke execute on function public.finalize_consultation(uuid) from public, anon;
revoke execute on function public.reopen_consultation(uuid, text) from public, anon;
grant execute on function public.finalize_consultation(uuid) to authenticated;
grant execute on function public.reopen_consultation(uuid, text) to authenticated;

create trigger consultations_updated_at before update on public.consultations
  for each row execute function private.set_updated_at();
create trigger due_items_updated_at before update on public.due_items
  for each row execute function private.set_updated_at();

create trigger audit_clinical_templates after insert or update or delete on public.clinical_templates
  for each row execute function private.audit_row();
create trigger audit_consultations after insert or update or delete on public.consultations
  for each row execute function private.audit_row();
create trigger audit_consultation_diagnoses after insert or update or delete on public.consultation_diagnoses
  for each row execute function private.audit_row();
create trigger audit_due_items after insert or update or delete on public.due_items
  for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.clinical_templates      enable row level security;
alter table public.consultations           enable row level security;
alter table public.consultation_diagnoses  enable row level security;
alter table public.consultation_revisions  enable row level security;
alter table public.due_items               enable row level security;

create policy clinical_templates_select on public.clinical_templates for select to authenticated
  using ((select private.is_active_staff()));
create policy clinical_templates_manage on public.clinical_templates for all to authenticated
  using ((select private.has_permission('settings.manage')))
  with check ((select private.has_permission('settings.manage')));

-- Editable by: anyone with clinical.edit, or the author (interns) while it's a draft.
create or replace function private.can_edit_consultation(p_created_by uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_permission('clinical.edit')
      or (private.has_permission('clinical.create') and p_created_by = (select auth.uid()));
$$;
grant execute on function private.can_edit_consultation(uuid) to authenticated;

create policy consultations_select on public.consultations for select to authenticated
  using ((select private.has_permission('clinical.view')));
create policy consultations_insert on public.consultations for insert to authenticated
  with check ((select private.has_permission('clinical.create')) and status = 'draft');
create policy consultations_update on public.consultations for update to authenticated
  using (private.can_edit_consultation(created_by))
  with check (private.can_edit_consultation(created_by));
create policy consultations_delete on public.consultations for delete to authenticated
  using ((select private.has_permission('clinical.edit')));

create policy consultation_diagnoses_select on public.consultation_diagnoses for select to authenticated
  using ((select private.has_permission('clinical.view')));
create policy consultation_diagnoses_write on public.consultation_diagnoses for all to authenticated
  using (exists (select 1 from public.consultations c where c.id = consultation_id and private.can_edit_consultation(c.created_by)))
  with check (exists (select 1 from public.consultations c where c.id = consultation_id and private.can_edit_consultation(c.created_by)));

create policy consultation_revisions_select on public.consultation_revisions for select to authenticated
  using ((select private.has_permission('clinical.view')));
-- No write policies: only the security-definer functions write revisions.

-- Due items: clinical staff and reception (who make reminder calls). Not store-only staff —
-- follow-up titles can contain clinical detail.
create policy due_items_select on public.due_items for select to authenticated
  using ((select private.has_permission('clinical.view')) or (select private.has_permission('crm.view')));
create policy due_items_insert on public.due_items for insert to authenticated
  with check ((select private.has_permission('clinical.create')) or (select private.has_permission('vaccinations.manage')));
create policy due_items_update on public.due_items for update to authenticated
  using ((select private.has_permission('clinical.create')) or (select private.has_permission('vaccinations.manage'))
         or (select private.has_permission('crm.manage')))
  with check ((select private.has_permission('clinical.create')) or (select private.has_permission('vaccinations.manage'))
         or (select private.has_permission('crm.manage')));
