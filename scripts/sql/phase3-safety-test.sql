-- Phase 3 safety tests (surgery & in-patient). One transaction, rolled back.
begin;

insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000000b1', 'owner3@t.local',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b2', 'junior3@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b3', 'intern3@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b4', 'recep3@t.local',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b5', 'store3@t.local',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%3@t.local';
insert into public.staff_roles (staff_id, role_id)
select u.id::uuid, r.id from (values
  ('00000000-0000-0000-0000-0000000000b1', 'owner'), ('00000000-0000-0000-0000-0000000000b2', 'junior_doctor'),
  ('00000000-0000-0000-0000-0000000000b3', 'intern'), ('00000000-0000-0000-0000-0000000000b4', 'reception'),
  ('00000000-0000-0000-0000-0000000000b5', 'store_staff')) u(id, key)
join public.roles r on r.key = u.key;

create temp table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to authenticated;
create or replace function pg_temp.act(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
create or replace function pg_temp.sx() returns uuid language sql as $$ select v from ctx where k = 'sx' $$;

set local role authenticated;

-- Setup: owner + two pets (reception)
select pg_temp.act('00000000-0000-0000-0000-0000000000b4');
insert into public.customers (full_name, phone) values ('Surgery Owner', '+923211112233');
insert into ctx select 'cust', id from public.customers where phone = '+923211112233';
insert into public.pets (name, species_id) select 'Bella', id from public.species where name = 'Dog';
insert into ctx select 'pet', id from public.pets where name = 'Bella' order by created_at desc limit 1;
insert into public.pets (name, species_id) select 'Kitty', id from public.species where name = 'Cat';
insert into ctx select 'pet2', id from public.pets where name = 'Kitty' order by created_at desc limit 1;
insert into public.pet_owners (pet_id, customer_id, is_primary) select (select v from ctx where k='pet'), (select v from ctx where k='cust'), true;
insert into public.pet_owners (pet_id, customer_id, is_primary) select (select v from ctx where k='pet2'), (select v from ctx where k='cust'), true;

do $$ begin
  insert into public.surgeries (pet_id, customer_id, procedure_name) values ((select v from ctx where k='pet'), (select v from ctx where k='cust'), 'Spay');
  raise exception 'FAIL: reception planned a surgery';
exception when insufficient_privilege then raise notice 'OK reception cannot plan surgery';
end $$;

-- ================================================================ SURGERY
select pg_temp.act('00000000-0000-0000-0000-0000000000b2');
insert into public.surgeries (pet_id, customer_id, procedure_name, indication, estimate_amount)
values ((select v from ctx where k='pet'), (select v from ctx where k='cust'), 'Spay (ovariohysterectomy)', 'Elective', 25000);
insert into ctx select 'sx', id from public.surgeries order by created_at desc limit 1;

do $$ begin
  update public.surgeries set status = 'in_surgery' where id = pg_temp.sx();
  raise exception 'FAIL: skipped straight to surgery';
exception when others then raise notice 'OK cannot jump from planned to in surgery (%)', sqlerrm;
end $$;

update public.surgeries set status = 'scheduled', scheduled_at = now() + interval '1 day' where id = pg_temp.sx();
update public.surgeries set status = 'pre_op' where id = pg_temp.sx();
do $$ begin
  update public.surgeries set status = 'in_surgery' where id = pg_temp.sx();
  raise exception 'FAIL: surgery started without consent';
exception when others then raise notice 'OK no consent + no pre-op check → cannot start (%)', left(sqlerrm, 60);
end $$;

-- Reception records consent
select pg_temp.act('00000000-0000-0000-0000-0000000000b4');
do $$ begin
  insert into public.surgery_consents (surgery_id, signed_by_name, method, consent_text, risks_explained, estimate_explained)
  values (pg_temp.sx(), 'Surgery Owner', 'signed_paper', 'text', false, true);
  raise exception 'FAIL: consent without risks explained';
exception when check_violation then raise notice 'OK consent requires risks and estimate explained';
end $$;
insert into public.surgery_consents (surgery_id, signed_by_name, relationship, method, consent_text, risks_explained, estimate_explained, estimate_amount)
values (pg_temp.sx(), 'Surgery Owner', 'Owner', 'signed_paper', 'I consent…', true, true, 25000);
do $$ begin
  update public.surgery_consents set signed_by_name = 'Someone else' where surgery_id = pg_temp.sx();
  raise exception 'FAIL: signed consent edited';
exception when insufficient_privilege then raise notice 'OK signed consent cannot be edited';
end $$;
do $$ begin
  update public.surgeries set status = 'in_surgery' where id = pg_temp.sx();
  raise exception 'FAIL: reception moved surgery';
exception when others then raise notice 'OK reception cannot change surgery stage';
end $$;

-- Doctor: consent ok but pre-op check missing
select pg_temp.act('00000000-0000-0000-0000-0000000000b2');
do $$ begin
  update public.surgeries set status = 'in_surgery' where id = pg_temp.sx();
  raise exception 'FAIL: started without pre-op check';
exception when others then raise notice 'OK consent alone is not enough — pre-op check required';
end $$;
update public.surgeries set preop_weight_kg = 18.2, asa_class = 1, fasting_confirmed = true, preop_checked_at = now() where id = pg_temp.sx();
update public.surgeries set status = 'in_surgery' where id = pg_temp.sx();
select 'surgery started' as t, status, procedure_start is not null as start_stamped, preop_checked_by is not null as checker_stamped from public.surgeries where id = pg_temp.sx();

-- Intern assists: monitoring yes, stage no
select pg_temp.act('00000000-0000-0000-0000-0000000000b3');
insert into public.surgery_events (surgery_id, kind, data) values (pg_temp.sx(), 'monitoring', '{"hr":110,"rr":16,"spo2":98}');
insert into public.surgery_consumables (surgery_id, item_name, quantity, unit) values (pg_temp.sx(), 'Vicryl 2-0', 2, 'packs');
do $$ begin
  update public.surgeries set status = 'recovery' where id = pg_temp.sx();
  raise exception 'FAIL: intern moved surgery';
exception when others then raise notice 'OK intern can monitor but not change stage';
end $$;

select pg_temp.act('00000000-0000-0000-0000-0000000000b2');
update public.surgeries set status = 'recovery', follow_up_date = current_date + 10 where id = pg_temp.sx();
do $$ begin
  update public.surgeries set status = 'discharged' where id = pg_temp.sx();
  raise exception 'FAIL: discharged without instructions';
exception when others then raise notice 'OK discharge needs written instructions';
end $$;
update public.surgeries set discharge_instructions = 'Cone for 10 days, no bath, come back for suture removal.' where id = pg_temp.sx();
update public.surgeries set status = 'discharged' where id = pg_temp.sx();
select 'post-op follow-up created' as t, title, due_on - current_date as in_days from public.due_items where source_id = pg_temp.sx();
do $$ begin
  update public.surgeries set complications = 'edited later' where id = pg_temp.sx();
  raise exception 'FAIL: closed surgery edited';
exception when insufficient_privilege then raise notice 'OK discharged surgery is locked';
end $$;
do $$ begin
  insert into public.surgery_consumables (surgery_id, item_name, quantity) values (pg_temp.sx(), 'late item', 1);
  raise exception 'FAIL: consumable added after discharge';
exception when insufficient_privilege then raise notice 'OK nothing can be added to a closed surgery';
end $$;
do $$ begin
  perform public.reopen_surgery(pg_temp.sx(), 'typo');
  raise exception 'FAIL: junior reopened surgery';
exception when insufficient_privilege then raise notice 'OK junior cannot reopen surgery';
end $$;
select pg_temp.act('00000000-0000-0000-0000-0000000000b1');
select public.reopen_surgery(pg_temp.sx(), 'Add missed complication note');
select 'reopened' as t, status, (select count(*) from public.surgery_revisions where surgery_id = pg_temp.sx()) as snapshots from public.surgeries where id = pg_temp.sx();

-- Emergency with override (no consent yet)
select pg_temp.act('00000000-0000-0000-0000-0000000000b2');
with s as (
  insert into public.surgeries (pet_id, customer_id, procedure_name, urgency)
  values ((select v from ctx where k='pet2'), (select v from ctx where k='cust'), 'Wound repair / suturing', 'emergency') returning id)
insert into ctx select 'sx2', id from s;
update public.surgeries set status = 'pre_op' where id = (select v from ctx where k='sx2');
do $$ begin
  update public.surgeries set status = 'in_surgery' where id = (select v from ctx where k='sx2');
  raise exception 'FAIL: emergency started without reason';
exception when others then raise notice 'OK emergency still needs a written override reason';
end $$;
update public.surgeries set status = 'in_surgery', emergency_override_reason = 'Severe bleeding, owner unreachable' where id = (select v from ctx where k='sx2');
select 'emergency override logged' as t, count(*) from public.surgery_events where surgery_id = (select v from ctx where k='sx2') and kind = 'override';

-- ================================================================ IN-PATIENT
insert into public.admissions (pet_id, customer_id, kennel_id, reason)
select (select v from ctx where k='pet'), (select v from ctx where k='cust'), id, 'Post-op observation' from public.kennels where name = 'Kennel 1';
insert into ctx select 'adm', id from public.admissions order by created_at desc limit 1;
do $$ begin
  insert into public.admissions (pet_id, customer_id, kennel_id, reason)
  select (select v from ctx where k='pet2'), (select v from ctx where k='cust'), id, 'x' from public.kennels where name = 'Kennel 1';
  raise exception 'FAIL: two pets in one kennel';
exception when unique_violation then raise notice 'OK one patient per kennel';
end $$;
do $$ begin
  insert into public.admissions (pet_id, customer_id, reason) values ((select v from ctx where k='pet'), (select v from ctx where k='cust'), 'again');
  raise exception 'FAIL: pet admitted twice';
exception when unique_violation then raise notice 'OK a pet can only have one open admission';
end $$;

select pg_temp.act('00000000-0000-0000-0000-0000000000b3');
do $$ begin
  insert into public.admission_orders (admission_id, kind, description, dose, every_hours) values ((select v from ctx where k='adm'), 'medication', 'Meloxicam', '1 ml', 24);
  raise exception 'FAIL: intern wrote a treatment order';
exception when insufficient_privilege then raise notice 'OK intern cannot write treatment orders';
end $$;

select pg_temp.act('00000000-0000-0000-0000-0000000000b2');
insert into public.admission_orders (admission_id, kind, description, dose, route, every_hours)
values ((select v from ctx where k='adm'), 'medication', 'Ceftriaxone', '0.9 ml', 'IV', 12);
insert into ctx select 'ord', id from public.admission_orders order by created_at desc limit 1;

select pg_temp.act('00000000-0000-0000-0000-0000000000b3');
insert into public.admission_administrations (order_id, admission_id, due_at, result)
values ((select v from ctx where k='ord'), (select v from ctx where k='adm'), date_trunc('hour', now()), 'given');
do $$ begin
  insert into public.admission_administrations (order_id, admission_id, due_at, result)
  values ((select v from ctx where k='ord'), (select v from ctx where k='adm'), date_trunc('hour', now()), 'given');
  raise exception 'FAIL: same dose recorded twice';
exception when unique_violation then raise notice 'OK the same dose slot cannot be recorded twice';
end $$;
do $$ begin
  insert into public.admission_administrations (order_id, admission_id, due_at, result)
  values ((select v from ctx where k='ord'), (select v from ctx where k='adm'), date_trunc('hour', now()) + interval '12 hours', 'skipped');
  raise exception 'FAIL: skipped without reason';
exception when check_violation then raise notice 'OK skipping a dose needs a reason';
end $$;
insert into public.admission_notes (admission_id, kind, vitals, note) values ((select v from ctx where k='adm'), 'vitals', '{"temp":38.6,"hr":96}', 'Eating a little');
do $$ begin
  update public.admissions set status = 'discharged', outcome = 'discharged_home', discharge_summary = 'ok' where id = (select v from ctx where k='adm');
  raise exception 'FAIL: intern discharged';
exception when insufficient_privilege then raise notice 'OK intern cannot discharge';
end $$;
update public.admissions set kennel_id = (select id from public.kennels where name = 'Kennel 2') where id = (select v from ctx where k='adm');
select 'intern moved kennel' as t, k.name from public.admissions a join public.kennels k on k.id = a.kennel_id where a.id = (select v from ctx where k='adm');

select pg_temp.act('00000000-0000-0000-0000-0000000000b2');
do $$ begin
  update public.admission_orders set dose = '2 ml' where id = (select v from ctx where k='ord');
  raise exception 'FAIL: order dose edited';
exception when insufficient_privilege then raise notice 'OK treatment orders cannot be edited (stop & rewrite)';
end $$;
do $$ begin
  update public.admissions set status = 'discharged', outcome = 'discharged_home' where id = (select v from ctx where k='adm');
  raise exception 'FAIL: discharged without summary';
exception when check_violation then raise notice 'OK discharge needs a summary';
end $$;
update public.admissions set status = 'discharged', outcome = 'discharged_home', discharge_summary = 'Recovered well.',
  discharge_instructions = 'Continue tablets', follow_up_date = current_date + 7 where id = (select v from ctx where k='adm');
select 'orders auto-stopped' as t, status, stop_reason from public.admission_orders where id = (select v from ctx where k='ord');
do $$ begin
  insert into public.admission_notes (admission_id, kind, note) values ((select v from ctx where k='adm'), 'progress', 'late');
  raise exception 'FAIL: note after discharge';
exception when insufficient_privilege then raise notice 'OK closed admission accepts no new entries';
end $$;

-- Store staff: blind to all of it
select pg_temp.act('00000000-0000-0000-0000-0000000000b5');
select 'store sees' as t, (select count(*) from public.surgeries) as surgeries, (select count(*) from public.admissions) as admissions,
  (select count(*) from public.surgery_consents) as consents;
rollback;
