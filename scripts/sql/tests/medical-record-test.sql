-- Owner's medical record (migration 062): lab ranges, reviewed lock, problems, share links. Rolled back.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000ae101', 'mr-doc@mr.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000ae102', 'mr-recep@mr.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%@mr.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000ae101', id from public.roles where key = 'junior_doctor';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000ae102', id from public.roles where key = 'reception';
create temp table fx (k text primary key, v uuid) on commit drop;
grant all on fx to authenticated;
create or replace function pg_temp.g(key text) returns uuid language sql as $$ select v from fx where k = key $$;
create or replace function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
begin
  if not coalesce(ok, false) then raise exception 'FAIL: %', label; end if;
  raise notice 'OK %', label;
end $$;
create or replace function pg_temp.as_(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;

-- Lab test types carry dog / cat reference ranges
select pg_temp.check((select jsonb_array_length(result_fields) = 24
  and result_fields @> '[{"key":"wbc","group":"White cells","ranges":{"Cat":"5.5-19.5","Dog":"6.0-17.0"}}]' from public.diagnostic_types where name = 'CBC (complete blood count)'),
  'CBC has the full analyser panel with dog and cat ranges');
select pg_temp.check((select bool_and(f ? 'group') and count(*) = 20 and count(*) filter (where f ? 'ranges') >= 16
  from public.diagnostic_types, jsonb_array_elements(result_fields) f where name = 'Blood chemistry (LFT / RFT)'),
  'chemistry panel: 20 values in report groups, most with suggested ranges');

-- Fixtures: one owner with two cats, a visit each, a CBC for the first
with c as (insert into public.customers (full_name) values ('MR Owner') returning id) insert into fx select 'c', id from c;
with p as (insert into public.pets (name, species_id) select 'MR Hazel', id from public.species where name = 'Cat' returning id) insert into fx select 'p1', id from p;
with p as (insert into public.pets (name, species_id) select 'MR Other', id from public.species where name = 'Cat' returning id) insert into fx select 'p2', id from p;
insert into public.pet_owners (pet_id, customer_id, is_primary) values (pg_temp.g('p1'), pg_temp.g('c'), true), (pg_temp.g('p2'), pg_temp.g('c'), true);
with v as (insert into public.visits (pet_id, customer_id) values (pg_temp.g('p1'), pg_temp.g('c')) returning id) insert into fx select 'v1', id from v;
with v as (insert into public.visits (pet_id, customer_id) values (pg_temp.g('p2'), pg_temp.g('c')) returning id) insert into fx select 'v2', id from v;
with o as (insert into public.diagnostic_orders (pet_id, visit_id, type_id, ordered_by)
  select pg_temp.g('p1'), pg_temp.g('v1'), id, '00000000-0000-0000-0000-0000000ae101' from public.diagnostic_types where name = 'CBC (complete blood count)' returning id)
  insert into fx select 'dx', id from o;

set local role authenticated;
select pg_temp.as_('00000000-0000-0000-0000-0000000ae101');   -- junior doctor (no reopen right)

-- Problems
insert into fx select 'prob', public.set_visit_problem(pg_temp.g('v1'), null, '  Diarrhea ');
select pg_temp.check((select title = 'Diarrhea' and status = 'open' and pet_id = pg_temp.g('p1') from public.pet_problems where id = pg_temp.g('prob')),
  'a new problem is opened for the visit''s pet');
select pg_temp.check((select problem_id = pg_temp.g('prob') from public.visits where id = pg_temp.g('v1')), 'the visit is linked to the problem');
do $$ begin
  perform public.set_visit_problem(pg_temp.g('v2'), pg_temp.g('prob'), null);
  raise exception 'FAIL: linked a visit to another pet''s problem';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'OK a visit cannot join another pet''s problem (%)', sqlerrm;
end $$;
update public.pet_problems set status = 'resolved' where id = pg_temp.g('prob');
select pg_temp.check((select resolved_at is not null and resolved_by = '00000000-0000-0000-0000-0000000ae101' from public.pet_problems where id = pg_temp.g('prob')),
  'resolving records when and by whom');
update public.pet_problems set status = 'open' where id = pg_temp.g('prob');
select pg_temp.check((select resolved_at is null and resolved_by is null from public.pet_problems where id = pg_temp.g('prob')), 'reopening clears the resolution');
select pg_temp.check(public.set_visit_problem(pg_temp.g('v1'), null, null) is null, 'unlinking returns no problem');
select pg_temp.check((select problem_id is null from public.visits where id = pg_temp.g('v1')), 'a visit can be unlinked');

-- Lab result ranges and comments are locked with the result once reviewed
update public.diagnostic_orders set result_values = '{"wbc":"3.7"}', result_meta = '{"wbc":{"range":"5.5-19.5","comment":"Leukopenia"}}',
       external_lab = 'CADx', external_ref = '670016-25-10', status = 'reviewed'
 where id = pg_temp.g('dx');
do $$ begin
  update public.diagnostic_orders set result_meta = '{"wbc":{"range":"1-2"}}' where id = pg_temp.g('dx');
  raise exception 'FAIL: changed the range of a reviewed result';
exception when insufficient_privilege then raise notice 'OK reviewed ranges and comments are locked';
end $$;
do $$ begin
  update public.diagnostic_orders set external_ref = 'X-1' where id = pg_temp.g('dx');
  raise exception 'FAIL: changed the lab case number of a reviewed result';
exception when insufficient_privilege then raise notice 'OK the outside lab''s case number is locked too';
end $$;

-- Consultation: pulse, mentation and prognosis are saved like any other finding
with c as (insert into public.consultations (visit_id, pet_id, pulse_quality, mentation, prognosis)
  values (pg_temp.g('v1'), pg_temp.g('p1'), 'Strong and synchronous', 'QAR', 'Guarded') returning id) insert into fx select 'con', id from c;
select pg_temp.check((select mentation = 'QAR' and prognosis = 'Guarded' from public.consultations where id = pg_temp.g('con')),
  'consultations keep pulse quality, mentation and prognosis');

-- Share links
insert into public.record_shares (token_hash, pet_id, problem_id) values (encode(sha256('secret-1'::bytea), 'hex'), pg_temp.g('p1'), pg_temp.g('prob'));
insert into fx select 'share', id from public.record_shares where token_hash = encode(sha256('secret-1'::bytea), 'hex');
select pg_temp.check((select expires_at between now() + interval '29 days' and now() + interval '31 days' and created_by = '00000000-0000-0000-0000-0000000ae101'
  from public.record_shares where id = pg_temp.g('share')), 'a link expires after 30 days and records who made it');
do $$ begin
  update public.record_shares set pet_id = pg_temp.g('p2') where id = pg_temp.g('share');
  raise exception 'FAIL: pointed a link at another pet';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'OK a link cannot be pointed at another pet';
end $$;
do $$ begin
  update public.record_shares set expires_at = now() + interval '5 years' where id = pg_temp.g('share');
  raise exception 'FAIL: extended a link';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'OK a link''s expiry cannot be extended';
end $$;
update public.record_shares set revoked_at = now() where id = pg_temp.g('share');
select pg_temp.check((select revoked_by = '00000000-0000-0000-0000-0000000ae101' from public.record_shares where id = pg_temp.g('share')), 'cancelling records who cancelled');
do $$ begin
  update public.record_shares set revoked_at = null where id = pg_temp.g('share');
  raise exception 'FAIL: revived a cancelled link';
exception when others then
  if sqlerrm like 'FAIL%' then raise; end if;
  raise notice 'OK a cancelled link stays cancelled';
end $$;
do $$ begin
  insert into public.record_shares (token_hash, pet_id) values ('not-a-hash', pg_temp.g('p1'));
  raise exception 'FAIL: stored a plain token';
exception when check_violation then raise notice 'OK only a hash of the link secret can be stored';
end $$;

-- Reception has no clinical access: no problems, no links
select pg_temp.as_('00000000-0000-0000-0000-0000000ae102');
select pg_temp.check((select count(*) = 0 from public.pet_problems where pet_id = pg_temp.g('p1')), 'reception cannot see problems');
select pg_temp.check((select count(*) = 0 from public.record_shares where pet_id = pg_temp.g('p1')), 'reception cannot see share links');
do $$ begin
  perform public.set_visit_problem(pg_temp.g('v1'), null, 'Itching');
  raise exception 'FAIL: reception opened a problem';
exception when insufficient_privilege then raise notice 'OK reception cannot open problems';
end $$;
do $$ begin
  insert into public.record_shares (token_hash, pet_id) values (encode(sha256('secret-2'::bytea), 'hex'), pg_temp.g('p1'));
  raise exception 'FAIL: reception made a share link';
exception when insufficient_privilege then raise notice 'OK reception cannot make share links';
end $$;

reset role;
select 'ALL MEDICAL RECORD CHECKS PASSED' as result;
rollback;
