-- =============================================================================
-- More of what staff do, in the activity log:
--   page.view / page.print          pages opened and printed (as before)
--   contact.call / contact.whatsapp / contact.email   tapped a phone, WhatsApp or email link
--   file.download / link.external   downloaded a file / opened an outside website
--   data.copied                     copied text from a page (how much, from where — not the text)
--   search.used                     searched (what was typed, what was opened)
--   session.idle / session.active   went away (no activity for 10 min) / came back
--   session.hidden / session.closed switched away from / closed the CRM tab
--   access.denied                   tried to open a page they don't have permission for
-- Sign-in, sign-out and failed passwords come from migration 034.
-- =============================================================================
drop function if exists public.log_activity(text, text, text);

create or replace function public.log_activity(p_kind text, p_path text, p_title text default null, p_context jsonb default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_action text := case p_kind
    when 'view' then 'page.view'           when 'print' then 'page.print'
    when 'call' then 'contact.call'        when 'whatsapp' then 'contact.whatsapp'   when 'email' then 'contact.email'
    when 'download' then 'file.download'   when 'external' then 'link.external'      when 'copy' then 'data.copied'
    when 'search' then 'search.used'       when 'idle' then 'session.idle'           when 'active' then 'session.active'
    when 'hidden' then 'session.hidden'    when 'closed' then 'session.closed'       when 'denied' then 'access.denied'
  end;
  path text := left(coalesce(p_path, ''), 300);
  ctx  jsonb := coalesce(p_context, '{}'::jsonb);
begin
  if v_action is null or not private.is_active_staff() then return; end if;
  if path = '' or path !~ '^/' then return; end if;
  -- keep the context small and flat
  if pg_column_size(ctx) > 2000 or jsonb_typeof(ctx) <> 'object' then ctx := '{}'::jsonb; end if;
  if nullif(trim(p_title), '') is not null then ctx := ctx || jsonb_build_object('title', left(p_title, 200)); end if;
  -- the same thing on the same page within 30 seconds is one entry (refreshes, double clicks)
  if v_action in ('page.view', 'data.copied', 'session.hidden', 'access.denied') and exists (
       select 1 from public.audit_logs
        where actor_id = (select auth.uid()) and audit_logs.action = v_action and record_id = path
          and occurred_at > now() - interval '30 seconds') then
    return;
  end if;
  insert into public.audit_logs (actor_id, action, table_name, record_id, context)
  values ((select auth.uid()), v_action, null, path, nullif(ctx, '{}'::jsonb));
end $$;
revoke execute on function public.log_activity(text, text, text, jsonb) from public, anon;
grant execute on function public.log_activity(text, text, text, jsonb) to authenticated;
