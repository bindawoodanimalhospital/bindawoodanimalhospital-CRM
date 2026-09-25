-- =============================================================================
-- Phase 5 — Reminders, escalation, messages, tasks & notifications (spec §21, §22, §31, §45, §48)
--
-- Principle (spec §53): unfinished business stays visible until a responsible person records an
-- outcome. The engine never closes anything itself — it only follows the source record:
--   due_items (vaccines / follow-ups) · dues (unpaid bills) · appointments · tasks.
-- When the source is resolved (dose given, bill paid, task done…), its reminders stop.
--
-- Customer messages are created in an outbox. With no WhatsApp provider configured they wait in
-- "Messages to send" for reception (one tap opens WhatsApp with the text, then "Mark sent").
-- A provider can later pick up rows with status 'queued' — the rest of the design doesn't change.
-- =============================================================================

alter table public.customers add column if not exists preferred_language text not null default 'ur'
  check (preferred_language in ('en', 'ur'));

-- -----------------------------------------------------------------------------
-- Rules (configurable without code)
-- -----------------------------------------------------------------------------
create table public.reminder_rules (
  key                  text primary key,
  label                text not null,
  is_active            boolean not null default true,
  -- Customer reminders: days relative to the due date (−3 = three days before, 0 = on the day, 7 = a week late)
  customer_offsets     int[] not null default '{}',
  customer_repeat_days int check (customer_repeat_days between 1 and 90),   -- keep reminding every N days after the last offset
  customer_template    text,
  -- Internal alerts to the responsible person
  staff_offsets        int[] not null default '{}',
  staff_repeat_days    int check (staff_repeat_days between 1 and 90),
  staff_role           text,                 -- who gets it when nobody is assigned (role key)
  -- Escalation ladder: [{"after_days":3,"role":"manager"},{"after_days":7,"role":"owner"}]
  escalation           jsonb not null default '[]'::jsonb,
  updated_at           timestamptz not null default now()
);

insert into public.reminder_rules (key, label, customer_offsets, customer_repeat_days, customer_template,
                                   staff_offsets, staff_repeat_days, staff_role, escalation) values
  ('vaccination_due', 'Vaccination due', '{-3,0,3,7}', 14, 'vaccination_due', '{0,3}', 7, 'reception',
   '[{"after_days":7,"role":"senior_doctor"},{"after_days":21,"role":"owner"}]'),
  ('follow_up_due', 'Follow-up / recheck due', '{-1,0,2}', 7, 'follow_up_due', '{0,2}', 3, 'reception',
   '[{"after_days":5,"role":"senior_doctor"},{"after_days":14,"role":"owner"}]'),
  ('payment_due', 'Unpaid bill (promised payment)', '{-1,0,1,3,7}', 7, 'payment_due', '{0,1,3}', 3, 'reception',
   '[{"after_days":3,"role":"manager"},{"after_days":7,"role":"owner"}]'),
  ('appointment', 'Appointment reminder', '{-1}', null, 'appointment_reminder', '{}', null, null, '[]'),
  ('task_overdue', 'Task overdue', '{}', null, null, '{0,1}', 1, 'manager',
   '[{"after_days":2,"role":"manager"},{"after_days":5,"role":"owner"}]');

-- -----------------------------------------------------------------------------
-- Message templates (English + Urdu). {placeholders} are filled by the engine.
-- -----------------------------------------------------------------------------
create table public.message_templates (
  key          text not null,
  language     text not null check (language in ('en', 'ur')),
  label        text not null,
  body         text not null,
  is_promotional boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (key, language)
);

insert into public.message_templates (key, language, label, body, is_promotional) values
  ('vaccination_due', 'en', 'Vaccination due', 'Assalam o Alaikum {owner}, this is {clinic}. {pet}''s {title} is due on {date}. Please reply or call {clinic_phone} to book a time. Thank you!', false),
  ('vaccination_due', 'ur', 'ویکسین کی یاد دہانی', 'السلام علیکم {owner}، {clinic} کی جانب سے یاد دہانی: {pet} کی {title} کی تاریخ {date} ہے۔ وقت طے کرنے کے لیے جواب دیں یا {clinic_phone} پر کال کریں۔ شکریہ!', false),
  ('follow_up_due', 'en', 'Follow-up due', 'Assalam o Alaikum {owner}, {clinic} here. {pet} is due for a check-up ({title}) on {date}. Please reply to book a time. Thank you!', false),
  ('follow_up_due', 'ur', 'معائنے کی یاد دہانی', 'السلام علیکم {owner}، {clinic} کی جانب سے: {pet} کا دوبارہ معائنہ ({title}) {date} کو ہونا ہے۔ وقت طے کرنے کے لیے جواب دیں۔ شکریہ!', false),
  ('payment_due', 'en', 'Payment reminder', 'Assalam o Alaikum {owner}, a gentle reminder from {clinic}: Rs. {amount} is due on bill {invoice} (promised {date}). You can pay at the clinic, by JazzCash/Easypaisa or bank transfer. Thank you!', false),
  ('payment_due', 'ur', 'ادائیگی کی یاد دہانی', 'السلام علیکم {owner}، {clinic} کی جانب سے یاد دہانی: بل {invoice} کے {amount} روپے واجب الادا ہیں (وعدہ {date})۔ آپ کلینک پر، جاز کیش/ایزی پیسہ یا بینک ٹرانسفر سے ادائیگی کر سکتے ہیں۔ شکریہ!', false),
  ('appointment_reminder', 'en', 'Appointment tomorrow', 'Assalam o Alaikum {owner}, reminder from {clinic}: {pet}''s appointment is on {date} at {time}. Reply if you need to change it. Thank you!', false),
  ('appointment_reminder', 'ur', 'کل کی اپوائنٹمنٹ', 'السلام علیکم {owner}، {clinic} کی جانب سے یاد دہانی: {pet} کی اپوائنٹمنٹ {date} کو {time} بجے ہے۔ تبدیلی کے لیے جواب دیں۔ شکریہ!', false),
  ('pet_birthday', 'en', 'Pet birthday', 'Happy birthday to {pet}! 🎉 Warm wishes from everyone at {clinic}.', true),
  ('pet_birthday', 'ur', 'سالگرہ مبارک', '{pet} کو سالگرہ مبارک! 🎉 {clinic} کی پوری ٹیم کی جانب سے نیک تمنائیں۔', true),
  ('we_miss_you', 'en', 'We miss you', 'Assalam o Alaikum {owner}, it''s been a while since {pet}''s last visit to {clinic}. A yearly check-up keeps pets healthy — reply to book a time.', true),
  ('we_miss_you', 'ur', 'آپ کی کمی محسوس ہوئی', 'السلام علیکم {owner}، {pet} کو {clinic} آئے کافی عرصہ ہو گیا ہے۔ سالانہ معائنہ پالتو جانوروں کی صحت کے لیے ضروری ہے — وقت طے کرنے کے لیے جواب دیں۔', true);

create or replace function private.render_template(p_body text, p_vars jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare k text; r text := p_body;
begin
  for k in select jsonb_object_keys(p_vars) loop
    r := replace(r, '{' || k || '}', coalesce(p_vars ->> k, ''));
  end loop;
  return r;
end $$;

-- -----------------------------------------------------------------------------
-- Tasks (spec §22)
-- -----------------------------------------------------------------------------
create table public.tasks (
  id            uuid primary key default gen_random_uuid(),
  title         text not null check (length(trim(title)) > 1),
  details       text,
  assigned_to   uuid references public.staff (id),
  priority      text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status        text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  due_at        timestamptz,
  customer_id   uuid references public.customers (id),
  pet_id        uuid references public.pets (id),
  visit_id      uuid references public.visits (id),
  surgery_id    uuid references public.surgeries (id),
  admission_id  uuid references public.admissions (id),
  invoice_id    uuid references public.invoices (id),
  outcome       text,
  completed_at  timestamptz,
  completed_by  uuid references public.staff (id),
  created_by    uuid references public.staff (id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (status <> 'done' or coalesce(trim(outcome), '') <> ''),         -- "done" needs what was done
  check (status <> 'cancelled' or coalesce(trim(outcome), '') <> '')
);
create index tasks_open_idx on public.tasks (assigned_to, due_at) where status in ('open', 'in_progress');

create table public.task_comments (
  id          bigint generated always as identity primary key,
  task_id     uuid not null references public.tasks (id) on delete cascade,
  body        text not null check (length(trim(body)) > 0),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);

create or replace function private.task_stamps()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status in ('done', 'cancelled') and old.status not in ('done', 'cancelled') then
    new.completed_at := now(); new.completed_by := (select auth.uid());
  elsif new.status not in ('done', 'cancelled') then
    new.completed_at := null; new.completed_by := null;
  end if;
  return new;
end $$;
create trigger tasks_stamps before update on public.tasks for each row execute function private.task_stamps();
create trigger tasks_updated_at before update on public.tasks for each row execute function private.set_updated_at();

-- -----------------------------------------------------------------------------
-- Messages (outbox + communication history — spec §21)
-- -----------------------------------------------------------------------------
create table public.messages (
  id                  uuid primary key default gen_random_uuid(),
  direction           text not null default 'out' check (direction in ('out', 'in')),
  channel             text not null check (channel in ('whatsapp', 'sms', 'call', 'email', 'in_person')),
  status              text not null default 'to_send'
                        check (status in ('to_send', 'queued', 'sent', 'delivered', 'failed', 'not_reached', 'cancelled', 'logged')),
  customer_id         uuid references public.customers (id),
  to_phone            text,
  template_key        text,
  language            text,
  body                text,
  is_promotional      boolean not null default false,
  source_table        text,
  source_id           uuid,
  track_id            uuid,
  scheduled_for       date,
  campaign_id         uuid,
  sent_at             timestamptz,
  sent_by             uuid references public.staff (id),
  outcome_note        text,
  provider            text,
  provider_message_id text,
  error               text,
  created_by          uuid references public.staff (id),
  created_at          timestamptz not null default now()
);
create index messages_queue_idx on public.messages (status, scheduled_for) where status in ('to_send', 'queued');
create index messages_customer_idx on public.messages (customer_id, created_at desc);
create unique index messages_one_per_track_day on public.messages (track_id, scheduled_for) where track_id is not null;

-- -----------------------------------------------------------------------------
-- Reminder tracks: engine state for each open source item
-- -----------------------------------------------------------------------------
create table public.reminder_tracks (
  id                   uuid primary key default gen_random_uuid(),
  rule_key             text not null references public.reminder_rules (key),
  source_table         text not null,
  source_id            uuid not null,
  customer_id          uuid references public.customers (id),
  pet_id               uuid references public.pets (id),
  assigned_to          uuid references public.staff (id),
  title                text not null,
  due_on               date not null,
  escalation_level     int not null default 0,
  escalated_at         timestamptz,
  paused_until         date,
  pause_reason         text,
  paused_by            uuid references public.staff (id),
  customer_msgs        int not null default 0,
  last_customer_msg_on date,
  last_staff_alert_on  date,
  closed_at            timestamptz,
  created_at           timestamptz not null default now(),
  unique (source_table, source_id),
  check (paused_until is null or coalesce(trim(pause_reason), '') <> '')
);
create index reminder_tracks_open_idx on public.reminder_tracks (due_on) where closed_at is null;

create table public.reminder_events (
  id          bigint generated always as identity primary key,
  track_id    uuid not null references public.reminder_tracks (id) on delete cascade,
  kind        text not null check (kind in ('customer_message', 'staff_alert', 'escalated', 'paused', 'resumed', 'closed')),
  detail      jsonb not null default '{}'::jsonb,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index reminder_events_track_idx on public.reminder_events (track_id, created_at);

-- -----------------------------------------------------------------------------
-- Staff notifications (inbox). Alerts themselves live on the source records.
-- -----------------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references public.staff (id) on delete cascade,
  kind        text not null,
  severity    text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  title       text not null,
  body        text,
  link        text,
  dedupe_key  text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  unique (staff_id, dedupe_key)
);
create index notifications_inbox_idx on public.notifications (staff_id, created_at desc);

create or replace function private.notify(p_staff uuid, p_kind text, p_severity text, p_title text, p_body text, p_link text, p_key text)
returns void language sql security definer set search_path = '' as $$
  insert into public.notifications (staff_id, kind, severity, title, body, link, dedupe_key)
  select p_staff, p_kind, p_severity, p_title, p_body, p_link, p_key
  where exists (select 1 from public.staff where id = p_staff and is_active)
  on conflict (staff_id, dedupe_key) do nothing;
$$;

create or replace function private.notify_role(p_role text, p_kind text, p_severity text, p_title text, p_body text, p_link text, p_key text)
returns void language sql security definer set search_path = '' as $$
  select private.notify(sr.staff_id, p_kind, p_severity, p_title, p_body, p_link, p_key)
  from public.staff_roles sr join public.roles r on r.id = sr.role_id
  where r.key = p_role and (sr.valid_until is null or sr.valid_until > now()) and sr.valid_from <= now();
$$;

-- -----------------------------------------------------------------------------
-- The engine. Idempotent: running it many times a day never duplicates messages or alerts.
-- -----------------------------------------------------------------------------
create or replace function private.run_reminders()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  today date := private.clinic_today();
  clinic jsonb := coalesce((select value from public.system_settings where key = 'clinic.profile'), '{}'::jsonb);
  t record; rule public.reminder_rules; d int; max_off int; send_customer boolean; alert_staff boolean;
  lvl jsonb; i int; tpl public.message_templates; lang text; cust public.customers; vars jsonb; body text; link text;
  n_msgs int := 0; n_alerts int := 0; n_esc int := 0; n_closed int := 0;
begin
  -- 1) Current open items from every source.
  create temp table if not exists _open_sources (rule_key text, source_table text, source_id uuid, customer_id uuid, pet_id uuid,
    assigned_to uuid, title text, due_on date, extra jsonb) on commit drop;
  truncate _open_sources;

  insert into _open_sources
  select case when di.kind = 'vaccination' then 'vaccination_due' else 'follow_up_due' end, 'due_items', di.id,
         (select po.customer_id from public.pet_owners po where po.pet_id = di.pet_id order by po.is_primary desc limit 1),
         di.pet_id, di.assigned_to, di.title, di.due_on, '{}'::jsonb
  from public.due_items di join public.pets p on p.id = di.pet_id
  where di.status = 'pending' and p.status = 'active';

  insert into _open_sources
  select 'payment_due', 'dues', du.id, du.customer_id, du.pet_id, du.created_by, 'Unpaid bill ' || i.number, du.promised_date,
         jsonb_build_object('amount', to_char(i.balance, 'FM999,999,999'), 'invoice', i.number)
  from public.dues du join public.invoices i on i.id = du.invoice_id
  where du.status = 'open' and i.balance > 0;

  insert into _open_sources
  select 'appointment', 'appointments', a.id, a.customer_id, a.pet_id, a.doctor_id,
         coalesce(at.name, 'Appointment'), (a.starts_at at time zone 'Asia/Karachi')::date,
         jsonb_build_object('time', to_char(a.starts_at at time zone 'Asia/Karachi', 'HH12:MI AM'))
  from public.appointments a join public.appointment_types at on at.id = a.appointment_type_id
  where a.status in ('booked', 'confirmed') and (a.starts_at at time zone 'Asia/Karachi')::date >= today;

  insert into _open_sources
  select 'task_overdue', 'tasks', tk.id, tk.customer_id, tk.pet_id, tk.assigned_to, tk.title,
         (tk.due_at at time zone 'Asia/Karachi')::date, jsonb_build_object('priority', tk.priority)
  from public.tasks tk where tk.status in ('open', 'in_progress') and tk.due_at is not null;

  -- 2) Keep tracks in step with their sources.
  insert into public.reminder_tracks (rule_key, source_table, source_id, customer_id, pet_id, assigned_to, title, due_on)
  select rule_key, source_table, source_id, customer_id, pet_id, assigned_to, title, due_on from _open_sources
  on conflict (source_table, source_id) do update
    set due_on = excluded.due_on, title = excluded.title, assigned_to = excluded.assigned_to, customer_id = excluded.customer_id,
        closed_at = null,
        -- a new promised / due date restarts the escalation ladder
        escalation_level = case when public.reminder_tracks.due_on <> excluded.due_on then 0 else public.reminder_tracks.escalation_level end;

  with gone as (
    update public.reminder_tracks rt set closed_at = now()
    where rt.closed_at is null
      and not exists (select 1 from _open_sources s where s.source_table = rt.source_table and s.source_id = rt.source_id)
    returning rt.id)
  select count(*) into n_closed from gone;
  update public.messages m set status = 'cancelled', outcome_note = 'Resolved before sending'
   where m.status in ('to_send', 'queued') and m.track_id in (select id from public.reminder_tracks where closed_at is not null);

  -- 3) Reminders, alerts and escalation for each open track.
  for t in select rt.*, s.extra from public.reminder_tracks rt
           join _open_sources s on s.source_table = rt.source_table and s.source_id = rt.source_id
           where rt.closed_at is null loop
    select * into rule from public.reminder_rules where key = t.rule_key and is_active;
    continue when not found;
    continue when t.paused_until is not null and t.paused_until >= today;
    d := today - t.due_on;
    link := case t.source_table when 'dues' then '/billing/dues' when 'tasks' then '/tasks' when 'appointments' then '/appointments'
                 else '/due' end;

    -- Customer reminder
    max_off := (select max(x) from unnest(rule.customer_offsets) x);
    send_customer := t.customer_id is not null and coalesce(array_length(rule.customer_offsets, 1), 0) > 0
      and (d = any (rule.customer_offsets)
           or (rule.customer_repeat_days is not null and d > max_off and (d - max_off) % rule.customer_repeat_days = 0))
      and t.last_customer_msg_on is distinct from today;
    if send_customer then
      select * into cust from public.customers where id = t.customer_id;
      if found and cust.status = 'active' then
        lang := coalesce(cust.preferred_language, 'ur');
        select * into tpl from public.message_templates where key = rule.customer_template and language = lang;
        if not found then select * into tpl from public.message_templates where key = rule.customer_template and language = 'en'; end if;
        vars := jsonb_build_object(
          'owner', cust.full_name, 'pet', coalesce((select name from public.pets where id = t.pet_id), 'your pet'),
          'title', t.title, 'date', to_char(t.due_on, 'DD Mon YYYY'),
          'clinic', coalesce(nullif(clinic ->> 'name', ''), 'Bin Dawood Animal Hospital'),
          'clinic_phone', coalesce(nullif(clinic ->> 'phone', ''), '')) || coalesce(t.extra, '{}'::jsonb);
        body := private.render_template(coalesce(tpl.body, t.title), vars);
        insert into public.messages (channel, status, customer_id, to_phone, template_key, language, body, source_table, source_id, track_id, scheduled_for)
        values (case when cust.preferred_channel in ('sms', 'call', 'email') then cust.preferred_channel::text else 'whatsapp' end,
                'to_send', cust.id, coalesce(cust.whatsapp, cust.phone), rule.customer_template, lang, body,
                t.source_table, t.source_id, t.id, today)
        on conflict (track_id, scheduled_for) where track_id is not null do nothing;
        if found then
          n_msgs := n_msgs + 1;
          update public.reminder_tracks set customer_msgs = customer_msgs + 1, last_customer_msg_on = today where id = t.id;
          insert into public.reminder_events (track_id, kind, detail) values (t.id, 'customer_message', jsonb_build_object('days_from_due', d));
        end if;
      end if;
    end if;

    -- Internal alert to the responsible person (or the rule's role)
    max_off := (select max(x) from unnest(rule.staff_offsets) x);
    alert_staff := coalesce(array_length(rule.staff_offsets, 1), 0) > 0
      and (d = any (rule.staff_offsets) or (rule.staff_repeat_days is not null and d > max_off and (d - max_off) % rule.staff_repeat_days = 0))
      and t.last_staff_alert_on is distinct from today;
    if alert_staff then
      if t.assigned_to is not null then
        perform private.notify(t.assigned_to, t.rule_key, case when d > 0 then 'warning' else 'info' end, t.title,
          case when d > 0 then d || ' day(s) overdue' when d = 0 then 'Due today' else 'Due in ' || -d || ' day(s)' end, link, t.id || ':' || today);
      elsif rule.staff_role is not null then
        perform private.notify_role(rule.staff_role, t.rule_key, case when d > 0 then 'warning' else 'info' end, t.title,
          case when d > 0 then d || ' day(s) overdue' when d = 0 then 'Due today' else 'Due in ' || -d || ' day(s)' end, link, t.id || ':' || today);
      end if;
      update public.reminder_tracks set last_staff_alert_on = today where id = t.id;
      insert into public.reminder_events (track_id, kind, detail) values (t.id, 'staff_alert', jsonb_build_object('days_from_due', d));
      n_alerts := n_alerts + 1;
    end if;

    -- Escalation ladder
    i := 0;
    for lvl in select * from jsonb_array_elements(rule.escalation) loop
      i := i + 1;
      if d >= (lvl ->> 'after_days')::int and t.escalation_level < i then
        update public.reminder_tracks set escalation_level = i, escalated_at = now() where id = t.id;
        perform private.notify_role(lvl ->> 'role', 'escalation', 'critical', 'Escalated: ' || t.title,
          d || ' day(s) overdue with no outcome recorded', link, t.id || ':esc:' || i);
        insert into public.reminder_events (track_id, kind, detail) values (t.id, 'escalated', jsonb_build_object('level', i, 'role', lvl ->> 'role', 'days_from_due', d));
        t.escalation_level := i;
        n_esc := n_esc + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('messages', n_msgs, 'alerts', n_alerts, 'escalations', n_esc, 'closed', n_closed, 'ran_at', now());
end $$;

-- Manual "run now" for managers (the schedule also runs it automatically).
create or replace function public.run_reminders_now()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_permission('crm.manage') or private.has_permission('settings.manage')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return private.run_reminders();
end $$;

/** Pause / resume a reminder — always with a reason (audited via events). */
create or replace function public.pause_reminder(p_track uuid, p_until date, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_permission('crm.manage') or private.has_permission('clinical.create') or private.has_permission('billing.create')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  if p_until is not null and coalesce(trim(p_reason), '') = '' then raise exception 'a reason is required to pause reminders'; end if;
  if p_until is not null and p_until < private.clinic_today() then raise exception 'choose a future date'; end if;
  update public.reminder_tracks set paused_until = p_until, pause_reason = case when p_until is null then null else p_reason end,
         paused_by = case when p_until is null then null else (select auth.uid()) end
   where id = p_track and closed_at is null;
  if not found then raise exception 'reminder not found or already closed'; end if;
  insert into public.reminder_events (track_id, kind, detail, created_by)
  values (p_track, case when p_until is null then 'resumed' else 'paused' end, jsonb_build_object('until', p_until, 'reason', p_reason), (select auth.uid()));
end $$;

/** Reception marks an outbox message as sent / not reached. */
create or replace function public.mark_message(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('crm.manage') then raise exception 'permission denied' using errcode = '42501'; end if;
  if p_status not in ('sent', 'not_reached', 'cancelled') then raise exception 'invalid status'; end if;
  if p_status in ('not_reached', 'cancelled') and coalesce(trim(p_note), '') = '' then raise exception 'add a short note'; end if;
  update public.messages set status = p_status, outcome_note = nullif(trim(p_note), ''),
         sent_at = case when p_status = 'sent' then now() end, sent_by = (select auth.uid())
   where id = p_id and status in ('to_send', 'queued', 'failed');
  if not found then raise exception 'message already handled'; end if;
end $$;

do $$ declare f text; begin
  foreach f in array array['public.run_reminders_now()', 'public.pause_reminder(uuid, date, text)', 'public.mark_message(uuid, text, text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Owner / manager alert centre (spec §25, §50). Security invoker: each person only
-- sees rows their role can read. Each row links to the workflow where the outcome is recorded.
-- -----------------------------------------------------------------------------
create view public.open_alerts with (security_invoker = true) as
select 'payment'::text as kind,
       case when du.promised_date < private.clinic_today() then 'critical' when du.promised_date = private.clinic_today() then 'warning' else 'info' end as severity,
       c.full_name || ' — Rs. ' || to_char(i.balance, 'FM999,999,999') as title,
       'Bill ' || i.number || case when du.missed_promises > 0 then ' · ' || du.missed_promises || ' missed promise(s)' else '' end as subtitle,
       du.promised_date as due_on, private.clinic_today() - du.promised_date as days_overdue,
       du.created_by as responsible_id, '/billing/dues'::text as link, 'dues'::text as source_table, du.id as source_id, du.customer_id, du.pet_id
from public.dues du join public.invoices i on i.id = du.invoice_id join public.customers c on c.id = du.customer_id
where du.status = 'open' and i.balance > 0 and du.promised_date <= private.clinic_today()
union all
select 'due_approval', 'warning', c.full_name || ' — Rs. ' || to_char(i.balance, 'FM999,999,999'), 'Pay-later needs manager approval',
       du.created_at::date, 0, du.created_by, '/billing/dues?view=approval', 'dues', du.id, du.customer_id, du.pet_id
from public.dues du join public.invoices i on i.id = du.invoice_id join public.customers c on c.id = du.customer_id
where du.status = 'open' and du.approval_status = 'pending'
union all
select case when di.kind = 'vaccination' then 'vaccination' else 'follow_up' end,
       case when di.due_on < private.clinic_today() - 7 then 'critical' when di.due_on < private.clinic_today() then 'warning' else 'info' end,
       p.name || ' — ' || di.title, coalesce(c.full_name, ''), di.due_on, private.clinic_today() - di.due_on,
       di.assigned_to, '/due', 'due_items', di.id, c.id, p.id
from public.due_items di join public.pets p on p.id = di.pet_id
left join lateral (select c2.* from public.pet_owners po join public.customers c2 on c2.id = po.customer_id
                   where po.pet_id = p.id order by po.is_primary desc limit 1) c on true
where di.status = 'pending' and p.status = 'active' and di.due_on <= private.clinic_today()
union all
select 'diagnostic', case when d.status = 'resulted' then 'warning' else 'info' end,
       p.name || ' — ' || dt.name, case when d.status = 'resulted' then 'Result ready — needs doctor review' else 'Result pending' end,
       d.created_at::date, private.clinic_today() - d.created_at::date, d.ordered_by, '/visits/' || d.visit_id || '?tab=tests', 'diagnostic_orders', d.id, null::uuid, p.id
from public.diagnostic_orders d join public.pets p on p.id = d.pet_id join public.diagnostic_types dt on dt.id = d.type_id
where d.status = 'resulted' or (d.status in ('ordered', 'in_progress') and d.created_at < now() - interval '24 hours')
union all
select 'record', 'warning', p.name || ' — consultation not finalized', 'Draft since ' || to_char(co.created_at at time zone 'Asia/Karachi', 'DD Mon HH12:MI AM'),
       co.created_at::date, private.clinic_today() - co.created_at::date, co.doctor_id, '/visits/' || co.visit_id, 'consultations', co.id, null::uuid, p.id
from public.consultations co join public.pets p on p.id = co.pet_id
where co.status = 'draft' and co.created_at < now() - interval '12 hours' and co.visit_id is not null
union all
select 'task', case when tk.priority in ('high', 'urgent') or (tk.due_at at time zone 'Asia/Karachi')::date < private.clinic_today() - 1 then 'critical' else 'warning' end,
       tk.title, 'Task overdue', (tk.due_at at time zone 'Asia/Karachi')::date, private.clinic_today() - (tk.due_at at time zone 'Asia/Karachi')::date,
       tk.assigned_to, '/tasks', 'tasks', tk.id, tk.customer_id, tk.pet_id
from public.tasks tk where tk.status in ('open', 'in_progress') and tk.due_at < now()
union all
select 'stock', case when sl.expired_qty > 0 then 'critical' else 'warning' end, sl.name,
       case when sl.expired_qty > 0 then sl.expired_qty || ' expired on the shelf'
            when sl.reorder_level is not null and sl.usable_qty <= sl.reorder_level then 'Low: ' || sl.usable_qty || ' left'
            else 'Expires ' || to_char(sl.next_expiry, 'DD Mon YYYY') end,
       coalesce(sl.next_expiry, private.clinic_today()), 0, null::uuid, '/inventory/' || sl.item_id, 'catalog_items', sl.item_id, null::uuid, null::uuid
from public.stock_levels sl
where sl.expired_qty > 0 or (sl.reorder_level is not null and sl.usable_qty <= sl.reorder_level)
   or (sl.next_expiry is not null and sl.next_expiry <= private.clinic_today() + 30)
union all
select 'no_show', 'info', coalesce(p.name, c.full_name) || ' — missed appointment', c.full_name, (a.starts_at at time zone 'Asia/Karachi')::date, 0,
       a.created_by, '/appointments?date=' || to_char(a.starts_at at time zone 'Asia/Karachi', 'YYYY-MM-DD'), 'appointments', a.id, c.id, p.id
from public.appointments a join public.customers c on c.id = a.customer_id left join public.pets p on p.id = a.pet_id
where a.status = 'no_show' and a.starts_at > now() - interval '3 days';

-- -----------------------------------------------------------------------------
-- Audit + RLS
-- -----------------------------------------------------------------------------
create trigger audit_reminder_rules after insert or update or delete on public.reminder_rules for each row execute function private.audit_row();
create trigger audit_message_templates after insert or update or delete on public.message_templates for each row execute function private.audit_row();
create trigger audit_tasks after insert or update or delete on public.tasks for each row execute function private.audit_row();
create trigger audit_reminder_tracks_pause after update of paused_until on public.reminder_tracks for each row execute function private.audit_row();

alter table public.reminder_rules    enable row level security;
alter table public.message_templates enable row level security;
alter table public.tasks             enable row level security;
alter table public.task_comments     enable row level security;
alter table public.messages          enable row level security;
alter table public.reminder_tracks   enable row level security;
alter table public.reminder_events   enable row level security;
alter table public.notifications     enable row level security;

create policy reminder_rules_select on public.reminder_rules for select to authenticated using ((select private.is_active_staff()));
create policy reminder_rules_manage on public.reminder_rules for update to authenticated
  using ((select private.has_permission('settings.manage'))) with check ((select private.has_permission('settings.manage')));
create policy message_templates_select on public.message_templates for select to authenticated using ((select private.is_active_staff()));
create policy message_templates_manage on public.message_templates for all to authenticated
  using ((select private.has_permission('settings.manage')) or (select private.has_permission('crm.campaigns')))
  with check ((select private.has_permission('settings.manage')) or (select private.has_permission('crm.campaigns')));

-- Tasks: everyone sees tasks assigned to or created by them; tasks.view_all sees all.
create policy tasks_select on public.tasks for select to authenticated
  using (assigned_to = (select auth.uid()) or created_by = (select auth.uid()) or (select private.has_permission('tasks.view_all')));
create policy tasks_insert on public.tasks for insert to authenticated
  with check ((select private.has_permission('tasks.manage')) and created_by = (select auth.uid()));
create policy tasks_update on public.tasks for update to authenticated
  using (assigned_to = (select auth.uid()) or created_by = (select auth.uid()) or (select private.has_permission('tasks.view_all')))
  with check (assigned_to = (select auth.uid()) or created_by = (select auth.uid()) or (select private.has_permission('tasks.view_all')));
create policy task_comments_select on public.task_comments for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id));
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (created_by = (select auth.uid()) and exists (select 1 from public.tasks t where t.id = task_id));

create policy messages_select on public.messages for select to authenticated using ((select private.has_permission('crm.view')));
-- Manual logs (call made, reply received, custom message). Outbox rows come from the engine.
create policy messages_insert on public.messages for insert to authenticated
  with check ((select private.has_permission('crm.manage')) and track_id is null and created_by = (select auth.uid())
              and (not is_promotional or (select private.has_permission('crm.campaigns'))));

create policy reminder_tracks_select on public.reminder_tracks for select to authenticated
  using ((select private.has_permission('crm.view')) or (select private.has_permission('clinical.view')));
create policy reminder_events_select on public.reminder_events for select to authenticated
  using ((select private.has_permission('crm.view')) or (select private.has_permission('clinical.view')));

create policy notifications_select on public.notifications for select to authenticated using (staff_id = (select auth.uid()));
create policy notifications_update on public.notifications for update to authenticated
  using (staff_id = (select auth.uid())) with check (staff_id = (select auth.uid()));

-- Live badge for the inbox.
alter publication supabase_realtime add table public.notifications;
