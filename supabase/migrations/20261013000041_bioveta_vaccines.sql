-- =============================================================================
-- Vaccines the clinic uses that weren't on the list: Bioveta's PCH (cats) and Biocan (dogs) ranges.
-- Sources: Bioveta product information in the EU veterinary medicines database
-- (Biofel PCH / PCHR, Biocan Puppy, Biocan Novel DHPPi/L4 / L4R, Biocan R, Biocan M).
--  * Biofel PCH: inactivated feline panleukopenia, calicivirus, herpesvirus; cats from 8 weeks,
--    2nd dose 3–4 weeks later (PCHR, i.e. with rabies, from 12 weeks), then yearly.
--  * Biocan Puppy: distemper + parvovirus, the first puppy dose.
--  * Biocan Novel DHPPi/L4(R): distemper, hepatitis, parvovirus, parainfluenza, leptospirosis
--    (4 strains) (+ rabies); 2 doses 3–4 weeks apart from 8–9 weeks (2nd not before 12 weeks), yearly.
--  * Biocan M: ringworm (Microsporum canis) in dogs and cats, from 12 weeks, 2 doses 14–21 days apart.
-- The two schedules are DRAFTS: nothing is suggested to doctors until a senior doctor approves them.
-- Also fixes the clinic's price-list links: "Biocan M" was linked to Rabies, "Biocan Puppy" to
-- "Parvo (puppy)" and "Cat Vaccination PCH+Rabies" to nothing.
-- =============================================================================
insert into public.vaccines (name, protects_against, species_ids, default_manufacturer, default_route, default_dose)
select v.name, v.protects, array(select id from public.species where name = any (v.species)), 'Bioveta', v.route, '1 ml'
from (values
  ('PCH (Biofel PCH)',        'Cat flu & panleukopenia: feline panleukopenia, calicivirus, herpesvirus (rhinotracheitis)', array['Cat'], 'SC'),
  ('PCHR (Biofel PCHR)',      'PCH + rabies: feline panleukopenia, calicivirus, herpesvirus and rabies',                    array['Cat'], 'SC'),
  ('Biocan Puppy',            'Distemper and parvovirus — first puppy dose',                                               array['Dog'], 'SC'),
  ('Biocan Novel DHPPi/L4',   'Distemper, hepatitis, parvovirus, parainfluenza, leptospirosis (4 strains)',                array['Dog'], 'SC'),
  ('Biocan Novel DHPPi/L4R',  'Distemper, hepatitis, parvovirus, parainfluenza, leptospirosis (4 strains) and rabies',     array['Dog'], 'SC'),
  ('Biocan R',                'Rabies',                                                                                    array['Dog', 'Cat'], 'SC'),
  ('Biocan M (ringworm)',     'Ringworm (dermatophytosis, Microsporum canis) — prevention and treatment',                  array['Dog', 'Cat'], 'IM (dogs) / SC or IM (cats)')
) as v(name, protects, species, route)
on conflict (name) do nothing;

-- Draft schedules (a senior doctor reviews and approves before anything is suggested)
insert into public.vaccination_protocols (name, species_id, description, booster_interval_days)
values
  ('Kitten — Biofel PCH (Bioveta)', (select id from public.species where name = 'Cat'),
   'PCH from 8 weeks, PCHR (with rabies) 3–4 weeks later and not before 12 weeks, then PCHR yearly. From the Bioveta leaflet — check against the leaflet in the box before approving.', 365),
  ('Puppy — Biocan (Bioveta)', (select id from public.species where name = 'Dog'),
   'Biocan Puppy (distemper + parvo) at 6 weeks, Biocan Novel DHPPi/L4 at 8–9 weeks, DHPPi/L4R 3–4 weeks later and not before 12 weeks, then yearly. From the Bioveta leaflets — check before approving.', 365),
  ('Ringworm — Biocan M (Bioveta)', null,
   'Dogs and cats from 12 weeks: 2 doses 14–21 days apart, then yearly. From the Bioveta leaflet — check before approving.', 365)
on conflict (name) do nothing;

insert into public.vaccination_protocol_steps (protocol_id, step_no, label, vaccine_id, min_age_weeks, days_after_previous)
select p.id, s.step_no, s.label, (select id from public.vaccines where name = s.vaccine), s.min_age, s.days_after
from public.vaccination_protocols p
join (values
  ('Kitten — Biofel PCH (Bioveta)', 1, 'PCH — dose 1',          'PCH (Biofel PCH)',       8,  null::int),
  ('Kitten — Biofel PCH (Bioveta)', 2, 'PCHR — dose 2',         'PCHR (Biofel PCHR)',     12, 21),
  ('Puppy — Biocan (Bioveta)',      1, 'Biocan Puppy',          'Biocan Puppy',           6,  null),
  ('Puppy — Biocan (Bioveta)',      2, 'DHPPi/L4 — dose 1',     'Biocan Novel DHPPi/L4',  8,  14),
  ('Puppy — Biocan (Bioveta)',      3, 'DHPPi/L4R — dose 2',    'Biocan Novel DHPPi/L4R', 12, 21),
  ('Ringworm — Biocan M (Bioveta)', 1, 'Biocan M — dose 1',     'Biocan M (ringworm)',    12, null),
  ('Ringworm — Biocan M (Bioveta)', 2, 'Biocan M — dose 2',     'Biocan M (ringworm)',    null, 14)
) as s(protocol, step_no, label, vaccine, min_age, days_after) on s.protocol = p.name
on conflict (protocol_id, step_no) do nothing;

-- Price-list items the clinic already made for these vaccines: point them at the right vaccine.
update public.catalog_items set vaccine_id = (select id from public.vaccines where name = 'Biocan M (ringworm)')
 where name = 'Biocan M' and vaccine_id is distinct from (select id from public.vaccines where name = 'Biocan M (ringworm)');
update public.catalog_items set vaccine_id = (select id from public.vaccines where name = 'Biocan Puppy')
 where name = 'Biocan Puppy';
update public.catalog_items set vaccine_id = (select id from public.vaccines where name = 'PCHR (Biofel PCHR)')
 where name = 'Cat Vaccination PCH+Rabies' and vaccine_id is null;
