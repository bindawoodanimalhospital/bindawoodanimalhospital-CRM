-- Staff roles are private to the owner. One transaction, rolled back.
begin;

insert into auth.users (id, email, instance_id, aud, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'owner7@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e2', 'doc7@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e3', 'mgr7@t.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
update public.staff set is_active = true where email like '%7@t.local';
insert into public.staff_roles (staff_id, role_id)
select u.id::uuid, r.id from (values ('00000000-0000-0000-0000-0000000000e1', 'owner'),
  ('00000000-0000-0000-0000-0000000000e2', 'senior_doctor'), ('00000000-0000-0000-0000-0000000000e3', 'manager')) u(id, key)
join public.roles r on r.key = u.key;

create temp table ctx (k text primary key, v uuid) on commit drop;
insert into ctx select 'owner_role', id from public.roles where key = 'owner';
grant all on ctx to authenticated;
create or replace function pg_temp.act(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
$$;
set local role authenticated;

-- ============================================================ owner sees everything
select pg_temp.act('00000000-0000-0000-0000-0000000000e1');
do $$ begin
  if (select count(*) from public.staff_roles where staff_id::text like '00000000-0000-0000-0000-0000000000e%') <> 3 then
    raise exception 'FAIL: owner cannot see staff roles';
  end if;
  if not exists (select 1 from public.role_permissions) or not exists (select 1 from public.roles) then
    raise exception 'FAIL: owner cannot see the role table';
  end if;
  if not exists (select 1 from public.my_permissions() p where p = 'roles.view') then
    raise exception 'FAIL: owner role lacks roles.view';
  end if;
  raise notice 'OK owner sees every role and permission';
end $$;

-- ============================================================ doctor: not even their own role
select pg_temp.act('00000000-0000-0000-0000-0000000000e2');
do $$ begin
  if exists (select 1 from public.staff_roles) then raise exception 'FAIL: doctor sees staff roles'; end if;
  if exists (select 1 from public.role_permissions) then raise exception 'FAIL: doctor sees role permissions'; end if;
  if exists (select 1 from public.roles) then raise exception 'FAIL: doctor sees the role list'; end if;
  raise notice 'OK staff cannot see which roles they or others hold';
  if not exists (select 1 from public.my_permissions() p where p = 'clinical.view') then
    raise exception 'FAIL: doctor lost their own permissions';
  end if;
  if exists (select 1 from public.my_permissions() p where p = 'roles.view') then raise exception 'FAIL: doctor has roles.view'; end if;
  if not exists (select 1 from public.staff where id = '00000000-0000-0000-0000-0000000000e1') then
    raise exception 'FAIL: doctor lost the staff list';
  end if;
  raise notice 'OK staff still get their own permissions and the staff list (no roles)';
end $$;
do $$ begin
  insert into public.staff_roles (staff_id, role_id) values ('00000000-0000-0000-0000-0000000000e2', (select v from ctx where k = 'owner_role'));
  raise exception 'FAIL: doctor gave themself a role';
exception when insufficient_privilege then raise notice 'OK staff cannot give themselves a role';
end $$;

-- ============================================================ manager with the activity log: no role history
select pg_temp.act('00000000-0000-0000-0000-0000000000e1');
insert into public.role_permissions (role_id, permission_key) select id, 'audit.view' from public.roles where key = 'manager' on conflict do nothing;
select pg_temp.act('00000000-0000-0000-0000-0000000000e3');
do $$ begin
  if not exists (select 1 from public.audit_logs) then raise exception 'FAIL: manager with audit.view sees no log at all'; end if;
  if exists (select 1 from public.audit_logs where table_name in ('staff_roles', 'role_permissions', 'roles')) then
    raise exception 'FAIL: role changes visible in the activity log';
  end if;
  raise notice 'OK activity log hides role changes without roles.view';
end $$;

-- ============================================================ owner can share it (no hard lock)
select pg_temp.act('00000000-0000-0000-0000-0000000000e1');
insert into public.role_permissions (role_id, permission_key) select id, 'roles.view' from public.roles where key = 'manager';
select pg_temp.act('00000000-0000-0000-0000-0000000000e3');
do $$ begin
  if (select count(*) from public.staff_roles where staff_id::text like '00000000-0000-0000-0000-0000000000e%') <> 3 then
    raise exception 'FAIL: owner could not share roles.view';
  end if;
  raise notice 'OK owner can choose to share "See staff roles" with another role';
end $$;

rollback;
