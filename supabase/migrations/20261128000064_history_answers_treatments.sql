-- =============================================================================
-- Consultation: the owner's answers and the treatments given, as structured lists; more blood-count values.
--
-- 1. history_answers — the questions asked on every visit (eating, drinking, activity, vomiting, stool, urine,
--    cough / sneeze, vaccinated, dewormed, food, medicines already given), e.g.
--    {"appetite": "Eating less", "vomiting": "Yes", "vomiting_detail": "White foam, 3 times"}.
--    The free-text "history" column stays for anything else the owner says.
-- 2. treatments_given — what was given or done at the clinic, one row each:
--    [{"what": "Ondansetron", "dose": "0.5 mg/kg", "route": "IV", "note": null}].
--    The old free-text columns (treatment, medicines_administered) stay; older visits keep showing them.
-- 3. CBC: granulocytes (count and %), PDW and plateletcrit (PCT), as printed by common analysers.
-- 4. The emergency visit template asks the history questions too.
-- Both new columns follow the consultation's lock (the existing guard trigger covers the whole row).
-- =============================================================================

alter table public.consultations
  add column history_answers  jsonb not null default '{}'::jsonb,
  add column treatments_given jsonb not null default '[]'::jsonb;

alter table public.consultations
  add constraint consultations_history_answers_object check (jsonb_typeof(history_answers) = 'object'),
  add constraint consultations_treatments_given_array check (jsonb_typeof(treatments_given) = 'array' and jsonb_array_length(treatments_given) <= 40);

comment on column public.consultations.history_answers is
  'Owner''s answers to the standard history questions: {"appetite": "Eating less", "vomiting": "Yes", "vomiting_detail": "..."}.';
comment on column public.consultations.treatments_given is
  'Treatments given at the clinic: [{"what": "...", "dose": "...", "route": "IV", "note": "..."}].';

-- CBC: add the granulocyte and platelet-index values after the ones already there (keys kept; results already
-- entered are unaffected). Only added when missing, so running this again changes nothing.
do $$
declare
  extra jsonb := '[
    {"key": "gran_abs", "label": "Granulocytes", "unit": "×10³/µL", "group": "White cells", "ranges": {"Dog": "3.5-12.0", "Cat": "2.5-12.5"}, "after": "bas_abs"},
    {"key": "gran_pct", "label": "Granulocytes %", "unit": "%", "group": "White cells", "after": "gran_abs"},
    {"key": "pdw", "label": "PDW", "unit": "%", "group": "Platelets", "after": "mpv"},
    {"key": "pct", "label": "Plateletcrit (PCT)", "unit": "%", "group": "Platelets", "after": "pdw"}
  ]';
  e jsonb;
  f jsonb;
  pos int;
begin
  select result_fields into f from public.diagnostic_types where name = 'CBC (complete blood count)';
  if f is null then return; end if;
  for e in select * from jsonb_array_elements(extra) loop
    if exists (select 1 from jsonb_array_elements(f) x where x->>'key' = e->>'key') then continue; end if;
    select min(i) into pos from jsonb_array_elements(f) with ordinality t(x, i) where x->>'key' = e->>'after';
    if pos is null then
      f := f || jsonb_build_array(e - 'after');
    else
      f := (select jsonb_agg(x order by i) from (
              select x, i::numeric as i from jsonb_array_elements(f) with ordinality t(x, i)
              union all select e - 'after', pos + 0.5) s);
    end if;
  end loop;
  update public.diagnostic_types set result_fields = f where name = 'CBC (complete blood count)';
end $$;

-- Emergency visits ask the history questions too (right after the reason for the visit).
update public.clinical_templates
   set sections = (select jsonb_agg(x order by i) from (
         select x, i::numeric i from jsonb_array_elements(sections) with ordinality t(x, i)
         union all select '"history"'::jsonb, (select i from jsonb_array_elements(sections) with ordinality t(x, i) where x = '"complaint"') + 0.5) s)
 where key = 'emergency' and not sections ? 'history' and sections ? 'complaint';
