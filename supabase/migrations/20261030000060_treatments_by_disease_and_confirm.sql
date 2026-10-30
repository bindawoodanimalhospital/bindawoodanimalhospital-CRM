-- =============================================================================
-- Deworming & vaccines, done properly (plan: docs/plans/deworming-vaccines-plan.md; decisions by
-- Dr. Musab 30 Oct 2026: doctor confirms billed treatments, adult deworming 3-monthly, yearly
-- boosters, fleas/ticks tracked separately).
--
-- 1. Each vaccine lists the disease groups it covers (PCHR = cat core + rabies). Reminders are per
--    disease group, so any vaccine covering it closes it — no duplicate rabies reminders.
-- 2. A dewormer list the doctor manages: type (internal worms / fleas & ticks / both), what it
--    covers, dose, interval, price-list item. Two reminder tracks: internal worms, fleas & ticks.
-- 3. Date order: a record only moves a reminder if it is the LATEST for that group / track — adding
--    an older history entry never overrides a newer schedule.
-- 4. Bills never write confirmed history: a billed deworming / vaccine is recorded as "to confirm"
--    (product taken from the price-list link) with a provisional reminder; the doctor confirms,
--    corrects or marks "not given".
-- 5. Reminders entered already overdue get one catch-up message right away.
-- =============================================================================

-- 1) Vaccine disease groups ------------------------------------------------------------------
alter table public.vaccines add column covers text[] not null default '{}';
update public.vaccines set covers = case
  when name ilike 'Biocan Novel DHPPi/L4R%' then array['dog_core', 'lepto', 'rabies']
  when name ilike 'Biocan Novel DHPPi/L4%' then array['dog_core', 'lepto']
  when name ilike 'Biocan Puppy%' or name ilike 'Parvo (puppy)%' or name = 'DHPPi' then array['dog_core']
  when name = 'DHPPi + L' then array['dog_core', 'lepto']
  when name ilike 'Leptospirosis%' then array['lepto']
  when name ilike 'Kennel cough%' then array['kennel_cough']
  when name ilike 'PCHR%' then array['cat_core', 'rabies']
  when name ilike 'PCH%' or name ilike 'FVRCP%' then array['cat_core']
  when name ilike 'Biocan R%' or name = 'Rabies' then array['rabies']
  when name ilike 'FeLV%' then array['felv']
  when name ilike 'Biocan M%' then array['ringworm']
  else array[lower(regexp_replace(name, '[^A-Za-z0-9]+', '_', 'g'))] end;

-- New vaccines: until the doctor ticks the groups, a vaccine covers "itself".
create or replace function private.vaccine_default_covers() returns trigger
language plpgsql set search_path = '' as $$
begin
  if coalesce(array_length(new.covers, 1), 0) = 0 then
    new.covers := array[lower(regexp_replace(new.name, '[^A-Za-z0-9]+', '_', 'g'))];
  end if;
  return new;
end $$;
create trigger vaccines_default_covers before insert or update of covers, name on public.vaccines
  for each row execute function private.vaccine_default_covers();

create or replace function private.vaccine_covers(p_vaccine uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((select covers from public.vaccines where id = p_vaccine), array[p_vaccine::text]);
$$;

-- 2) Dewormers ------------------------------------------------------------------------------
create table public.dewormers (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique check (length(trim(name)) > 1),
  species_ids     uuid[] not null default '{}',              -- empty = any species
  tracks          text[] not null default '{internal}' check (tracks <@ array['internal', 'external'] and cardinality(tracks) > 0),
  covers          text[] not null default '{}',              -- roundworm, tapeworm, hookworm, whipworm, heartworm, giardia, fleas, ticks, mites
  dose_text       text,                                      -- e.g. "1 tablet per 10 kg"
  adult_interval_days int not null default 90 check (adult_interval_days between 7 and 730),
  catalog_item_id uuid unique references public.catalog_items (id) on delete set null,
  notes           text,
  is_active       boolean not null default true,
  sort_order      int not null default 100,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.dewormers enable row level security;
create policy dewormers_select on public.dewormers for select to authenticated using ((select private.is_active_staff()));
create policy dewormers_manage on public.dewormers for all to authenticated
  using ((select private.has_permission('clinical.reopen') or private.has_permission('settings.manage')))
  with check ((select private.has_permission('clinical.reopen') or private.has_permission('settings.manage')));
grant select, insert, update, delete on public.dewormers to authenticated;
revoke all on public.dewormers from anon;
create trigger dewormers_updated_at before update on public.dewormers for each row execute function private.set_updated_at();
create trigger audit_dewormers after insert or update or delete on public.dewormers for each row execute function private.audit_row();

insert into public.dewormers (name, species_ids, tracks, covers, dose_text, adult_interval_days, catalog_item_id, sort_order, notes)
values
  ('Praferan', '{}', '{internal}', '{roundworm,tapeworm,hookworm}', null, 90,
   (select id from public.catalog_items where name = 'Deworming (Praferan)'), 10, 'Broad-spectrum dewormer. Doctor: check covers and dose.'),
  ('Drontal Cat', (select coalesce(array_agg(id), '{}') from public.species where name = 'Cat'), '{internal}',
   '{roundworm,tapeworm,hookworm}', '1 tablet per 4 kg', 90,
   (select id from public.catalog_items where name = 'Deworming (Drontal Cat)'), 20, 'Praziquantel + pyrantel.'),
  ('Dog dewormer', (select coalesce(array_agg(id), '{}') from public.species where name = 'Dog'), '{internal}',
   '{roundworm,tapeworm,hookworm,whipworm}', null, 90,
   (select id from public.catalog_items where name = 'Deworming Dog'), 30, 'Generic dog deworming on the price list. Doctor: add the actual products.'),
  ('Dewormer — other / not listed', '{}', '{internal}', '{}', null, 90,
   (select id from public.catalog_items where name = 'Deworming'), 90, 'Price-list "Deworming": the doctor confirms which product was given.');

alter table public.dewormings add column dewormer_id uuid references public.dewormers (id),
  add column tracks text[] not null default '{internal}';
update public.dewormings w set dewormer_id = d.id, tracks = d.tracks
  from public.dewormers d where w.dewormer_id is null and lower(w.product) = lower(d.name);

-- 3) Reminder groups on due items ------------------------------------------------------------
alter table public.due_items add column groups text[] not null default '{}';
update public.due_items di set groups = private.vaccine_covers(di.vaccine_id) where di.kind = 'vaccination' and di.vaccine_id is not null;
update public.due_items di set groups = private.vaccine_covers(x.vaccine_id)
  from public.vaccinations x where di.kind = 'vaccination' and di.groups = '{}' and di.source_table = 'vaccinations' and di.source_id = x.id;
update public.due_items set groups = '{internal}' where kind = 'deworming' and groups = '{}';

-- 4) Confirmation of billed records -----------------------------------------------------------
alter table public.dewormings add column confirmed boolean not null default true, add column confirmed_by uuid references public.staff (id), add column confirmed_at timestamptz;
alter table public.vaccinations add column confirmed boolean not null default true, add column confirmed_by uuid references public.staff (id), add column confirmed_at timestamptz;
update public.dewormings set confirmed = false where source_invoice_id is not null;
update public.vaccinations set confirmed = false where source_invoice_id is not null or notes like 'Recorded from bill%';

-- 5) Reminder triggers: latest record per group / track wins ---------------------------------
create or replace function private.vaccination_due_items() returns trigger
language plpgsql security definer set search_path = '' as $$
declare cov text[] := private.vaccine_covers(new.vaccine_id); live text[]; g text;
begin
  -- Groups for which this is the latest record (an older history entry changes nothing).
  live := '{}';
  foreach g in array cov loop
    if not exists (select 1 from public.vaccinations x
                    where x.pet_id = new.pet_id and x.id <> new.id and x.voided_at is null
                      and x.administered_at > new.administered_at and g = any (private.vaccine_covers(x.vaccine_id))) then
      live := live || g;
    end if;
  end loop;
  if cardinality(live) = 0 then return null; end if;

  update public.due_items
     set status = 'done', outcome = 'administered', completed_at = now(), completed_by = new.administered_by, closed_by_vaccination = new.id
   where pet_id = new.pet_id and kind = 'vaccination' and status = 'pending'
     and (groups && live or vaccine_id = new.vaccine_id or (new.protocol_id is not null and protocol_id = new.protocol_id));

  if new.next_due_date is not null then
    insert into public.due_items (pet_id, kind, title, due_on, vaccine_id, protocol_id, protocol_step, source_table, source_id, assigned_to, groups)
    values (new.pet_id, 'vaccination', coalesce(nullif(trim(new.next_due_label), ''), new.vaccine_name || ' — next dose'),
            new.next_due_date, new.vaccine_id, new.protocol_id,
            case when new.protocol_step is not null then new.protocol_step + 1 end,
            'vaccinations', new.id, new.administered_by, live);
  end if;
  return null;
end $$;

create or replace function private.deworming_due_items() returns trigger
language plpgsql security definer set search_path = '' as $$
declare live text[] := '{}'; tr text;
begin
  foreach tr in array new.tracks loop
    if not exists (select 1 from public.dewormings w where w.pet_id = new.pet_id and w.id <> new.id and w.voided_at is null
                     and w.given_at > new.given_at and tr = any (w.tracks)) then
      live := live || tr;
    end if;
  end loop;
  if cardinality(live) = 0 then return null; end if;
  update public.due_items
     set status = 'done', outcome = 'administered', completed_at = now(), completed_by = new.given_by, closed_by_deworming = new.id
   where pet_id = new.pet_id and kind = 'deworming' and status = 'pending' and groups && live;
  if new.next_due_date is not null then
    foreach tr in array live loop
      insert into public.due_items (pet_id, kind, title, due_on, source_table, source_id, assigned_to, groups)
      values (new.pet_id, 'deworming', case tr when 'external' then 'Flea & tick treatment' else 'Deworming' end,
              new.next_due_date, 'dewormings', new.id, new.given_by, array[tr]);
    end loop;
  end if;
  return null;
end $$;

-- 6) Billed treatments are recorded "to confirm" ---------------------------------------------
create or replace function private.record_billed_treatments(p_invoice uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  inv record; pet uuid; day date; doctor uuid; l record; age int; nxt date; lbl text; dw public.dewormers; n int := 0;
  pname text;
begin
  select i.id, i.number, i.pet_id, i.visit_id, i.issued_at, v.pet_id visit_pet, v.doctor_id
    into inv from public.invoices i left join public.visits v on v.id = i.visit_id where i.id = p_invoice;
  pet := coalesce(inv.pet_id, inv.visit_pet);
  if pet is null then return; end if;
  day := (coalesce(inv.issued_at, now()) at time zone 'Asia/Karachi')::date;
  doctor := inv.doctor_id;

  for l in select ii.description, ci.id item_id, ci.name, ci.is_deworming, ci.vaccine_id
             from public.invoice_items ii join public.catalog_items ci on ci.id = ii.item_id
            where ii.invoice_id = p_invoice and (ci.is_deworming or ci.vaccine_id is not null) loop
    age := private.age_days(pet, day);
    if l.is_deworming then
      select * into dw from public.dewormers where catalog_item_id = l.item_id;
      continue when exists (select 1 from public.dewormings w where w.pet_id = pet and w.voided_at is null
                              and ((inv.visit_id is not null and w.visit_id = inv.visit_id)
                                   or abs((w.given_at at time zone 'Asia/Karachi')::date - day) <= 3));
      nxt := day + case when age is not null and age < 84 then 14 when age is not null and age < 182 then 30
                        else coalesce(dw.adult_interval_days, 90) end;
      insert into public.dewormings (pet_id, visit_id, product, dewormer_id, tracks, given_at, given_by, next_due_date, notes,
                                     source_invoice_id, confirmed)
      values (pet, inv.visit_id, coalesce(dw.name, private.dewormer_name(coalesce(nullif(l.description, ''), l.name))), dw.id,
              coalesce(dw.tracks, '{internal}'), coalesce(inv.issued_at, now()), doctor, nxt,
              'From bill ' || inv.number || ' — waiting for the doctor to confirm what was given', p_invoice, false);
      n := n + 1;
    else
      continue when exists (select 1 from public.vaccinations x where x.pet_id = pet and x.voided_at is null
                              and private.vaccine_covers(x.vaccine_id) && private.vaccine_covers(l.vaccine_id)
                              and ((inv.visit_id is not null and x.visit_id = inv.visit_id)
                                   or abs((x.administered_at at time zone 'Asia/Karachi')::date - day) <= 7));
      if age is not null and age < 112 then nxt := day + 21; lbl := 'Next puppy / kitten dose';
      elsif age is not null and age < 182 then nxt := (select date_of_birth from public.pets where id = pet) + 182; lbl := '6-month dose';
      else nxt := day + 365; lbl := 'Yearly booster'; end if;
      insert into public.vaccinations (pet_id, visit_id, vaccine_id, vaccine_name, administered_at, administered_by,
                                       next_due_date, next_due_label, notes, source_invoice_id, confirmed)
      select pet, inv.visit_id, l.vaccine_id, vac.name, coalesce(inv.issued_at, now()), doctor,
             greatest(nxt, day + 14), lbl || ' — ' || vac.name,
             'From bill ' || inv.number || ' — waiting for the doctor to confirm what was given', p_invoice, false
        from public.vaccines vac where vac.id = l.vaccine_id;
      n := n + 1;
    end if;
  end loop;

  if n > 0 then
    select name into pname from public.pets where id = pet;
    if doctor is not null then
      perform private.notify(doctor, 'treatment_confirm', 'warning', 'Confirm what was given — ' || pname,
        'Bill ' || inv.number || ' has deworming / vaccine lines. Confirm, correct or mark not given.', '/pets/' || pet,
        'confirm:' || p_invoice);
    else
      perform private.notify_role('owner', 'treatment_confirm', 'warning', 'Confirm what was given — ' || pname,
        'Bill ' || inv.number || ' has deworming / vaccine lines. Confirm, correct or mark not given.', '/pets/' || pet,
        'confirm:' || p_invoice);
    end if;
  end if;
end $$;

-- The doctor confirms (as billed) or marks "not given". Correcting = not given + record the right one.
create or replace function public.confirm_treatment(p_kind text, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_permission('vaccinations.manage') then raise exception 'permission denied: vaccinations.manage' using errcode = '42501'; end if;
  if p_kind = 'deworming' then
    update public.dewormings set confirmed = true, confirmed_by = auth.uid(), confirmed_at = now(),
      notes = replace(notes, 'waiting for the doctor to confirm what was given', 'confirmed')
     where id = p_id and not confirmed and voided_at is null;
  elsif p_kind = 'vaccination' then
    update public.vaccinations set confirmed = true, confirmed_by = auth.uid(), confirmed_at = now(),
      notes = replace(notes, 'waiting for the doctor to confirm what was given', 'confirmed')
     where id = p_id and not confirmed and voided_at is null;
  else raise exception 'unknown kind'; end if;
  if not found then raise exception 'nothing to confirm (already confirmed or removed)'; end if;
end $$;

create or replace function public.treatment_not_given(p_kind text, p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare why text := 'Not given' || coalesce(' — ' || nullif(trim(p_note), ''), '');
begin
  if not private.has_permission('vaccinations.manage') then raise exception 'permission denied: vaccinations.manage' using errcode = '42501'; end if;
  if p_kind = 'deworming' then
    update public.dewormings set voided_at = now(), void_reason = why where id = p_id and not confirmed and voided_at is null;
  elsif p_kind = 'vaccination' then
    update public.vaccinations set voided_at = now(), void_reason = why where id = p_id and not confirmed and voided_at is null;
  else raise exception 'unknown kind'; end if;
  if not found then raise exception 'only records still waiting for confirmation can be marked not given'; end if;
end $$;
revoke execute on function public.confirm_treatment(text, uuid), public.treatment_not_given(text, uuid, text) from public, anon;
grant execute on function public.confirm_treatment(text, uuid), public.treatment_not_given(text, uuid, text) to authenticated;

-- 7) Clean up existing data ------------------------------------------------------------------
-- Records made from bills that duplicate one the doctor recorded himself (same disease group /
-- track, within a week) are removed — e.g. Billu: bill "Rabies" + doctor's "Biocan R".
update public.vaccinations b set voided_at = now(), void_reason = 'Duplicate of the record the doctor entered'
 where not b.confirmed and b.voided_at is null
   and exists (select 1 from public.vaccinations x where x.pet_id = b.pet_id and x.id <> b.id and x.confirmed and x.voided_at is null
                 and private.vaccine_covers(x.vaccine_id) && private.vaccine_covers(b.vaccine_id)
                 and abs(extract(epoch from x.administered_at - b.administered_at)) <= 7 * 86400);
update public.dewormings b set voided_at = now(), void_reason = 'Duplicate of the record the doctor entered'
 where not b.confirmed and b.voided_at is null
   and exists (select 1 from public.dewormings x where x.pet_id = b.pet_id and x.id <> b.id and x.confirmed and x.voided_at is null
                 and x.tracks && b.tracks and abs(extract(epoch from x.given_at - b.given_at)) <= 3 * 86400);

-- Pending reminders whose source record is not the latest for its group are superseded;
-- duplicates for the same group keep only the latest due date.
update public.due_items di set status = 'cancelled', outcome = 'superseded', outcome_reason = 'A newer record covers this'
 where di.status = 'pending' and di.kind = 'vaccination' and di.source_table = 'vaccinations'
   and exists (select 1 from public.vaccinations src, public.vaccinations x
                where src.id = di.source_id and x.pet_id = di.pet_id and x.id <> src.id and x.voided_at is null
                  and x.administered_at > src.administered_at and private.vaccine_covers(x.vaccine_id) && di.groups);
update public.due_items di set status = 'cancelled', outcome = 'superseded', outcome_reason = 'Duplicate reminder for the same vaccine group'
 where di.status = 'pending' and di.kind = 'vaccination'
   and exists (select 1 from public.due_items o where o.pet_id = di.pet_id and o.kind = 'vaccination' and o.status = 'pending'
                 and o.id <> di.id and o.groups && di.groups and (o.due_on > di.due_on or (o.due_on = di.due_on and o.id > di.id)));
update public.due_items di set status = 'cancelled', outcome = 'superseded', outcome_reason = 'Duplicate reminder for the same deworming track'
 where di.status = 'pending' and di.kind = 'deworming'
   and exists (select 1 from public.due_items o where o.pet_id = di.pet_id and o.kind = 'deworming' and o.status = 'pending'
                 and o.id <> di.id and o.groups && di.groups and (o.due_on > di.due_on or (o.due_on = di.due_on and o.id > di.id)));

-- 8) Catch-up message for reminders that were already overdue when entered -----------------
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
  select case di.kind when 'vaccination' then 'vaccination_due' when 'deworming' then 'deworming_due' else 'follow_up_due' end, 'due_items', di.id,
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
           or (rule.customer_repeat_days is not null and d > max_off and (d - max_off) % rule.customer_repeat_days = 0)
           or (d > max_off and coalesce(t.customer_msgs, 0) = 0))   -- entered already overdue: one catch-up message now
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
                'to_send', cust.id, null, rule.customer_template, lang, body,
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
