-- The worker uses a dedicated secret in addition to the gateway's signed service credential.
create or replace function public.movie_cleanup_tick() returns void language plpgsql security definer set search_path='' as $$
declare key text; token text; url text;begin
 select decrypted_secret into key from vault.decrypted_secrets where name='movie_cleanup_service_key';
 select decrypted_secret into token from vault.decrypted_secrets where name='movie_cleanup_token';
 select decrypted_secret into url from vault.decrypted_secrets where name='movie_cleanup_url';
 if key is null or token is null or url is null then return; end if;
 perform net.http_post(url:=url,headers:=jsonb_build_object('Authorization','Bearer '||key,'X-Movie-Cleanup-Token',token,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=120000);
end;$$;
revoke all on function public.movie_cleanup_tick() from public,anon,authenticated;
