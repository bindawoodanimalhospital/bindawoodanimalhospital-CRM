-- =============================================================================
-- Consultation: the patient's condition on the day (Stable / Fair / Poor / Critical), shown on the record's
-- Details line; and "Gastrointestinal" on the routine examination list (both reference records use it).
-- =============================================================================

alter table public.consultations add column patient_condition text
  check (patient_condition is null or length(patient_condition) <= 60);
comment on column public.consultations.patient_condition is 'Condition on the day: Stable, Fair, Poor, Critical (or the doctor''s own word).';

update public.clinical_templates
   set exam_prompts = (select jsonb_agg(x order by i) from (
         select x, i::numeric i from jsonb_array_elements(exam_prompts) with ordinality t(x, i)
         union all select '"Gastrointestinal"'::jsonb,
           coalesce((select i from jsonb_array_elements(exam_prompts) with ordinality t(x, i) where x = '"Abdomen"'), 1000) + 0.5) s)
 where key = 'routine' and not exam_prompts ? 'Gastrointestinal';
