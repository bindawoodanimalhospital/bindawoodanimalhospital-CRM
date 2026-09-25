-- Tell a person as soon as a task is given to them (not only when it becomes due).
create or replace function private.task_assigned()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.assigned_to is not null and new.assigned_to is distinct from (select auth.uid())
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    perform private.notify(new.assigned_to, 'task', case when new.priority in ('high', 'urgent') then 'warning' else 'info' end,
      'New task: ' || new.title,
      coalesce('Due ' || to_char(new.due_at at time zone 'Asia/Karachi', 'DD Mon HH12:MI AM'), 'No deadline'),
      '/tasks', 'task-assigned:' || new.id || ':' || new.assigned_to);
  end if;
  return null;
end $$;
create trigger tasks_assigned after insert or update of assigned_to on public.tasks
  for each row execute function private.task_assigned();
