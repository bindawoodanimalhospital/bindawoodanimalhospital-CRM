-- Pin search_path on the updated_at trigger function (Supabase advisor: function_search_path_mutable).
alter function private.set_updated_at() set search_path = '';
