-- A consultation's follow-up reminder is titled "Follow-up visit" (like "Post-op check — …" and "Check after hospital stay"),
-- not the doctor's whole plan text. The plan stays on the consultation; the reminder only needs a short, clear name
-- for the Due list, the owner's record and the WhatsApp reminder. Existing reminders are left as they are.

create or replace function private.due_item_follow_up_title()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind = 'follow_up' and new.source_table = 'consultations' then
    new.title := 'Follow-up visit';
  end if;
  return new;
end $$;

create trigger due_items_follow_up_title before insert on public.due_items
  for each row execute function private.due_item_follow_up_title();
