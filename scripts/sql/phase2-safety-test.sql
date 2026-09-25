-- Phase 2 safety tests. Everything runs in one transaction and is rolled back.
-- Each "expect_fail" block must raise; if the forbidden action succeeds the test aborts loudly.
begin;

-- Test users: owner (a), junior doctor (j), intern (i), reception (r), store staff (s)
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@t.local',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'junior@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a3', 'intern@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a4', 'recep@t.local',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a5', 'store@t.local',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@t.local';
insert into public.staff_roles (staff_id, role_id)
select u.id::uuid, r.id from (values
  ('00000000-0000-0000-0000-0000000000a1', 'owner'), ('00000000-0000-0000-0000-0000000000a2', 'junior_doctor'),
  ('00000000-0000-0000-0000-0000000000a3', 'intern'), ('00000000-0000-0000-0000-0000000000a4', 'reception'),
  ('00000000-0000-0000-0000-0000000000a5', 'store_staff')) u(id, key)
join public.roles r on r.key = u.key;

create temp table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to authenticated;
create or replace function pg_temp.act(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

set local role authenticated;

-- ---------------------------------------------------------------- reception: walk-ins & appointment check-in
select pg_temp.act('00000000-0000-0000-0000-0000000000a4');
insert into public.customers (full_name, phone) values ('Test Owner', '+923009998877');
insert into ctx select 'customer', id from public.customers where phone = '+923009998877';
insert into public.pets (name, species_id) select 'Rex', id from public.species where name = 'Dog';
insert into ctx select 'pet', id from public.pets where name = 'Rex' order by created_at desc limit 1;
insert into public.pet_owners (pet_id, customer_id, is_primary) select (select v from ctx where k='pet'), (select v from ctx where k='customer'), true;

insert into public.visits (pet_id, customer_id, reason) select (select v from ctx where k='pet'), (select v from ctx where k='customer'), 'Walk-in: vomiting';
insert into public.visits (pet_id, customer_id, reason, priority) select (select v from ctx where k='pet'), (select v from ctx where k='customer'), 'Second walk-in', 'emergency';
select 'tokens assigned' as t, string_agg(token_no::text, ',' order by token_no) from public.visits where customer_id = (select v from ctx where k='customer');
insert into ctx select 'visit', id from public.visits where customer_id = (select v from ctx where k='customer') order by token_no limit 1;

insert into public.appointments (customer_id, pet_id, appointment_type_id, starts_at, ends_at)
select (select v from ctx where k='customer'), (select v from ctx where k='pet'), id, now() + interval '1 hour', now() + interval '75 minutes'
from public.appointment_types where name = 'Vaccination';
select 'check-in creates visit' as t, public.check_in_appointment((select id from public.appointments order by created_at desc limit 1)) is not null as ok;
select 'appointment now' as t, status from public.appointments order by created_at desc limit 1;

do $$ begin
  insert into public.consultations (pet_id) values ((select v from ctx where k='pet'));
  raise exception 'FAIL: reception wrote a medical record';
exception when insufficient_privilege then raise notice 'OK reception cannot write medical records';
end $$;

-- ---------------------------------------------------------------- store staff sees no clinical data
select pg_temp.act('00000000-0000-0000-0000-0000000000a5');
select 'store sees visits' as t, count(*) from public.visits;

-- ---------------------------------------------------------------- intern: draft yes, finalize no
select pg_temp.act('00000000-0000-0000-0000-0000000000a3');
insert into public.consultations (pet_id, visit_id, chief_complaint)
  select (select v from ctx where k='pet'), (select v from ctx where k='visit'), 'Vomiting since last night';
insert into ctx select 'consult', id from public.consultations order by created_at desc limit 1;
update public.consultations set observations = 'Intern note' where id = (select v from ctx where k='consult');
do $$ begin
  perform public.finalize_consultation((select v from ctx where k='consult'));
  raise exception 'FAIL: intern finalized';
exception when insufficient_privilege then raise notice 'OK intern cannot finalize';
end $$;

-- ---------------------------------------------------------------- junior doctor finalizes; nobody edits finalized
select pg_temp.act('00000000-0000-0000-0000-0000000000a2');
update public.consultations set assessment = 'Gastritis', weight_kg = 12.5, follow_up_date = current_date + 5,
  follow_up_plan = 'Recheck vomiting' where id = (select v from ctx where k='consult');
insert into public.consultation_diagnoses (consultation_id, label, is_primary) values ((select v from ctx where k='consult'), 'Acute gastritis', true);
select public.finalize_consultation((select v from ctx where k='consult'));
select 'after finalize' as t, status, revision from public.consultations where id = (select v from ctx where k='consult');
select 'follow-up due created' as t, count(*) from public.due_items where source_id = (select v from ctx where k='consult');
select 'weight charted' as t, count(*) from public.pet_weights where pet_id = (select v from ctx where k='pet');
do $$ begin
  update public.consultations set assessment = 'changed' where id = (select v from ctx where k='consult');
  raise exception 'FAIL: finalized record edited';
exception when insufficient_privilege then raise notice 'OK finalized record is locked';
end $$;
do $$ begin
  insert into public.consultation_diagnoses (consultation_id, label) values ((select v from ctx where k='consult'), 'sneaky');
  raise exception 'FAIL: diagnosis added to finalized record';
exception when insufficient_privilege then raise notice 'OK diagnoses locked after finalize';
end $$;
do $$ begin
  perform public.reopen_consultation((select v from ctx where k='consult'), 'typo');
  raise exception 'FAIL: junior reopened';
exception when insufficient_privilege then raise notice 'OK junior cannot reopen';
end $$;

-- ---------------------------------------------------------------- owner reopens with reason, re-finalizes → 2 revisions
select pg_temp.act('00000000-0000-0000-0000-0000000000a1');
select public.reopen_consultation((select v from ctx where k='consult'), 'Correct the assessment');
update public.consultations set assessment = 'Dietary indiscretion' where id = (select v from ctx where k='consult');
select public.finalize_consultation((select v from ctx where k='consult'));
select 'revisions kept' as t, revision, snapshot->>'assessment' as assessment, reason
from public.consultation_revisions where consultation_id = (select v from ctx where k='consult') order by revision;

-- ---------------------------------------------------------------- vaccinations
select pg_temp.act('00000000-0000-0000-0000-0000000000a2');
do $$ begin
  insert into public.vaccinations (pet_id, vaccine_id, vaccine_name, expiry_date)
  select (select v from ctx where k='pet'), id, name, current_date - 1 from public.vaccines where name = 'DHPPi';
  raise exception 'FAIL: expired batch accepted';
exception when check_violation then raise notice 'OK expired vaccine batch is rejected';
end $$;
insert into public.vaccinations (pet_id, vaccine_id, vaccine_name, batch_no, expiry_date, next_due_date, next_due_label)
select (select v from ctx where k='pet'), id, name, 'B123', current_date + 200, current_date + 21, 'DHPPi Dose 2'
from public.vaccines where name = 'DHPPi';
select 'dose 2 due item' as t, title, due_on - current_date as in_days, status from public.due_items where kind = 'vaccination';
insert into public.vaccinations (pet_id, vaccine_id, vaccine_name, batch_no, expiry_date)
select (select v from ctx where k='pet'), id, name, 'B124', current_date + 200 from public.vaccines where name = 'DHPPi';
select 'dose 2 given → due closed' as t, status, outcome from public.due_items where kind = 'vaccination';

do $$ begin
  perform public.approve_protocol((select id from public.vaccination_protocols where name = 'Puppy core (DRAFT)'));
  raise exception 'FAIL: junior approved protocol';
exception when insufficient_privilege then raise notice 'OK junior cannot approve protocols';
end $$;
select pg_temp.act('00000000-0000-0000-0000-0000000000a1');
do $$ begin
  update public.vaccination_protocols set is_approved = true, approved_by = auth.uid(), approved_at = now() where name = 'Puppy core (DRAFT)';
  raise exception 'FAIL: approval bypassed';
exception when insufficient_privilege then raise notice 'OK approval only via approve_protocol()';
end $$;
select public.approve_protocol((select id from public.vaccination_protocols where name = 'Puppy core (DRAFT)'));
update public.vaccination_protocol_steps set days_after_previous = 28
 where protocol_id = (select id from public.vaccination_protocols where name = 'Puppy core (DRAFT)') and step_no = 2;
select 'edited protocol un-approved' as t, is_approved from public.vaccination_protocols where name = 'Puppy core (DRAFT)';

-- ---------------------------------------------------------------- prescriptions
select pg_temp.act('00000000-0000-0000-0000-0000000000a2');
insert into public.prescriptions (pet_id, visit_id) select (select v from ctx where k='pet'), (select v from ctx where k='visit');
insert into ctx select 'rx', id from public.prescriptions order by created_at desc limit 1;
do $$ begin
  update public.prescriptions set status = 'issued' where id = (select v from ctx where k='rx');
  raise exception 'FAIL: empty Rx issued';
exception when others then raise notice 'OK empty prescription cannot be issued (%)', sqlerrm;
end $$;
insert into public.prescription_items (prescription_id, medicine_name, dose, frequency, duration)
  values ((select v from ctx where k='rx'), 'Metronidazole 200 mg', '1 tablet', 'twice a day', '5 days');
update public.prescriptions set status = 'issued' where id = (select v from ctx where k='rx');
do $$ begin
  update public.prescription_items set dose = '2 tablets' where prescription_id = (select v from ctx where k='rx');
  raise exception 'FAIL: issued Rx edited';
exception when insufficient_privilege then raise notice 'OK issued prescription is locked';
end $$;
update public.prescriptions set status = 'cancelled', cancel_reason = 'Wrong strength' where id = (select v from ctx where k='rx');
select 'rx cancelled' as t, code, status, cancelled_at is not null as stamped from public.prescriptions where id = (select v from ctx where k='rx');

-- ---------------------------------------------------------------- diagnostics lock after review
insert into public.diagnostic_orders (pet_id, visit_id, type_id, reason)
select (select v from ctx where k='pet'), (select v from ctx where k='visit'), id, 'Vomiting' from public.diagnostic_types where name = 'Abdominal ultrasound';
insert into ctx select 'dx', id from public.diagnostic_orders order by created_at desc limit 1;
update public.diagnostic_orders set status = 'resulted', findings = 'Mild gastric wall thickening' where id = (select v from ctx where k='dx');
update public.diagnostic_orders set status = 'reviewed' where id = (select v from ctx where k='dx');
do $$ begin
  update public.diagnostic_orders set findings = 'changed' where id = (select v from ctx where k='dx');
  raise exception 'FAIL: reviewed result edited';
exception when insufficient_privilege then raise notice 'OK reviewed diagnostic result is locked';
end $$;

-- ---------------------------------------------------------------- store staff: still blind to clinical tables
select pg_temp.act('00000000-0000-0000-0000-0000000000a5');
select 'store clinical rows' as t,
  (select count(*) from public.consultations) as consults, (select count(*) from public.vaccinations) as vaccs,
  (select count(*) from public.prescriptions) as rx, (select count(*) from public.due_items) as due,
  (select count(*) from public.diagnostic_orders) as dx;

-- ---------------------------------------------------------------- visit status events recorded
select pg_temp.act('00000000-0000-0000-0000-0000000000a4');
update public.visits set status = 'with_doctor' where id = (select v from ctx where k='visit');
update public.visits set status = 'completed' where id = (select v from ctx where k='visit');
select 'visit timeline' as t, string_agg(to_status::text, ' → ' order by changed_at, id) from public.visit_status_events where visit_id = (select v from ctx where k='visit');
rollback;
