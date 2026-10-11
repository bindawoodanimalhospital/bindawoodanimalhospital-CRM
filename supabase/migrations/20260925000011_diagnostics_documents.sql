-- =============================================================================
-- Phase 2 — Diagnostics (ultrasound, X-ray, lab) and medical attachments (spec §13, §30)
-- Files live in PRIVATE storage buckets; the app hands out short-lived signed URLs only to
-- users whose role allows it. A leaked URL expires; there are no public links.
-- =============================================================================

create type public.diagnostic_status as enum ('ordered', 'in_progress', 'resulted', 'reviewed', 'cancelled');
create type public.diagnostic_category as enum ('ultrasound', 'imaging', 'lab', 'rapid_test', 'other');

create table public.diagnostic_types (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique,
  category      public.diagnostic_category not null,
  -- Structured result fields for lab tests, e.g. [{"key":"hb","label":"Haemoglobin","unit":"g/dL"}]
  result_fields jsonb not null default '[]'::jsonb,
  is_active     boolean not null default true,
  sort_order    int not null default 100
);

insert into public.diagnostic_types (name, category, sort_order, result_fields) values
  ('Abdominal ultrasound', 'ultrasound', 1, '[]'),
  ('Pregnancy ultrasound', 'ultrasound', 2, '[]'),
  ('X-ray', 'imaging', 3, '[]'),
  ('CBC (complete blood count)', 'lab', 4,
   '[{"key":"hb","label":"Haemoglobin","unit":"g/dL"},{"key":"pcv","label":"PCV / HCT","unit":"%"},{"key":"wbc","label":"WBC","unit":"×10³/µL"},{"key":"plt","label":"Platelets","unit":"×10³/µL"},{"key":"rbc","label":"RBC","unit":"×10⁶/µL"}]'),
  ('Blood chemistry (LFT / RFT)', 'lab', 5,
   '[{"key":"alt","label":"ALT","unit":"U/L"},{"key":"alp","label":"ALP","unit":"U/L"},{"key":"urea","label":"Urea / BUN","unit":"mg/dL"},{"key":"creat","label":"Creatinine","unit":"mg/dL"},{"key":"glu","label":"Glucose","unit":"mg/dL"}]'),
  ('Urinalysis', 'lab', 6, '[]'),
  ('Fecal exam', 'lab', 7, '[]'),
  ('Skin scraping', 'lab', 8, '[]'),
  ('Blood smear (parasites)', 'lab', 9, '[]'),
  ('Parvo / Distemper rapid test', 'rapid_test', 10, '[]'),
  ('FIV / FeLV rapid test', 'rapid_test', 11, '[]');

create sequence public.diagnostic_code_seq start 1;

create table public.diagnostic_orders (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique default 'DX-' || lpad(nextval('public.diagnostic_code_seq')::text, 6, '0'),
  pet_id          uuid not null references public.pets (id),
  visit_id        uuid references public.visits (id),
  consultation_id uuid references public.consultations (id),
  type_id         uuid not null references public.diagnostic_types (id),
  reason          text,                               -- clinical indication
  is_urgent       boolean not null default false,
  status          public.diagnostic_status not null default 'ordered',
  ordered_by      uuid references public.staff (id) default auth.uid(),
  assigned_to     uuid references public.staff (id),
  external_lab    text,                               -- if sent out
  findings        text,
  impression      text,
  result_values   jsonb not null default '{}'::jsonb,
  resulted_at     timestamptz,
  resulted_by     uuid references public.staff (id),
  reviewed_at     timestamptz,
  reviewed_by     uuid references public.staff (id),
  cancel_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((status = 'cancelled') = (cancel_reason is not null))
);
alter sequence public.diagnostic_code_seq owned by public.diagnostic_orders.code;
create index diagnostic_orders_pet_idx on public.diagnostic_orders (pet_id, created_at desc);
create index diagnostic_orders_open_idx on public.diagnostic_orders (status) where status in ('ordered', 'in_progress', 'resulted');

create or replace function private.diagnostic_timestamps()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status = 'reviewed' and new.status <> 'reviewed'
     and not private.has_permission('clinical.reopen') then
    raise exception 'reviewed results can only be reopened by a senior doctor' using errcode = '42501';
  end if;
  if old.status = 'reviewed' and (new.findings is distinct from old.findings
      or new.impression is distinct from old.impression or new.result_values is distinct from old.result_values)
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
create trigger diagnostic_orders_timestamps before update on public.diagnostic_orders
  for each row execute function private.diagnostic_timestamps();
create trigger diagnostic_orders_updated_at before update on public.diagnostic_orders
  for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Documents: metadata for files linked to a record (spec §30)
-- -----------------------------------------------------------------------------
create table public.documents (
  id           uuid primary key default gen_random_uuid(),
  bucket       text not null check (bucket in ('clinical-files', 'pet-photos')),
  path         text not null unique,
  pet_id       uuid references public.pets (id) on delete cascade,
  entity_type  text not null check (entity_type in ('pet', 'consultation', 'diagnostic_order', 'vaccination', 'prescription', 'visit')),
  entity_id    uuid not null,
  category     text,                     -- report, image, consent, photo…
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint check (size_bytes >= 0 and size_bytes <= 26214400),   -- 25 MB
  uploaded_by  uuid references public.staff (id) default auth.uid(),
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index documents_entity_idx on public.documents (entity_type, entity_id) where deleted_at is null;
create index documents_pet_idx on public.documents (pet_id, created_at desc) where deleted_at is null;

alter table public.pets add constraint pets_photo_path_ck check (photo_path is null or photo_path like 'pets/%');

create trigger audit_diagnostic_types after insert or update or delete on public.diagnostic_types
  for each row execute function private.audit_row();
create trigger audit_diagnostic_orders after insert or update or delete on public.diagnostic_orders
  for each row execute function private.audit_row();
create trigger audit_documents after insert or update or delete on public.documents
  for each row execute function private.audit_row();

alter table public.diagnostic_types  enable row level security;
alter table public.diagnostic_orders enable row level security;
alter table public.documents         enable row level security;

create policy diagnostic_types_select on public.diagnostic_types for select to authenticated
  using ((select private.is_active_staff()));
create policy diagnostic_types_manage on public.diagnostic_types for all to authenticated
  using ((select private.has_permission('settings.manage')))
  with check ((select private.has_permission('settings.manage')));

create policy diagnostic_orders_select on public.diagnostic_orders for select to authenticated
  using ((select private.has_permission('clinical.view')));
create policy diagnostic_orders_insert on public.diagnostic_orders for insert to authenticated
  with check ((select private.has_permission('diagnostics.manage')));
create policy diagnostic_orders_update on public.diagnostic_orders for update to authenticated
  using ((select private.has_permission('diagnostics.manage')))
  with check ((select private.has_permission('diagnostics.manage')));

-- Pet photos are visible to anyone who can see pets; everything else needs clinical access.
create policy documents_select on public.documents for select to authenticated
  using (deleted_at is null and (
    (bucket = 'pet-photos' and (select private.has_permission('pets.view')))
    or (bucket = 'clinical-files' and (select private.has_permission('clinical.view')))));
create policy documents_insert on public.documents for insert to authenticated
  with check (
    (bucket = 'pet-photos' and (select private.has_permission('pets.edit')))
    or (bucket = 'clinical-files' and ((select private.has_permission('clinical.create'))
                                       or (select private.has_permission('diagnostics.manage')))));
-- Soft delete only (keeps the audit trail).
create policy documents_update on public.documents for update to authenticated
  using ((select private.has_permission('clinical.edit')) or uploaded_by = (select auth.uid()))
  with check ((select private.has_permission('clinical.edit')) or uploaded_by = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Storage buckets (private) + object policies
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('clinical-files', 'clinical-files', false, 26214400,
   array['image/jpeg','image/png','image/webp','image/heic','application/pdf','application/dicom']),
  ('pet-photos', 'pet-photos', false, 5242880, array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

create policy "clinical files: read" on storage.objects for select to authenticated
  using (bucket_id = 'clinical-files' and (select private.has_permission('clinical.view')));
create policy "clinical files: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'clinical-files'
    and ((select private.has_permission('clinical.create')) or (select private.has_permission('diagnostics.manage'))));

create policy "pet photos: read" on storage.objects for select to authenticated
  using (bucket_id = 'pet-photos' and (select private.has_permission('pets.view')));
create policy "pet photos: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'pet-photos' and (select private.has_permission('pets.edit')));
create policy "pet photos: replace" on storage.objects for update to authenticated
  using (bucket_id = 'pet-photos' and (select private.has_permission('pets.edit')))
  with check (bucket_id = 'pet-photos' and (select private.has_permission('pets.edit')));
-- No delete policies: files are soft-deleted via documents.deleted_at.
