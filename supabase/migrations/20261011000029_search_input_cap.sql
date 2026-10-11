-- =============================================================================
-- Search input limits. A 20,000-character query took ~6.5 s of database time (trigram matching on a
-- huge string). Real searches are a name, phone or ID, so the public search now trims the query to
-- 100 characters and caps results at 50 before calling the unchanged implementation.
-- =============================================================================
alter function public.global_search(text, int) rename to global_search_impl;
alter function public.global_search_impl(text, int) set schema private;
revoke execute on function private.global_search_impl(text, int) from public, anon;
grant execute on function private.global_search_impl(text, int) to authenticated;

create function public.global_search(q text, max_results int default 20)
returns table (kind text, id uuid, code text, title text, subtitle text, rank real)
language sql stable security invoker set search_path = '' as $$
  select * from private.global_search_impl(left(coalesce(q, ''), 100), least(greatest(coalesce(max_results, 20), 1), 50));
$$;
revoke execute on function public.global_search(text, int) from public, anon;
grant execute on function public.global_search(text, int) to authenticated;
