-- =============================================================================
-- The owner's medical record.
--
-- 1. Lab results keep a reference range and a comment per value (the range the lab or analyser printed,
--    pre-filled from the test type for the pet's species), so results can be flagged High / Low; panels are
--    grouped like a lab report; consultations gain pulse quality, mentation and prognosis.
-- 2. Problems: a pet's cases ("Diarrhea", "Skin allergy") with open / resolved status; visits link to one,
--    so a case that spans several visits reads as one story.
-- 3. Share links: a private link to a pet's record (or one problem) for the owner's phone. Only a hash of
--    the link's secret is stored; links expire, can be cancelled, and count how often they're opened.
-- =============================================================================

-- 1) Lab results ---------------------------------------------------------------------------------
alter table public.diagnostic_orders add column result_meta jsonb not null default '{}'::jsonb;
comment on column public.diagnostic_orders.result_meta is
  'Per result value: {"wbc": {"range": "5.5-19.5", "comment": "Leukopenia"}}. The range is the one on the lab / analyser report.';

-- Reviewed results stay locked — ranges and comments included.
create or replace function private.diagnostic_timestamps()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'reviewed' and new.status <> 'reviewed'
     and not private.has_permission('clinical.reopen') then
    raise exception 'reviewed results can only be reopened by a senior doctor' using errcode = '42501';
  end if;
  if old.status = 'reviewed' and (new.findings is distinct from old.findings
      or new.impression is distinct from old.impression or new.result_values is distinct from old.result_values
      or new.result_meta is distinct from old.result_meta or new.external_lab is distinct from old.external_lab
      or new.external_ref is distinct from old.external_ref)
     and not private.has_permission('clinical.reopen') then
    raise exception 'reviewed results are locked' using errcode = '42501';
  end if;
  if new.status = 'resulted' and old.status is distinct from 'resulted' then
    new.resulted_at := now(); new.resulted_by := (select auth.uid());
  end if;
  if new.status = 'reviewed' and old.status is distinct from 'reviewed' then
    new.reviewed_at := now(); new.reviewed_by := (select auth.uid());
  end if;
  return new;
end $$;

-- Lab panels grouped like a lab report, with usual dog / cat reference ranges (textbook values — a guide only;
-- the doctor enters the range printed on their own lab or analyser report, which is saved with each result).
-- Blank ranges are ones that vary too much between labs to suggest. Earlier result keys (rbc, hb, pcv, wbc, plt,
-- alt, alp, urea, creat, glu) are kept, so results already entered still show.
update public.diagnostic_types set result_fields = '[
  {"key": "rbc", "label": "RBC", "unit": "×10⁶/µL", "group": "Red cells", "ranges": {"Dog": "5.5-8.5", "Cat": "5.0-10.0"}},
  {"key": "hb", "label": "Haemoglobin (HB)", "unit": "g/dL", "group": "Red cells", "ranges": {"Dog": "12.0-18.0", "Cat": "8.0-15.0"}},
  {"key": "pcv", "label": "HCT / PCV", "unit": "%", "group": "Red cells", "ranges": {"Dog": "37-55", "Cat": "24-45"}},
  {"key": "mcv", "label": "MCV", "unit": "fL", "group": "Red cells", "ranges": {"Dog": "60-77", "Cat": "39-55"}},
  {"key": "mch", "label": "MCH", "unit": "pg", "group": "Red cells", "ranges": {"Dog": "19.5-24.5", "Cat": "12.5-17.5"}},
  {"key": "mchc", "label": "MCHC", "unit": "g/dL", "group": "Red cells", "ranges": {"Dog": "32-36", "Cat": "30-36"}},
  {"key": "rdw", "label": "RDW", "unit": "%", "group": "Red cells"},
  {"key": "wbc", "label": "WBC", "unit": "×10³/µL", "group": "White cells", "ranges": {"Dog": "6.0-17.0", "Cat": "5.5-19.5"}},
  {"key": "neu_pct", "label": "Neutrophils %", "unit": "%", "group": "White cells", "ranges": {"Dog": "60-77", "Cat": "35-75"}},
  {"key": "lym_pct", "label": "Lymphocytes %", "unit": "%", "group": "White cells", "ranges": {"Dog": "12-30", "Cat": "20-55"}},
  {"key": "mon_pct", "label": "Monocytes %", "unit": "%", "group": "White cells", "ranges": {"Dog": "3-10", "Cat": "1-4"}},
  {"key": "eos_pct", "label": "Eosinophils %", "unit": "%", "group": "White cells", "ranges": {"Dog": "2-10", "Cat": "2-12"}},
  {"key": "bas_pct", "label": "Basophils %", "unit": "%", "group": "White cells", "ranges": {"Dog": "< 1", "Cat": "< 1"}},
  {"key": "neu_abs", "label": "Neutrophils", "unit": "×10³/µL", "group": "White cells", "ranges": {"Dog": "3.0-11.5", "Cat": "2.5-12.5"}},
  {"key": "lym_abs", "label": "Lymphocytes", "unit": "×10³/µL", "group": "White cells", "ranges": {"Dog": "1.0-4.8", "Cat": "1.5-7.0"}},
  {"key": "mon_abs", "label": "Monocytes", "unit": "×10³/µL", "group": "White cells", "ranges": {"Dog": "0.15-1.35", "Cat": "0-0.85"}},
  {"key": "eos_abs", "label": "Eosinophils", "unit": "×10³/µL", "group": "White cells", "ranges": {"Dog": "0.1-1.25", "Cat": "0-0.75"}},
  {"key": "bas_abs", "label": "Basophils", "unit": "×10³/µL", "group": "White cells"},
  {"key": "plt", "label": "Platelets (PLT)", "unit": "×10³/µL", "group": "Platelets", "ranges": {"Dog": "200-500", "Cat": "300-800"}},
  {"key": "mpv", "label": "MPV", "unit": "fL", "group": "Platelets"}
]'::jsonb
where name = 'CBC (complete blood count)';

update public.diagnostic_types set result_fields = '[
  {"key": "alt", "label": "ALT (SGPT)", "unit": "U/L", "group": "Liver (LFT)", "ranges": {"Dog": "10-125", "Cat": "12-130"}},
  {"key": "ast", "label": "AST (SGOT)", "unit": "U/L", "group": "Liver (LFT)", "ranges": {"Dog": "0-50", "Cat": "0-48"}},
  {"key": "alp", "label": "Alkaline phosphatase (ALP)", "unit": "U/L", "group": "Liver (LFT)", "ranges": {"Dog": "23-212", "Cat": "14-111"}},
  {"key": "ggt", "label": "GGT", "unit": "U/L", "group": "Liver (LFT)", "ranges": {"Dog": "0-11", "Cat": "0-4"}},
  {"key": "tbil", "label": "Bilirubin total", "unit": "mg/dL", "group": "Liver (LFT)", "ranges": {"Dog": "0-0.9", "Cat": "0-0.9"}},
  {"key": "dbil", "label": "Bilirubin direct (conjugated)", "unit": "mg/dL", "group": "Liver (LFT)"},
  {"key": "ibil", "label": "Bilirubin indirect (unconjugated)", "unit": "mg/dL", "group": "Liver (LFT)"},
  {"key": "tp", "label": "Total protein", "unit": "g/dL", "group": "Liver (LFT)", "ranges": {"Dog": "5.2-8.2", "Cat": "5.7-8.9"}},
  {"key": "alb", "label": "Albumin", "unit": "g/dL", "group": "Liver (LFT)", "ranges": {"Dog": "2.3-4.0", "Cat": "2.2-4.0"}},
  {"key": "glob", "label": "Globulin", "unit": "g/dL", "group": "Liver (LFT)", "ranges": {"Dog": "2.5-4.5", "Cat": "2.8-5.1"}},
  {"key": "ag_ratio", "label": "A/G ratio", "unit": "", "group": "Liver (LFT)"},
  {"key": "urea", "label": "Urea", "unit": "mg/dL", "group": "Kidney (RFT)", "ranges": {"Dog": "15-58", "Cat": "34-77"}},
  {"key": "bun", "label": "BUN", "unit": "mg/dL", "group": "Kidney (RFT)", "ranges": {"Dog": "7-27", "Cat": "16-36"}},
  {"key": "creat", "label": "Creatinine", "unit": "mg/dL", "group": "Kidney (RFT)", "ranges": {"Dog": "0.5-1.8", "Cat": "0.8-2.4"}},
  {"key": "na", "label": "Sodium (Na)", "unit": "mmol/L", "group": "Electrolytes & minerals", "ranges": {"Dog": "144-160", "Cat": "150-165"}},
  {"key": "k", "label": "Potassium (K)", "unit": "mmol/L", "group": "Electrolytes & minerals", "ranges": {"Dog": "3.5-5.8", "Cat": "3.5-5.8"}},
  {"key": "cl", "label": "Chloride (Cl)", "unit": "mmol/L", "group": "Electrolytes & minerals", "ranges": {"Dog": "109-122", "Cat": "112-129"}},
  {"key": "ca", "label": "Calcium (Ca)", "unit": "mg/dL", "group": "Electrolytes & minerals", "ranges": {"Dog": "7.9-12.0", "Cat": "7.8-11.3"}},
  {"key": "phos", "label": "Phosphorus", "unit": "mg/dL", "group": "Electrolytes & minerals", "ranges": {"Dog": "2.5-6.8", "Cat": "3.1-7.5"}},
  {"key": "glu", "label": "Glucose", "unit": "mg/dL", "group": "Other", "ranges": {"Dog": "74-143", "Cat": "71-159"}}
]'::jsonb
where name = 'Blood chemistry (LFT / RFT)';

-- The outside lab's own case / reference number (the lab's name already has a column: external_lab).
alter table public.diagnostic_orders add column external_ref text;
comment on column public.diagnostic_orders.external_ref is 'Case / reference number on the outside lab''s report.';

-- 1b) Consultation: what the shared records of other clinics also show ------------------------------
alter table public.consultations
  add column pulse_quality text,   -- e.g. Strong and synchronous, Weak, Bounding, Irregular
  add column mentation     text,   -- BAR, QAR, Depressed / obtunded, Stuporous, Comatose
  add column prognosis     text;   -- Excellent, Good, Fair, Guarded, Poor, Grave

-- 2) Problems --------------------------------------------------------------------------------------
create table public.pet_problems (
  id           uuid primary key default gen_random_uuid(),
  pet_id       uuid not null references public.pets (id) on delete cascade,
  title        text not null check (length(trim(title)) between 2 and 120),
  status       text not null default 'open' check (status in ('open', 'resolved')),
  opened_at    timestamptz not null default now(),
  resolved_at  timestamptz,
  resolved_by  uuid references public.staff (id),
  created_by   uuid references public.staff (id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index pet_problems_pet_idx on public.pet_problems (pet_id, status, opened_at desc);
alter table public.pet_problems enable row level security;
create policy pet_problems_select on public.pet_problems for select to authenticated
  using ((select private.has_permission('clinical.view')));
create policy pet_problems_insert on public.pet_problems for insert to authenticated
  with check ((select private.has_permission('clinical.create')));
create policy pet_problems_update on public.pet_problems for update to authenticated
  using ((select private.has_permission('clinical.create') or private.has_permission('clinical.edit')))
  with check ((select private.has_permission('clinical.create') or private.has_permission('clinical.edit')));
grant select, insert, update on public.pet_problems to authenticated;
revoke all on public.pet_problems from anon;

create or replace function private.pet_problem_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.pet_id is distinct from old.pet_id then raise exception 'a problem stays with its pet'; end if;
  if new.status = 'resolved' and old.status is distinct from 'resolved' then
    new.resolved_at := now(); new.resolved_by := (select auth.uid());
  elsif new.status = 'open' then
    new.resolved_at := null; new.resolved_by := null;
  end if;
  return new;
end $$;
create trigger pet_problems_status before update on public.pet_problems for each row execute function private.pet_problem_status();
create trigger pet_problems_updated_at before update on public.pet_problems for each row execute function private.set_updated_at();
create trigger audit_pet_problems after insert or update or delete on public.pet_problems for each row execute function private.audit_row();

alter table public.visits add column problem_id uuid references public.pet_problems (id) on delete set null;
create index visits_problem_idx on public.visits (problem_id) where problem_id is not null;

-- A visit can only belong to one of its own pet's problems.
create or replace function private.visit_problem_same_pet()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.problem_id is not null
     and not exists (select 1 from public.pet_problems p where p.id = new.problem_id and p.pet_id = new.pet_id) then
    raise exception 'this problem belongs to another pet';
  end if;
  return new;
end $$;
create trigger visits_problem_same_pet before insert or update of problem_id, pet_id on public.visits
  for each row execute function private.visit_problem_same_pet();

/** Link a visit to a problem: an existing one, a new one (by title), or none. Returns the problem id. */
create or replace function public.set_visit_problem(p_visit uuid, p_problem uuid, p_new_title text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_pet uuid; v_problem uuid := p_problem;
begin
  if not private.has_permission('clinical.create') then
    raise exception 'you do not have permission to record clinical notes' using errcode = '42501';
  end if;
  select pet_id into v_pet from public.visits where id = p_visit;
  if v_pet is null then raise exception 'visit not found'; end if;
  if nullif(trim(coalesce(p_new_title, '')), '') is not null then
    insert into public.pet_problems (pet_id, title) values (v_pet, trim(p_new_title)) returning id into v_problem;
  end if;
  update public.visits set problem_id = v_problem where id = p_visit;
  return v_problem;
end $$;
revoke execute on function public.set_visit_problem(uuid, uuid, text) from public, anon;
grant execute on function public.set_visit_problem(uuid, uuid, text) to authenticated;

-- 3) Share links -----------------------------------------------------------------------------------
create table public.record_shares (
  id              uuid primary key default gen_random_uuid(),
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),   -- sha-256 of the link's secret
  pet_id          uuid not null references public.pets (id) on delete cascade,
  problem_id      uuid references public.pet_problems (id) on delete cascade,  -- null = the whole record
  created_by      uuid references public.staff (id) default auth.uid(),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '30 days',
  revoked_at      timestamptz,
  revoked_by      uuid references public.staff (id),
  views           int not null default 0,
  last_viewed_at  timestamptz,
  check (expires_at > created_at)
);
create index record_shares_pet_idx on public.record_shares (pet_id, created_at desc);
alter table public.record_shares enable row level security;
create policy record_shares_select on public.record_shares for select to authenticated
  using ((select private.has_permission('clinical.view')));
create policy record_shares_insert on public.record_shares for insert to authenticated
  with check ((select private.has_permission('clinical.view')) and created_by = (select auth.uid()));
create policy record_shares_update on public.record_shares for update to authenticated
  using ((select private.has_permission('clinical.view')))
  with check ((select private.has_permission('clinical.view')));
grant select, insert, update on public.record_shares to authenticated;
revoke all on public.record_shares from anon;

-- Once made, a link can only be cancelled (and its views counted) — never pointed elsewhere or revived.
create or replace function private.record_share_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.token_hash is distinct from old.token_hash or new.pet_id is distinct from old.pet_id
     or new.problem_id is distinct from old.problem_id or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at or new.expires_at is distinct from old.expires_at then
    raise exception 'a share link cannot be changed — cancel it and make a new one';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'a cancelled link stays cancelled';
  end if;
  if new.revoked_at is not null and old.revoked_at is null then new.revoked_by := (select auth.uid()); end if;
  return new;
end $$;
create trigger record_shares_guard before update on public.record_shares for each row execute function private.record_share_guard();
-- Log making and cancelling a link (not every view: those are counted on the row).
create trigger audit_record_shares after insert or update of revoked_at on public.record_shares
  for each row execute function private.audit_row();
