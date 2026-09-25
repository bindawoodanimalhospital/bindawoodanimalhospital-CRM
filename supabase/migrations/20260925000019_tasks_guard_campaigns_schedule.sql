-- =============================================================================
-- Phase 5 — Task guard, promotional campaigns (opt-in only), and the reminder schedule
-- =============================================================================

-- The person a task is assigned to can update its status / outcome and comment, but can't
-- quietly move the deadline or hand it to someone else (that would hide it from "overdue").
create or replace function private.guard_task()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated'
     and (new.due_at is distinct from old.due_at or new.assigned_to is distinct from old.assigned_to or new.title is distinct from old.title)
     and old.created_by is distinct from (select auth.uid())
     and not private.has_permission('tasks.view_all') then
    raise exception 'only the person who created the task (or a manager) can change its deadline or who it''s for' using errcode = '42501';
  end if;
  if new.due_at is distinct from old.due_at and old.due_at is not null then
    insert into public.task_comments (task_id, body, created_by)
    values (new.id, 'Deadline changed from ' || to_char(old.due_at at time zone 'Asia/Karachi', 'DD Mon HH12:MI AM')
                    || ' to ' || coalesce(to_char(new.due_at at time zone 'Asia/Karachi', 'DD Mon HH12:MI AM'), 'none'), (select auth.uid()));
  end if;
  return new;
end $$;
create trigger tasks_guard before update on public.tasks for each row execute function private.guard_task();

-- -----------------------------------------------------------------------------
-- Campaigns (spec §21: promotional messages only with opt-in)
-- -----------------------------------------------------------------------------
create table public.campaigns (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  audience      text not null check (audience in ('birthdays_this_month', 'inactive_6_months')),
  template_key  text not null,
  message_count int not null default 0,
  created_by    uuid references public.staff (id) default auth.uid(),
  created_at    timestamptz not null default now()
);
alter table public.messages add constraint messages_campaign_fk foreign key (campaign_id) references public.campaigns (id);

/** How many opted-in customers a campaign would reach (preview before creating). */
create or replace function public.campaign_audience(p_audience text)
returns table (customer_id uuid, pet_id uuid, owner text, pet text, phone text, language text)
language sql stable security definer set search_path = '' as $$
  select c.id, p.id, c.full_name, p.name, coalesce(c.whatsapp, c.phone), c.preferred_language
  from public.customers c
  join public.pet_owners po on po.customer_id = c.id and po.is_primary
  join public.pets p on p.id = po.pet_id and p.status = 'active'
  where private.has_permission('crm.campaigns')
    and c.status = 'active' and c.marketing_opt_in                     -- opted-in only, always
    and case p_audience
      when 'birthdays_this_month' then p.date_of_birth is not null and not p.dob_is_estimate
        and extract(month from p.date_of_birth) = extract(month from private.clinic_today())
      when 'inactive_6_months' then not exists (
        select 1 from public.visits v where v.pet_id = p.id and v.checked_in_at > now() - interval '6 months')
        and exists (select 1 from public.visits v where v.pet_id = p.id)
      else false end;
$$;

create or replace function public.create_campaign(p_name text, p_audience text, p_template text)
returns int language plpgsql security definer set search_path = '' as $$
declare cid uuid; n int; clinic text := coalesce((select value ->> 'name' from public.system_settings where key = 'clinic.profile'), 'Bin Dawood Animal Hospital');
begin
  if not private.has_permission('crm.campaigns') then raise exception 'permission denied: crm.campaigns' using errcode = '42501'; end if;
  if not exists (select 1 from public.message_templates where key = p_template and is_promotional) then
    raise exception 'choose a promotional template';
  end if;
  insert into public.campaigns (name, audience, template_key) values (coalesce(nullif(trim(p_name), ''), p_template), p_audience, p_template) returning id into cid;
  insert into public.messages (channel, status, customer_id, to_phone, template_key, language, body, is_promotional, campaign_id, scheduled_for, created_by)
  select 'whatsapp', 'to_send', a.customer_id, a.phone, p_template, a.language,
         private.render_template(coalesce(t.body, e.body), jsonb_build_object('owner', a.owner, 'pet', a.pet, 'clinic', clinic)),
         true, cid, private.clinic_today(), (select auth.uid())
  from public.campaign_audience(p_audience) a
  left join public.message_templates t on t.key = p_template and t.language = a.language
  left join public.message_templates e on e.key = p_template and e.language = 'en';
  get diagnostics n = row_count;
  update public.campaigns set message_count = n where id = cid;
  return n;
end $$;

revoke execute on function public.campaign_audience(text) from public, anon;
revoke execute on function public.create_campaign(text, text, text) from public, anon;
grant execute on function public.campaign_audience(text) to authenticated;
grant execute on function public.create_campaign(text, text, text) to authenticated;

alter table public.campaigns enable row level security;
create policy campaigns_select on public.campaigns for select to authenticated using ((select private.has_permission('crm.view')));
create trigger audit_campaigns after insert on public.campaigns for each row execute function private.audit_row();

-- -----------------------------------------------------------------------------
-- Schedule: run the engine every 30 minutes (idempotent — safe to run often).
-- -----------------------------------------------------------------------------
create extension if not exists pg_cron;
select cron.schedule('bdah-reminders', '*/30 * * * *', $cron$select private.run_reminders()$cron$);
