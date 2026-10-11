-- =============================================================================
-- Complete activity log: every action by every staff member, including minor ones.
--  * Sign-in / sign-out (from auth.sessions) with device and IP — previously not logged at all.
--  * Change history on the 19 tables that had none (weights, stock movements, messages, ward
--    notes, payment allocations, task comments, surgery events, purchase lines, …).
--  * Page views and prints, reported by the app through public.log_activity().
--  * Failed sign-in attempts are written by the server (service role) — see login/actions.ts.
-- Rows stay append-only: nobody can edit or delete them.
-- =============================================================================

-- 1) Sign-in / sign-out ------------------------------------------------------------------
create or replace function private.audit_session()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s record := coalesce(new, old);
begin
  -- only staff accounts (ignore stray sign-ups that never became staff)
  if not exists (select 1 from public.staff where id = s.user_id) then return null; end if;
  insert into public.audit_logs (actor_id, action, table_name, record_id, context)
  values (s.user_id,
          case when tg_op = 'INSERT' then 'auth.sign_in' else 'auth.sign_out' end,
          'sessions', s.id::text,
          jsonb_strip_nulls(jsonb_build_object('ip', host(s.ip), 'device', s.user_agent)));
  return null;
exception when others then
  return null;   -- logging must never stop anyone signing in or out
end $$;

drop trigger if exists audit_session_start on auth.sessions;
create trigger audit_session_start after insert on auth.sessions
  for each row execute function private.audit_session();
drop trigger if exists audit_session_end on auth.sessions;
create trigger audit_session_end after delete on auth.sessions
  for each row execute function private.audit_session();

-- 2) Change history on every business table that lacked it --------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'admission_notes', 'batch_costs', 'consultation_revisions', 'due_promises', 'inventory_locations',
    'inventory_movements', 'messages', 'payment_allocations', 'permissions', 'pet_weights',
    'product_batches', 'purchase_lines', 'reminder_events', 'stock_loan_return_lines', 'surgery_events',
    'surgery_revisions', 'task_comments', 'visit_status_events'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                      for each row execute function private.audit_row()', t);
    end if;
  end loop;
end $$;

-- 3) Page views and prints from the app ---------------------------------------------------
-- p_kind: 'view' or 'print'. Same person + same page within 30 seconds is logged once
-- (refreshes and double renders), so the log stays readable.
create or replace function public.log_activity(p_kind text, p_path text, p_title text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  kind  text := case when p_kind = 'print' then 'page.print' else 'page.view' end;
  path  text := left(coalesce(p_path, ''), 300);
begin
  if not private.is_active_staff() then return; end if;
  if path = '' or path !~ '^/' then return; end if;
  if exists (select 1 from public.audit_logs
              where actor_id = (select auth.uid()) and action = kind and record_id = path
                and occurred_at > now() - interval '30 seconds') then
    return;
  end if;
  insert into public.audit_logs (actor_id, action, table_name, record_id, context)
  values ((select auth.uid()), kind, null, path,
          case when nullif(trim(p_title), '') is not null then jsonb_build_object('title', left(p_title, 200)) end);
end $$;
revoke execute on function public.log_activity(text, text, text) from public, anon;
grant execute on function public.log_activity(text, text, text) to authenticated;

-- Fast "last seen" per person and filtering by kind of action.
create index if not exists audit_logs_action_time_idx on public.audit_logs (action, occurred_at desc);

-- 4) Last sign-in per staff member (for the owner's "who's been in" strip) ------------------
create or replace function public.staff_last_seen()
returns table (staff_id uuid, last_sign_in timestamptz, last_active timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.id,
         (select max(a.occurred_at) from public.audit_logs a where a.actor_id = s.id and a.action = 'auth.sign_in'),
         (select max(a.occurred_at) from public.audit_logs a where a.actor_id = s.id)
    from public.staff s
   where private.has_permission('audit.view');
$$;
revoke execute on function public.staff_last_seen() from public, anon;
grant execute on function public.staff_last_seen() to authenticated;

-- Sign-ins that happened before this migration: record the latest one per staff member.
insert into public.audit_logs (occurred_at, actor_id, action, table_name, context)
select u.last_sign_in_at, u.id, 'auth.sign_in', 'sessions', jsonb_build_object('note', 'last sign-in before the activity log covered sign-ins')
  from auth.users u join public.staff s on s.id = u.id
 where u.last_sign_in_at is not null
   and not exists (select 1 from public.audit_logs a where a.actor_id = u.id and a.action = 'auth.sign_in');
