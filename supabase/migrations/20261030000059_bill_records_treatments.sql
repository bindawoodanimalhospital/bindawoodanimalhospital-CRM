-- =============================================================================
-- Billing a deworming or a vaccine records it on the pet.
-- Staff bill "Deworming (Praferan)" / "Cat Vaccination PCH+Rabies" but often don't also record it on
-- the visit's Vaccines & deworming tab — so the pet's profile showed nothing and no reminder was set.
-- Now, when a bill for a pet is issued, each deworming / vaccine line is written into the pet's
-- history (unless the doctor already recorded it on that visit / around that day), with the next
-- dose so reminders run:
--   * deworming: every 2 weeks under 12 weeks old, monthly under 6 months, else every 3 months
--     (same as the visit screen's suggestion; age unknown → 3 months);
--   * vaccine: under 16 weeks old → next dose in 3 weeks, otherwise yearly booster.
-- The doctor can change the date in Due & follow-ups → New date. Voiding / cancelling the bill
-- voids the records it created. Past billed-but-unrecorded dewormings are added now.
-- =============================================================================

-- 1) Which price-list items are dewormings
alter table public.catalog_items add column is_deworming boolean not null default false;
comment on column public.catalog_items.is_deworming is 'Billing this item records a deworming on the pet (with the next-due reminder).';
update public.catalog_items set is_deworming = true where name ~* 'deworm' or category ~* 'deworm';

create or replace function private.flag_deworming_item() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (new.name ~* 'deworm' or coalesce(new.category, '') ~* 'deworm') then new.is_deworming := true; end if;
  return new;
end $$;
create trigger catalog_items_flag_deworming before insert or update of name, category on public.catalog_items
  for each row execute function private.flag_deworming_item();

-- 2) Remember which bill created a record (to undo it if the bill is voided)
alter table public.dewormings add column source_invoice_id uuid references public.invoices (id) on delete set null;
alter table public.vaccinations add column source_invoice_id uuid references public.invoices (id) on delete set null;

create or replace function private.age_days(p_pet uuid, p_on date) returns int
language sql stable security definer set search_path = '' as $$
  select (p_on - date_of_birth) from public.pets where id = p_pet and date_of_birth is not null;
$$;

-- "Deworming (Praferan)" → "Praferan"; "Deworming Dog" / "Deworming" → the item name as is.
create or replace function private.dewormer_name(p_item text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(nullif(trim((regexp_match(p_item, '\(([^)]+)\)'))[1]), ''), p_item);
$$;

create or replace function private.record_billed_treatments(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  inv record; pet uuid; day date; doctor uuid; l record; age int; nxt date; lbl text;
begin
  select i.id, i.number, i.pet_id, i.visit_id, i.issued_at, i.issued_by, v.pet_id visit_pet, v.doctor_id
    into inv from public.invoices i left join public.visits v on v.id = i.visit_id where i.id = p_invoice;
  pet := coalesce(inv.pet_id, inv.visit_pet);
  if pet is null then return; end if;                    -- walk-in / no pet: nothing to record
  day := (coalesce(inv.issued_at, now()) at time zone 'Asia/Karachi')::date;
  doctor := inv.doctor_id;

  for l in select ii.description, ci.name, ci.is_deworming, ci.vaccine_id
             from public.invoice_items ii join public.catalog_items ci on ci.id = ii.item_id
            where ii.invoice_id = p_invoice and (ci.is_deworming or ci.vaccine_id is not null) loop
    age := private.age_days(pet, day);
    if l.is_deworming then
      continue when exists (select 1 from public.dewormings w where w.pet_id = pet and w.voided_at is null
                              and ((inv.visit_id is not null and w.visit_id = inv.visit_id)
                                   or abs((w.given_at at time zone 'Asia/Karachi')::date - day) <= 3));
      nxt := day + case when age is null then 90 when age < 84 then 14 when age < 182 then 30 else 90 end;
      insert into public.dewormings (pet_id, visit_id, product, given_at, given_by, next_due_date, notes, source_invoice_id)
      values (pet, inv.visit_id, private.dewormer_name(coalesce(nullif(l.description, ''), l.name)), coalesce(inv.issued_at, now()),
              doctor, nxt, 'Recorded from bill ' || inv.number || ' — check the next date', p_invoice);
    else
      continue when exists (select 1 from public.vaccinations x where x.pet_id = pet and x.vaccine_id = l.vaccine_id and x.voided_at is null
                              and ((inv.visit_id is not null and x.visit_id = inv.visit_id)
                                   or abs((x.administered_at at time zone 'Asia/Karachi')::date - day) <= 7));
      if age is not null and age < 112 then nxt := day + 21; lbl := 'Next dose';
      else nxt := day + 365; lbl := 'Yearly booster'; end if;
      insert into public.vaccinations (pet_id, visit_id, vaccine_id, vaccine_name, administered_at, administered_by,
                                       next_due_date, next_due_label, notes, source_invoice_id)
      select pet, inv.visit_id, l.vaccine_id, vac.name, coalesce(inv.issued_at, now()), doctor,
             nxt, lbl || ' — ' || vac.name, 'Recorded from bill ' || inv.number || ' — check the next date', p_invoice
        from public.vaccines vac where vac.id = l.vaccine_id;
    end if;
  end loop;
end $$;

create or replace function private.bill_treatments_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'issued' and old.status = 'draft' then
    perform private.record_billed_treatments(new.id);
  elsif new.status = 'void' and old.status = 'issued' then
    update public.dewormings set voided_at = now(), void_reason = 'Bill ' || new.number || ' voided / cancelled'
     where source_invoice_id = new.id and voided_at is null;
    update public.vaccinations set voided_at = now(), void_reason = 'Bill ' || new.number || ' voided / cancelled'
     where source_invoice_id = new.id and voided_at is null;
  end if;
  return null;
end $$;
create trigger invoices_record_treatments after update of status on public.invoices
  for each row execute function private.bill_treatments_sync();

-- 3) Backfill: dewormings already billed but never recorded (vaccines were done in 058)
do $$
declare b uuid;
begin
  for b in select distinct i.id from public.invoices i
             join public.invoice_items ii on ii.invoice_id = i.id
             join public.catalog_items ci on ci.id = ii.item_id and ci.is_deworming
            where i.status = 'issued' loop
    perform private.record_billed_treatments(b);
  end loop;
end $$;
