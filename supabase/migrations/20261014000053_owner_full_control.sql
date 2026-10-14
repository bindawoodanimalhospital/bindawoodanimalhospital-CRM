-- =============================================================================
-- The owner has full control.
--  * The Owner role always has every permission — including any added in future — whatever
--    is ticked in role_permissions.
--  * The owner decides who sees contact details and who can delete records: the locks from
--    045/049 that refused customers.contact / customers.delete / pets.delete for other roles
--    are removed. These stay owner-only by default until he ticks them for a role in
--    "Who can do what".
-- =============================================================================

create or replace function private.has_permission(perm text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.staff s
    join public.staff_roles sr on sr.staff_id = s.id
    left join public.roles r on r.id = sr.role_id
    where s.id = (select auth.uid())
      and s.is_active
      and sr.valid_from <= now()
      and (sr.valid_until is null or sr.valid_until > now())
      and (r.key = 'owner'
           or exists (select 1 from public.role_permissions rp where rp.role_id = sr.role_id and rp.permission_key = perm))
  );
$$;

drop trigger role_permissions_contact_owner_only on public.role_permissions;
drop function private.contact_owner_only();

-- Keep the Owner role's own grants complete too (the screens list them).
insert into public.role_permissions (role_id, permission_key)
select r.id, p.key from public.roles r cross join public.permissions p where r.key = 'owner'
on conflict do nothing;

update public.permissions set label = 'See & edit phone numbers and email',
  description = 'Pet owners'' phone numbers, WhatsApp and email. Owner only by default — tick it for a role to share them.'
 where key = 'customers.contact';
update public.permissions set label = 'Delete pet owners added by mistake',
  description = 'Only records never used. Owner only by default.' where key = 'customers.delete';
update public.permissions set label = 'Delete pets added by mistake',
  description = 'Only records never used. Owner only by default.' where key = 'pets.delete';
