-- Consultation history answers, treatments given and the extra CBC values (migration 064). Rolled back.
begin;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'OK %', label;
end $$;

select pg_temp.check((with k as (select f->>'key' key, i from public.diagnostic_types, jsonb_array_elements(result_fields) with ordinality t(f, i)
    where name = 'CBC (complete blood count)')
  select (select i from k where key = 'gran_abs') = (select i from k where key = 'bas_abs') + 1
     and (select i from k where key = 'gran_pct') = (select i from k where key = 'gran_abs') + 1
     and (select i from k where key = 'pdw') = (select i from k where key = 'mpv') + 1
     and (select i from k where key = 'pct') = (select max(i) from k)),
  'CBC gains granulocytes after basophils and PDW / PCT at the end of platelets');
select pg_temp.check((select count(*) = count(distinct f->>'key') and bool_and(not f ? 'after')
  from public.diagnostic_types, jsonb_array_elements(result_fields) f where name = 'CBC (complete blood count)'),
  'no duplicated keys and no helper fields left in the CBC panel');

select pg_temp.check((select sections ? 'history' and (select i from jsonb_array_elements(sections) with ordinality t(x, i) where x = '"history"')
  = (select i from jsonb_array_elements(sections) with ordinality t(x, i) where x = '"complaint"') + 1 from public.clinical_templates where key = 'emergency'),
  'emergency visits ask the history questions right after the reason for the visit');

create temp table fx (k text primary key, v uuid) on commit drop;
with c as (insert into public.customers (full_name) values ('HA Owner') returning id) insert into fx select 'c', id from c;
with p as (insert into public.pets (name, species_id) select 'HA Daisy', id from public.species where name = 'Dog' returning id) insert into fx select 'p', id from p;
with v as (insert into public.visits (pet_id, customer_id) select (select v from fx where k = 'p'), (select v from fx where k = 'c') returning id) insert into fx select 'v', id from v;
with c as (insert into public.consultations (visit_id, pet_id, history_answers, treatments_given)
  select (select v from fx where k = 'v'), (select v from fx where k = 'p'),
    '{"appetite": "Not eating", "vomiting": "Yes", "vomiting_detail": "White foam"}',
    '[{"what": "Ondansetron", "dose": "0.5 mg/kg", "route": "IV"}]' returning id) insert into fx select 'cons', id from c;
select pg_temp.check((select history_answers->>'vomiting_detail' = 'White foam' and treatments_given->0->>'route' = 'IV'
  from public.consultations where id = (select v from fx where k = 'cons')), 'answers and treatments are saved');

do $$ begin
  update public.consultations set treatments_given = '{"what": "x"}' where id = (select v from fx where k = 'cons');
  raise exception 'FAIL: treatments_given accepted an object';
exception when check_violation then raise notice 'OK treatments must be a list';
end $$;
do $$ begin
  update public.consultations set history_answers = '[]' where id = (select v from fx where k = 'cons');
  raise exception 'FAIL: history_answers accepted a list';
exception when check_violation then raise notice 'OK answers must be an object';
end $$;

-- Finalized: both lists are locked with the rest of the record.
-- (the unlock setting is named per install: crm.* on new clinics, bdah.* on Bin Dawood)
select set_config('crm.consultation_unlock', (select v from fx where k = 'cons')::text, true),
       set_config('bdah.consultation_unlock', (select v from fx where k = 'cons')::text, true);
update public.consultations set status = 'finalized', finalized_at = now() where id = (select v from fx where k = 'cons');
select set_config('crm.consultation_unlock', '', true), set_config('bdah.consultation_unlock', '', true);
do $$ begin
  update public.consultations set treatments_given = '[]' where id = (select v from fx where k = 'cons');
  raise exception 'FAIL: changed treatments on a finalized record';
exception when insufficient_privilege then raise notice 'OK finalized treatments are locked';
end $$;
do $$ begin
  update public.consultations set history_answers = '{}' where id = (select v from fx where k = 'cons');
  raise exception 'FAIL: changed answers on a finalized record';
exception when insufficient_privilege then raise notice 'OK finalized answers are locked';
end $$;
rollback;
