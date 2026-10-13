-- Deworming becomes a kind of due reminder (used by migration 044). Kept on its own because a new
-- enum value has to be committed before anything can use it.
alter type public.due_kind add value if not exists 'deworming';
