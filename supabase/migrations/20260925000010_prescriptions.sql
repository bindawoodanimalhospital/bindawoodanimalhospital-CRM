-- =============================================================================
-- Phase 2 — Medicine catalogue & prescriptions (spec §12)
--
-- * The system never calculates doses: the doctor writes dose/frequency/duration for every line.
-- * An issued prescription is locked; it can only be cancelled (with a reason) and re-written.
-- * medicines.product_id will link to inventory in Phase 4 (stock deduction on dispensing).
-- =============================================================================

create type public.prescription_status as enum ('draft', 'issued', 'cancelled');

create table public.medicines (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,                 -- brand or common name as written on Rx
  generic_name         text,
  form                 text,                          -- tablet, syrup, injection, drops, ointment…
  strength             text,                          -- "250 mg", "5 mg/ml"
  default_route        text,
  default_instructions text,
  is_active            boolean not null default true,
  created_by           uuid references public.staff (id) default auth.uid(),
  created_at           timestamptz not null default now(),
  unique (name, strength, form)
);
create index medicines_name_trgm on public.medicines using gin (lower(name) extensions.gin_trgm_ops);

create sequence public.prescription_code_seq start 1;

create table public.prescriptions (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique default 'RX-' || lpad(nextval('public.prescription_code_seq')::text, 6, '0'),
  pet_id        uuid not null references public.pets (id),
  visit_id      uuid references public.visits (id),
  consultation_id uuid references public.consultations (id),
  doctor_id     uuid not null references public.staff (id) default auth.uid(),
  status        public.prescription_status not null default 'draft',
  notes         text,                              -- advice for the owner, printed
  issued_at     timestamptz,
  cancelled_at  timestamptz,
  cancel_reason text,
  created_by    uuid references public.staff (id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((status = 'cancelled') = (cancel_reason is not null))
);
alter sequence public.prescription_code_seq owned by public.prescriptions.code;
create index prescriptions_pet_idx on public.prescriptions (pet_id, created_at desc);
create index prescriptions_visit_idx on public.prescriptions (visit_id);

create table public.prescription_items (
  id              uuid primary key default gen_random_uuid(),
  prescription_id uuid not null references public.prescriptions (id) on delete cascade,
  sort_order      int not null default 0,
  medicine_id     uuid references public.medicines (id),
  medicine_name   text not null check (length(trim(medicine_name)) > 0),   -- snapshot as printed
  strength        text,
  form            text,
  dose            text not null check (length(trim(dose)) > 0),            -- "1 tablet", "2 ml"
  frequency       text not null check (length(trim(frequency)) > 0),       -- "twice a day"
  duration        text,                                                    -- "5 days"
  route           text,
  quantity        text,
  instructions    text                                                     -- "after food"
);
create index prescription_items_rx_idx on public.prescription_items (prescription_id, sort_order);

-- Locking
create or replace function private.guard_prescription()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'issued prescriptions cannot be deleted — cancel instead' using errcode = '42501'; end if;
    return old;
  end if;
  if old.status = 'cancelled' then raise exception 'this prescription is cancelled' using errcode = '42501'; end if;
  if old.status = 'issued' then
    -- Only allowed change after issuing: cancel with a reason.
    if new.status <> 'cancelled' or new.pet_id <> old.pet_id or new.notes is distinct from old.notes then
      raise exception 'issued prescriptions are locked — cancel and write a new one' using errcode = '42501';
    end if;
  end if;
  if new.status = 'cancelled' then new.cancelled_at := now(); end if;
  if new.status = 'issued' and old.status = 'draft' then
    if not exists (select 1 from public.prescription_items where prescription_id = new.id) then
      raise exception 'add at least one medicine before issuing';
    end if;
    new.issued_at := now();
  end if;
  return new;
end $$;
create trigger prescriptions_guard before update or delete on public.prescriptions
  for each row execute function private.guard_prescription();

create or replace function private.guard_prescription_item()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.prescriptions
             where id = coalesce(new.prescription_id, old.prescription_id) and status <> 'draft') then
    raise exception 'issued prescriptions are locked' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger prescription_items_guard before insert or update or delete on public.prescription_items
  for each row execute function private.guard_prescription_item();

create trigger prescriptions_updated_at before update on public.prescriptions
  for each row execute function private.set_updated_at();

create trigger audit_medicines after insert or update or delete on public.medicines
  for each row execute function private.audit_row();
create trigger audit_prescriptions after insert or update or delete on public.prescriptions
  for each row execute function private.audit_row();
create trigger audit_prescription_items after insert or update or delete on public.prescription_items
  for each row execute function private.audit_row();

-- RLS
alter table public.medicines          enable row level security;
alter table public.prescriptions      enable row level security;
alter table public.prescription_items enable row level security;

create policy medicines_select on public.medicines for select to authenticated
  using ((select private.is_active_staff()));
create policy medicines_insert on public.medicines for insert to authenticated
  with check ((select private.has_permission('prescriptions.manage')) or (select private.has_permission('inventory.manage')));
create policy medicines_update on public.medicines for update to authenticated
  using ((select private.has_permission('settings.manage')) or (select private.has_permission('inventory.manage')))
  with check ((select private.has_permission('settings.manage')) or (select private.has_permission('inventory.manage')));

create policy prescriptions_select on public.prescriptions for select to authenticated
  using ((select private.has_permission('clinical.view')));
create policy prescriptions_insert on public.prescriptions for insert to authenticated
  with check ((select private.has_permission('prescriptions.manage')) and status = 'draft');
create policy prescriptions_update on public.prescriptions for update to authenticated
  using ((select private.has_permission('prescriptions.manage')))
  with check ((select private.has_permission('prescriptions.manage')));
create policy prescriptions_delete on public.prescriptions for delete to authenticated
  using ((select private.has_permission('prescriptions.manage')));

create policy prescription_items_select on public.prescription_items for select to authenticated
  using ((select private.has_permission('clinical.view')));
create policy prescription_items_write on public.prescription_items for all to authenticated
  using ((select private.has_permission('prescriptions.manage')))
  with check ((select private.has_permission('prescriptions.manage')));
