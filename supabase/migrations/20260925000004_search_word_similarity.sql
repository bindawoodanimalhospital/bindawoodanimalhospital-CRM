-- Fuzzy search on individual words ("ahmad" should find "Ahmed Raza").
-- whole-string similarity() is too strict against the long search_text blob.
create or replace function public.global_search(q text, max_results int default 20)
returns table (kind text, id uuid, code text, title text, subtitle text, rank real)
language sql stable security invoker
set search_path = ''
set pg_trgm.word_similarity_threshold = 0.45
as $$
  with term as (
    select private.search_norm(trim(q)) as t,
           nullif(regexp_replace(q, '\D', '', 'g'), '') as digits
  ), hits as (
    select 'customer'::text as kind, c.id as id, c.code as code, c.full_name as title,
           concat_ws(' · ', c.phone, c.area) as subtitle,
           greatest(extensions.word_similarity(term.t, c.search_text),
                    case when c.search_text like '%' || term.t || '%' then 1 else 0 end)::real as rank
    from public.customers c, term
    where c.status <> 'merged' and length(term.t) >= 2
      and (c.search_text like '%' || term.t || '%'
           or (term.digits is not null and length(term.digits) >= 4 and c.search_text like '%' || term.digits || '%')
           or term.t operator(extensions.<%) c.search_text)
    union all
    select 'pet', p.id, p.code, p.name,
           concat_ws(' · ', s.name, coalesce(b.name, p.breed_text),
             (select string_agg(c.full_name, ', ') from public.pet_owners po
                join public.customers c on c.id = po.customer_id where po.pet_id = p.id)),
           greatest(extensions.word_similarity(term.t, p.search_text),
                    case when p.search_text like '%' || term.t || '%' then 1 else 0 end)::real
    from public.pets p
    join public.species s on s.id = p.species_id
    left join public.breeds b on b.id = p.breed_id, term
    where length(term.t) >= 2
      and (p.search_text like '%' || term.t || '%' or term.t operator(extensions.<%) p.search_text)
    union all
    -- Pets reachable through an owner's phone number.
    select 'pet', p.id, p.code, p.name, concat_ws(' · ', s.name, 'owner: ' || c.full_name), 0.8::real
    from public.customers c
    join public.pet_owners po on po.customer_id = c.id
    join public.pets p on p.id = po.pet_id
    join public.species s on s.id = p.species_id, term
    where c.status <> 'merged' and term.digits is not null and length(term.digits) >= 4
      and c.search_text like '%' || term.digits || '%'
  )
  select * from (
    select distinct on (h.kind, h.id) h.* from hits h order by h.kind, h.id, h.rank desc
  ) d
  order by d.rank desc, d.title
  limit max_results;
$$;
