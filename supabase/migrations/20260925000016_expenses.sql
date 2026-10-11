-- =============================================================================
-- Phase 4 — Expenses (spec §20). Permission-restricted: never visible to interns / store staff.
-- Recorded expenses aren't edited or deleted — a mistake is reversed with a note (audited).
-- =============================================================================

create table public.expense_categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  is_active   boolean not null default true,
  sort_order  int not null default 100
);
insert into public.expense_categories (name, sort_order) values
  ('Rent', 1), ('Electricity (LESCO)', 2), ('Gas (SNGPL)', 3), ('Water', 4), ('Internet & phone', 5),
  ('Salaries & wages', 6), ('Medical supplies', 7), ('Pet store stock (not via Suppliers)', 8), ('Maintenance & repairs', 9),
  ('Generator / fuel', 10), ('Cleaning & sanitation', 11), ('Marketing', 12), ('Software & services', 13),
  ('Transport', 14), ('Bank charges', 15), ('Other', 99);

create table public.expenses (
  id             uuid primary key default gen_random_uuid(),
  spent_on       date not null default private.clinic_today(),
  category_id    uuid not null references public.expense_categories (id),
  amount         numeric(12,2) not null check (amount <> 0),        -- negative only for reversals
  method         text not null references public.payment_methods (key),
  payee          text,
  description    text not null check (length(trim(description)) > 1),
  reference      text,
  document_id    uuid references public.documents (id),              -- receipt photo
  reverses_id    uuid references public.expenses (id),
  created_by     uuid references public.staff (id) default auth.uid(),
  created_at     timestamptz not null default now(),
  check ((amount < 0) = (reverses_id is not null))
);
create index expenses_date_idx on public.expenses (spent_on desc);
create unique index expenses_one_reversal on public.expenses (reverses_id) where reverses_id is not null;

create trigger audit_expense_categories after insert or update or delete on public.expense_categories
  for each row execute function private.audit_row();
create trigger audit_expenses after insert on public.expenses
  for each row execute function private.audit_row();

alter table public.expense_categories enable row level security;
alter table public.expenses enable row level security;

create policy expense_categories_select on public.expense_categories for select to authenticated
  using ((select private.has_permission('expenses.view')) or (select private.has_permission('expenses.manage')));
create policy expense_categories_manage on public.expense_categories for all to authenticated
  using ((select private.has_permission('settings.manage'))) with check ((select private.has_permission('settings.manage')));

create policy expenses_select on public.expenses for select to authenticated using ((select private.has_permission('expenses.view')));
create policy expenses_insert on public.expenses for insert to authenticated
  with check ((select private.has_permission('expenses.manage')) and created_by = (select auth.uid()));
-- No update/delete: reverse with a negative entry that points at the original.

-- Receipts can be uploaded to clinical-files? No — keep business receipts in their own private bucket.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('business-files', 'business-files', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do nothing;
create policy "business files: read" on storage.objects for select to authenticated
  using (bucket_id = 'business-files' and ((select private.has_permission('expenses.view')) or (select private.has_permission('suppliers.manage'))));
create policy "business files: upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'business-files' and ((select private.has_permission('expenses.manage')) or (select private.has_permission('suppliers.manage'))));

alter table public.documents drop constraint documents_bucket_check;
alter table public.documents add constraint documents_bucket_check check (bucket in ('clinical-files', 'pet-photos', 'business-files'));
alter table public.documents drop constraint documents_entity_type_check;
alter table public.documents add constraint documents_entity_type_check check (entity_type in
  ('pet', 'consultation', 'diagnostic_order', 'vaccination', 'prescription', 'visit', 'surgery', 'expense', 'purchase'));
drop policy documents_select on public.documents;
create policy documents_select on public.documents for select to authenticated
  using (deleted_at is null and (
    (bucket = 'pet-photos' and (select private.has_permission('pets.view')))
    or (bucket = 'clinical-files' and (select private.has_permission('clinical.view')))
    or (bucket = 'business-files' and ((select private.has_permission('expenses.view')) or (select private.has_permission('suppliers.manage'))))));
drop policy documents_insert on public.documents;
create policy documents_insert on public.documents for insert to authenticated
  with check (
    (bucket = 'pet-photos' and (select private.has_permission('pets.edit')))
    or (bucket = 'clinical-files' and ((select private.has_permission('clinical.create')) or (select private.has_permission('diagnostics.manage'))))
    or (bucket = 'business-files' and ((select private.has_permission('expenses.manage')) or (select private.has_permission('suppliers.manage')))));
