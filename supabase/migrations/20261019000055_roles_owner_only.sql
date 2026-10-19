-- =============================================================================
-- Staff roles are private to the owner.
--  * New permission roles.view — "See staff roles & who can do what". Owner only by default;
--    the owner can tick it for another role in "Who can do what" (no hard lock — see 053).
--  * Without it, staff can't see which roles they or anyone else hold, the role → permission
--    table, or role changes in the activity log. "staff.view" now means the staff list only.
--  * staff.manage (owner only by default) keeps working: assigning roles needs to read them.
--  * my_permissions() is unchanged — the app still needs to know what *I* may do, but it
--    returns permission keys only, never role names.
-- =============================================================================

insert into public.permissions (key, module, action, label, description, is_sensitive, sort_order)
values ('roles.view', 'staff', 'roles', 'See staff roles & who can do what',
        'Which role each staff member has, and what each role is allowed to do. Owner only by default.', true, 1102)
on conflict (key) do nothing;

insert into public.role_permissions (role_id, permission_key)
select id, 'roles.view' from public.roles where key = 'owner'
on conflict do nothing;

update public.permissions set label = 'View staff list',
  description = 'Names, titles and status of staff. Their roles are shown only with "See staff roles".'
 where key = 'staff.view';

-- Who holds which role ------------------------------------------------------------------------
drop policy staff_roles_select on public.staff_roles;
create policy staff_roles_select on public.staff_roles for select to authenticated
  using ((select private.has_permission('roles.view')) or (select private.has_permission('staff.manage')));

-- What each role may do -----------------------------------------------------------------------
drop policy role_permissions_select on public.role_permissions;
create policy role_permissions_select on public.role_permissions for select to authenticated
  using ((select private.has_permission('roles.view')) or (select private.has_permission('staff.manage')));

-- The list of roles itself (Reminder settings uses it to pick who gets alerts).
drop policy roles_select on public.roles;
create policy roles_select on public.roles for select to authenticated
  using ((select private.has_permission('roles.view')) or (select private.has_permission('staff.manage'))
         or (select private.has_permission('settings.manage')));

-- Role changes in the activity log ------------------------------------------------------------
drop policy audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
  using ((select private.has_permission('audit.view'))
         and (table_name not in ('customer_contacts', 'consent_contacts') or (select private.has_permission('customers.contact')))
         and (table_name not in ('staff_roles', 'role_permissions', 'roles') or (select private.has_permission('roles.view'))));
