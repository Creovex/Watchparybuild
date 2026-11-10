-- Malformed object names are refused without raising during a storage policy check.
create or replace function public.poster_movie_id(path text) returns uuid language sql immutable set search_path='' as $$
 select case when path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$' then split_part(split_part(path,'/',2),'.',1)::uuid else null end;
$$;
revoke all on function public.poster_movie_id(text) from public,anon;
grant execute on function public.poster_movie_id(text) to authenticated;
