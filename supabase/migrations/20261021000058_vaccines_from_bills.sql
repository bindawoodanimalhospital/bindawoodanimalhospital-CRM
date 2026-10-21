-- =============================================================================
-- Data fix: vaccines that were billed but never written into the pet's vaccination history
-- (the form used to demand batch no. + vial expiry, so doctors only billed them).
-- Each billed vaccine line with a known pet becomes a vaccination record:
--   * given on the bill's date, linked to the bill's visit;
--   * "Cat Vaccination PCH+Rabies" → Biofel PCHR, "Rabies vaccine" → Rabies (the price-list links);
--   * next dose = yearly booster (standard revaccination for both) so reminders start — the doctor
--     can change it from Due & follow-ups → New date;
--   * who gave it isn't known (left empty); the note names the bill.
-- Bills with no pet attached are left for staff to add from the pet's page.
-- =============================================================================
insert into public.vaccinations (pet_id, visit_id, vaccine_id, vaccine_name, administered_at, administered_by,
                                 next_due_date, next_due_label, notes)
select coalesce(i.pet_id, v.pet_id), i.visit_id, ci.vaccine_id, vac.name, i.issued_at, null,
       (i.issued_at at time zone 'Asia/Karachi')::date + 365, 'Yearly booster — ' || vac.name,
       'Recorded from bill ' || i.number || ' (' || ii.description || ')'
  from public.invoice_items ii
  join public.catalog_items ci on ci.id = ii.item_id and ci.vaccine_id is not null
  join public.vaccines vac on vac.id = ci.vaccine_id
  join public.invoices i on i.id = ii.invoice_id and i.status = 'issued'
  left join public.visits v on v.id = i.visit_id
 where coalesce(i.pet_id, v.pet_id) is not null
   and not exists (select 1 from public.vaccinations x
                    where x.pet_id = coalesce(i.pet_id, v.pet_id) and x.vaccine_id = ci.vaccine_id and x.voided_at is null);
