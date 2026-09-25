-- Link outbox messages to their reminder track (lets the queue show "reminder #3").
alter table public.messages
  add constraint messages_track_fk foreign key (track_id) references public.reminder_tracks (id) on delete set null;

-- The engine's scratch table: drop & recreate each run instead of "if not exists" (avoids a notice every 30 min).
do $$
declare def text;
begin
  select pg_get_functiondef('private.run_reminders()'::regprocedure) into def;
  def := replace(def,
    'create temp table if not exists _open_sources (rule_key text, source_table text, source_id uuid, customer_id uuid, pet_id uuid,
    assigned_to uuid, title text, due_on date, extra jsonb) on commit drop;
  truncate _open_sources;',
    'drop table if exists _open_sources;
  create temp table _open_sources (rule_key text, source_table text, source_id uuid, customer_id uuid, pet_id uuid,
    assigned_to uuid, title text, due_on date, extra jsonb) on commit drop;');
  execute def;
end $$;
