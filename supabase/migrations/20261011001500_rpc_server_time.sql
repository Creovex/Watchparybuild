-- server_time(): the server clock in epoch milliseconds, read from clock_timestamp() so it is the
-- moment of the call rather than the start of the transaction. Clients estimate their clock
-- offset from five calls.
create function public.server_time()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'data', floor(extract(epoch from clock_timestamp()) * 1000)::bigint);
$$;

revoke execute on function public.server_time() from public, anon;
grant execute on function public.server_time() to authenticated;
