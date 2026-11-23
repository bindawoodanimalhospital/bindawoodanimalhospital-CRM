-- Deleting pet owners / pets added by mistake: owner only, never-used only; others request removal
-- and the owner is reminded until it's handled (migration 049). Rolled back.
begin;
insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000ff101', 'dr-owner@dr.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000ff102', 'dr-recep@dr.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000ff103', 'dr-doc@dr.t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true, full_name = split_part(email, '@', 1) where email like '%@dr.t.local';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000ff101', id from public.roles where key = 'owner';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000ff102', id from public.roles where key = 'reception';
insert into public.staff_roles (staff_id, role_id) select '00000000-0000-0000-0000-0000000ff103', id from public.roles where key = 'senior_doctor';
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
create or replace function pg_temp.owner_notes() returns int language sql security definer as $$
  select count(*)::int from public.notifications where staff_id = '00000000-0000-0000-0000-0000000ff101' and kind = 'removal_request' $$;
set local role authenticated;

-- Reception registers a duplicate owner + pet by mistake, and a real client with a visit
select pg_temp.as_('00000000-0000-0000-0000-0000000ff102');
with c as (insert into public.customers (full_name) values ('DR Mistake Owner') returning id) insert into fx select 'cm', id from c;
with p as (insert into public.pets (name, species_id) select 'DR Mistake Pet', id from public.species order by sort_order limit 1 returning id) insert into fx select 'pm', id from p;
insert into public.pet_owners (pet_id, customer_id, is_primary) values (pg_temp.g('pm'), pg_temp.g('cm'), true);
with c as (insert into public.customers (full_name) values ('DR Real Client') returning id) insert into fx select 'cr', id from c;
with p as (insert into public.pets (name, species_id) select 'DR Real Pet', id from public.species order by sort_order limit 1 returning id) insert into fx select 'pr', id from p;
insert into public.pet_owners (pet_id, customer_id, is_primary) values (pg_temp.g('pr'), pg_temp.g('cr'), true);
insert into public.visits (pet_id, customer_id) values (pg_temp.g('pr'), pg_temp.g('cr'));
-- A spare pet with no owner link yet
with p as (insert into public.pets (name, species_id) select 'DR Loose Pet', id from public.species order by sort_order limit 1 returning id) insert into fx select 'pl', id from p;

-- Reception can't delete — they request removal; the owner is notified
do $$ begin
  perform public.delete_customer(pg_temp.g('cm'));
  raise exception 'FAIL: reception deleted a pet owner';
exception when insufficient_privilege then perform pg_temp.check(sqlerrm like '%Mr. Musab Bin Dawood%', 'reception cannot delete; told to ask Mr. Musab'); end $$;
do $$ begin
  perform public.delete_pet(pg_temp.g('pl'));
  raise exception 'FAIL: reception deleted a pet';
exception when insufficient_privilege then raise notice 'OK reception cannot delete a pet'; end $$;
select pg_temp.check(public.record_delete_blocker('customer', pg_temp.g('cm')) = 'not allowed', 'no Delete button for reception');
insert into fx select 'req', public.request_removal('customer', pg_temp.g('cm'), 'Registered twice by mistake');
select pg_temp.check((select status = 'open' and label like 'Pet owner DR Mistake Owner (%' and reason = 'Registered twice by mistake' from public.removal_requests where id = pg_temp.g('req')),
  'removal request saved, visible to staff');
select pg_temp.check(pg_temp.owner_notes() = 1, 'the owner is notified at once');
select pg_temp.check(public.request_removal('customer', pg_temp.g('cm')) = pg_temp.g('req'), 'asking again reuses the same request…');
select pg_temp.check(pg_temp.owner_notes() = 2 and (select reminders = 2 from public.removal_requests where id = pg_temp.g('req')), '…and reminds the owner again');
select pg_temp.as_('00000000-0000-0000-0000-0000000ff103');
select pg_temp.check((select count(*) = 1 from public.removal_requests where id = pg_temp.g('req')), 'doctors see the pending request too');
insert into fx select 'reqpl', public.request_removal('pet', pg_temp.g('pl'));
select pg_temp.check(pg_temp.owner_notes() = 3, 'a doctor can request removal too (owner notified)');
do $$ begin
  perform public.decline_removal(pg_temp.g('reqpl'));
  raise exception 'FAIL: doctor declined';
exception when insufficient_privilege then raise notice 'OK only the owner can decline'; end $$;

-- Reminders repeat through the day while open
reset role;
update public.removal_requests set created_at = now() - interval '2 hours' where id in (pg_temp.g('req'), pg_temp.g('reqpl'));
select private.remind_open_removals();
select pg_temp.check(pg_temp.owner_notes() = 5, 'scheduled reminder notifies the owner again for each open request');
select private.remind_open_removals();
select pg_temp.check(pg_temp.owner_notes() = 5, 'not twice in the same hour');
select pg_temp.check(exists (select 1 from cron.job where jobname = 'bdah-removal-reminders'), 'reminders are scheduled 5 times a day');
set local role authenticated;

-- The owner
select pg_temp.as_('00000000-0000-0000-0000-0000000ff101');
select pg_temp.check(public.record_delete_blocker('customer', pg_temp.g('cr')) like '%visits%', 'client with a visit: blocked, says why');
select pg_temp.check(public.record_delete_blocker('pet', pg_temp.g('pr')) like '%visits%', 'pet with a visit: blocked');
do $$ begin
  perform public.delete_customer(pg_temp.g('cr'));
  raise exception 'FAIL: deleted a client with history';
exception when foreign_key_violation then perform pg_temp.check(sqlerrm like '%merged instead%', 'owner told to merge a duplicate with history'); end $$;
select pg_temp.check(public.record_delete_blocker('customer', pg_temp.g('cm')) is null, 'mistake owner: Delete button shown');
select pg_temp.check(public.delete_customer(pg_temp.g('cm'), 'Duplicate') = 1, 'owner deletes the mistake owner (1 pet with them)');
select pg_temp.check(not exists (select 1 from public.customers where id = pg_temp.g('cm')) and not exists (select 1 from public.pets where id = pg_temp.g('pm')),
  'owner and their only pet are gone');
select pg_temp.check((select status = 'deleted' and label like 'Pet owner DR Mistake Owner%' from public.removal_requests where id = pg_temp.g('req')),
  'the request closes itself, label kept');
select public.decline_removal(pg_temp.g('reqpl'), 'Will be used for a booking');
select pg_temp.check((select status = 'declined' from public.removal_requests where id = pg_temp.g('reqpl')), 'owner can decline a request');
reset role;
update public.removal_requests set created_at = now() - interval '2 hours';
select private.remind_open_removals();
select pg_temp.check(pg_temp.owner_notes() = 5, 'no more reminders once handled');
set local role authenticated;
select pg_temp.as_('00000000-0000-0000-0000-0000000ff101');
select public.delete_pet(pg_temp.g('pl'), 'Test entry');
select pg_temp.check(not exists (select 1 from public.pets where id = pg_temp.g('pl')), 'owner deletes an unused pet');
reset role;
select pg_temp.check((select count(*) = 3 from public.audit_logs where action in ('customer.deleted', 'pet.deleted')
  and record_id in (pg_temp.g('cm')::text, pg_temp.g('pm')::text, pg_temp.g('pl')::text)), 'every deletion in the activity log');

-- The owner can let another role delete too
insert into public.role_permissions (role_id, permission_key) select id, 'customers.delete' from public.roles where key = 'reception';
set local role authenticated;
select pg_temp.as_('00000000-0000-0000-0000-0000000ff102');
select pg_temp.check(public.record_delete_blocker('customer', pg_temp.g('cr')) like '%visits%', 'owner gave reception the delete permission: it works for them');
reset role;
select 'ALL DELETE-RECORDS CHECKS PASSED' as result;
rollback;
