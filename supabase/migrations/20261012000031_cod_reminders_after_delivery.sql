-- =============================================================================
-- Cash-on-delivery orders create a due promised for today, so the reminder engine queued a
-- "your payment is due" WhatsApp (and a staff alert) while the rider was still on the way.
-- Payment reminders for home-delivery orders now start only once the order is marked delivered
-- and is still unpaid. Same engine otherwise (generated from the live definition).
-- =============================================================================

CREATE OR REPLACE FUNCTION private.run_reminders()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  today date := private.clinic_today();
  clinic jsonb := coalesce((select value from public.system_settings where key = 'clinic.profile'), '{}'::jsonb);
  t record; rule public.reminder_rules; d int; max_off int; send_customer boolean; alert_staff boolean;
  lvl jsonb; i int; tpl public.message_templates; lang text; cust public.customers; vars jsonb; body text; link text;
  n_msgs int := 0; n_alerts int := 0; n_esc int := 0; n_closed int := 0;
begin
  -- 1) Current open items from every source.
  drop table if exists _open_sources;
  create temp table _open_sources (rule_key text, source_table text, source_id uuid, customer_id uuid, pet_id uuid,
    assigned_to uuid, title text, due_on date, extra jsonb) on commit drop;

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
  where du.status = 'open' and i.balance > 0
    -- cash on delivery: no "payment due" reminders while the order is still on its way
    and not (i.fulfilment = 'home_delivery' and i.delivery_status in ('pending', 'dispatched'));

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
end $function$;
