-- =============================================================================
-- Deleting pet owners and pets added by mistake — the hospital owner only.
--  * customers.delete / pets.delete can only belong to the Owner role (like customers.contact).
--  * Only records never used can be deleted: no visits, bills, payments, appointments, clinical
--    records, messages… (duplicates WITH history are merged instead). Deleting a pet owner also
--    deletes their pets that belong to nobody else (each must be unused too).
--  * Everyone else asks for removal: a removal request notifies the owner straight away and the
--    reminder is repeated through the day (10am, 1pm, 4pm, 7pm, 10pm) until he deletes the
--    record or declines the request.
--  * Every deletion and request is in the activity log.
-- =============================================================================

-- 1) Delete permissions are owner-only -------------------------------------------------------
delete from public.role_permissions rp using public.roles r
 where rp.role_id = r.id and rp.permission_key in ('customers.delete', 'pets.delete') and r.key <> 'owner';
insert into public.role_permissions (role_id, permission_key)
select r.id, k from public.roles r, unnest(array['customers.delete', 'pets.delete']) k where r.key = 'owner'
on conflict do nothing;
update public.permissions set label = 'Delete pet owners added by mistake (owner only)',
  description = 'Only records never used. Only the hospital owner — this can''t be given to any other role.' where key = 'customers.delete';
update public.permissions set label = 'Delete pets added by mistake (owner only)',
  description = 'Only records never used. Only the hospital owner — this can''t be given to any other role.' where key = 'pets.delete';

create or replace function private.contact_owner_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.permission_key in ('customers.contact', 'customers.delete', 'pets.delete')
     and (select key from public.roles where id = new.role_id) is distinct from 'owner' then
    raise exception 'this permission is for the hospital owner only — it can''t be given to another role'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- 2) What a record has been used for ---------------------------------------------------------
create or replace function private.pet_uses(p_pet uuid) returns text
language sql stable security definer set search_path = '' as $$
  select nullif(concat_ws(', ',
    case when exists (select 1 from public.visits where pet_id = p_pet) then 'visits' end,
    case when exists (select 1 from public.appointments where pet_id = p_pet) then 'appointments' end,
    case when exists (select 1 from public.consultations where pet_id = p_pet)
           or exists (select 1 from public.prescriptions where pet_id = p_pet)
           or exists (select 1 from public.diagnostic_orders where pet_id = p_pet) then 'medical records' end,
    case when exists (select 1 from public.vaccinations where pet_id = p_pet)
           or exists (select 1 from public.dewormings where pet_id = p_pet)
           or exists (select 1 from public.due_items where pet_id = p_pet) then 'vaccines / reminders' end,
    case when exists (select 1 from public.surgeries where pet_id = p_pet)
           or exists (select 1 from public.admissions where pet_id = p_pet) then 'surgery / ward' end,
    case when exists (select 1 from public.invoices where pet_id = p_pet)
           or exists (select 1 from public.dues where pet_id = p_pet) then 'bills' end,
    case when exists (select 1 from public.documents where pet_id = p_pet) then 'documents' end,
    case when exists (select 1 from public.tasks where pet_id = p_pet)
           or exists (select 1 from public.reminder_tracks where pet_id = p_pet) then 'tasks / follow-ups' end), '');
$$;

create or replace function private.customer_uses(p_customer uuid) returns text
language sql stable security definer set search_path = '' as $$
  select nullif(concat_ws(', ',
    case when exists (select 1 from public.visits where customer_id = p_customer) then 'visits' end,
    case when exists (select 1 from public.appointments where customer_id = p_customer) then 'appointments' end,
    case when exists (select 1 from public.invoices where customer_id = p_customer)
           or exists (select 1 from public.payments where customer_id = p_customer)
           or exists (select 1 from public.dues where customer_id = p_customer) then 'bills / payments' end,
    case when exists (select 1 from public.surgeries where customer_id = p_customer)
           or exists (select 1 from public.admissions where customer_id = p_customer) then 'surgery / ward' end,
    case when exists (select 1 from public.messages where customer_id = p_customer) then 'messages' end,
    case when exists (select 1 from public.tasks where customer_id = p_customer)
           or exists (select 1 from public.reminder_tracks where customer_id = p_customer) then 'tasks / follow-ups' end,
    case when exists (select 1 from public.customers where merged_into_id = p_customer) then 'merged records' end), '');
$$;

-- Pets that would be left with no owner if this customer went (they are deleted with the customer).
create or replace function private.sole_pets(p_customer uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select po.pet_id from public.pet_owners po
   where po.customer_id = p_customer
     and not exists (select 1 from public.pet_owners o where o.pet_id = po.pet_id and o.customer_id <> p_customer);
$$;
revoke execute on function private.pet_uses(uuid), private.customer_uses(uuid), private.sole_pets(uuid) from public, anon, authenticated;

/** Why this record can't be deleted (null = it can). Owner-only; for the screens. */
create or replace function public.record_delete_blocker(p_kind text, p_id uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare r text; p record;
begin
  if p_kind = 'pet' then
    if not private.has_permission('pets.delete') then return 'not allowed'; end if;
    return private.pet_uses(p_id);
  elsif p_kind = 'customer' then
    if not private.has_permission('customers.delete') then return 'not allowed'; end if;
    r := private.customer_uses(p_id);
    if r is not null then return r; end if;
    for p in select pt.name, private.pet_uses(pt.id) uses from private.sole_pets(p_id) s join public.pets pt on pt.id = s
    loop
      if p.uses is not null then return format('their pet %s has %s', p.name, p.uses); end if;
    end loop;
    return null;
  end if;
  raise exception 'unknown record type';
end $$;
revoke execute on function public.record_delete_blocker(text, uuid) from public, anon;
grant execute on function public.record_delete_blocker(text, uuid) to authenticated;

-- 3) Removal requests ------------------------------------------------------------------------
create table public.removal_requests (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('customer', 'pet')),
  customer_id  uuid references public.customers (id) on delete set null,
  pet_id       uuid references public.pets (id) on delete set null,
  label        text not null,                        -- "Pet Moti (P-00034)" — kept after deletion
  link         text not null,
  reason       text,
  requested_by uuid not null references public.staff (id) default auth.uid(),
  created_at   timestamptz not null default now(),
  status       text not null default 'open' check (status in ('open', 'deleted', 'declined')),
  resolved_by  uuid references public.staff (id),
  resolved_at  timestamptz,
  note         text,
  reminders    int not null default 1,
  check ((kind = 'customer') = (customer_id is not null) or status <> 'open'),
  check ((kind = 'pet') = (pet_id is not null) or status <> 'open')
);
create unique index removal_requests_one_open on public.removal_requests (kind, coalesce(customer_id, pet_id)) where status = 'open';
alter table public.removal_requests enable row level security;
create policy removal_requests_select on public.removal_requests for select to authenticated
  using ((select private.is_active_staff()));
grant select on public.removal_requests to authenticated;
revoke all on public.removal_requests from anon;
create trigger audit_removal_requests after insert or update or delete on public.removal_requests
  for each row execute function private.audit_row();

create or replace function private.remind_owner_of_removal(p_req uuid, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare q public.removal_requests; who text;
begin
  select * into q from public.removal_requests where id = p_req and status = 'open';
  if not found then return; end if;
  select full_name into who from public.staff where id = q.requested_by;
  perform private.notify_role('owner', 'removal_request', 'warning',
    'Please remove: ' || q.label,
    concat_ws(' · ', 'Requested by ' || coalesce(who, 'staff'), nullif(q.reason, ''),
              case when q.reminders > 1 then 'reminder ' || q.reminders end),
    q.link, p_key);
end $$;

create or replace function public.request_removal(p_kind text, p_id uuid, p_reason text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_label text; v_link text; v_id uuid;
begin
  if not private.is_active_staff() then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_kind = 'pet' then
    if not private.has_permission('pets.view') then raise exception 'permission denied: pets.view' using errcode = '42501'; end if;
    select 'Pet ' || name || ' (' || code || ')' into v_label from public.pets where id = p_id;
    v_link := '/pets/' || p_id;
  elsif p_kind = 'customer' then
    if not private.has_permission('customers.view') then raise exception 'permission denied: customers.view' using errcode = '42501'; end if;
    select 'Pet owner ' || full_name || ' (' || code || ')' into v_label from public.customers where id = p_id;
    v_link := '/customers/' || p_id;
  else raise exception 'unknown record type';
  end if;
  if v_label is null then raise exception 'record not found'; end if;

  select id into v_id from public.removal_requests
   where status = 'open' and kind = p_kind and coalesce(customer_id, pet_id) = p_id;
  if found then
    -- Asked again: remind the owner again now.
    update public.removal_requests set reminders = reminders + 1,
      reason = coalesce(nullif(trim(p_reason), ''), reason) where id = v_id;
    perform private.remind_owner_of_removal(v_id, 'removal:' || v_id || ':ask:' || extract(epoch from now())::bigint);
    return v_id;
  end if;
  insert into public.removal_requests (kind, customer_id, pet_id, label, link, reason)
  values (p_kind, case when p_kind = 'customer' then p_id end, case when p_kind = 'pet' then p_id end,
          v_label, v_link, nullif(trim(p_reason), ''))
  returning id into v_id;
  perform private.remind_owner_of_removal(v_id, 'removal:' || v_id || ':new');
  return v_id;
end $$;
revoke execute on function public.request_removal(text, uuid, text) from public, anon;
grant execute on function public.request_removal(text, uuid, text) to authenticated;

create or replace function public.decline_removal(p_request uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_permission('customers.delete') or private.has_permission('pets.delete')) then
    raise exception 'only the hospital owner can decline a removal request' using errcode = '42501';
  end if;
  update public.removal_requests set status = 'declined', resolved_by = auth.uid(), resolved_at = now(),
    note = nullif(trim(p_note), '')
   where id = p_request and status = 'open';
  if not found then raise exception 'request not found or already handled'; end if;
end $$;
revoke execute on function public.decline_removal(uuid, text) from public, anon;
grant execute on function public.decline_removal(uuid, text) to authenticated;

-- Reminded again and again: 10am, 1pm, 4pm, 7pm and 10pm Pakistan time while still open.
create or replace function private.remind_open_removals() returns void
language plpgsql security definer set search_path = '' as $$
declare q record;
begin
  for q in select id from public.removal_requests where status = 'open' and created_at < now() - interval '1 hour' loop
    update public.removal_requests set reminders = reminders + 1 where id = q.id;
    perform private.remind_owner_of_removal(q.id,
      'removal:' || q.id || ':' || to_char(now() at time zone 'Asia/Karachi', 'YYYY-MM-DD-HH24'));
  end loop;
end $$;
select cron.schedule('bdah-removal-reminders', '0 5,8,11,14,17 * * *', 'select private.remind_open_removals()');

-- 4) Deleting --------------------------------------------------------------------------------
create or replace function private.close_requests(p_kind text, p_id uuid) returns void
language sql security definer set search_path = '' as $$
  update public.removal_requests set status = 'deleted', resolved_by = auth.uid(), resolved_at = now()
   where status = 'open' and kind = p_kind and coalesce(customer_id, pet_id) = p_id;
$$;

create or replace function public.delete_pet(p_pet uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare pt public.pets; uses text;
begin
  if not private.has_permission('pets.delete') then
    raise exception 'only the hospital owner can delete pets — ask Mr. Musab Bin Dawood' using errcode = '42501';
  end if;
  select * into pt from public.pets where id = p_pet for update;
  if not found then raise exception 'pet not found'; end if;
  uses := private.pet_uses(p_pet);
  if uses is not null then
    raise exception '% has % — it can''t be deleted', pt.name, uses using errcode = '23503';
  end if;
  perform private.close_requests('pet', p_pet);
  insert into public.audit_logs (actor_id, action, table_name, record_id, reason, context)
  values ((select auth.uid()), 'pet.deleted', 'pets', p_pet::text, nullif(trim(p_reason), ''),
          jsonb_build_object('name', pt.name, 'code', pt.code));
  delete from public.pets where id = p_pet;   -- owner links, weights and alerts go with it
end $$;

create or replace function public.delete_customer(p_customer uuid, p_reason text default null) returns int
language plpgsql security definer set search_path = '' as $$
declare c public.customers; blocker text; pets_gone int := 0; p uuid; pname text;
begin
  if not private.has_permission('customers.delete') then
    raise exception 'only the hospital owner can delete pet owners — ask Mr. Musab Bin Dawood' using errcode = '42501';
  end if;
  select * into c from public.customers where id = p_customer for update;
  if not found then raise exception 'pet owner not found'; end if;
  blocker := public.record_delete_blocker('customer', p_customer);
  if blocker is not null then
    raise exception '% has % — it can''t be deleted (a duplicate with history can be merged instead)', c.full_name, blocker
      using errcode = '23503';
  end if;
  for p in select * from private.sole_pets(p_customer) loop
    select name into pname from public.pets where id = p;
    perform private.close_requests('pet', p);
    insert into public.audit_logs (actor_id, action, table_name, record_id, reason, context)
    values ((select auth.uid()), 'pet.deleted', 'pets', p::text, 'Deleted with their owner ' || c.full_name,
            jsonb_build_object('name', pname));
    delete from public.pet_owners where pet_id = p;
    delete from public.pets where id = p;
    pets_gone := pets_gone + 1;
  end loop;
  delete from public.pet_owners where customer_id = p_customer;   -- shared pets just lose this owner
  perform private.close_requests('customer', p_customer);
  insert into public.audit_logs (actor_id, action, table_name, record_id, reason, context)
  values ((select auth.uid()), 'customer.deleted', 'customers', p_customer::text, nullif(trim(p_reason), ''),
          jsonb_build_object('name', c.full_name, 'code', c.code, 'pets_deleted', pets_gone));
  delete from public.customers where id = p_customer;   -- contact details go with it
  return pets_gone;
end $$;
revoke execute on function public.delete_pet(uuid, text), public.delete_customer(uuid, text) from public, anon;
grant execute on function public.delete_pet(uuid, text), public.delete_customer(uuid, text) to authenticated;
