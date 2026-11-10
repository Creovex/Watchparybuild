create function public.movie_invitation(slug text, join_key text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r public.rooms; m public.movies; state text;begin
 if auth.uid() is null then return public.rpc_error('unauthorized'); end if;
 select * into r from public.rooms where rooms.slug=movie_invitation.slug;
 if not found or r.status<>'open' or r.source<>'upload' then return public.rpc_error('movie_unavailable'); end if;
 select rm.state into state from public.room_members rm where rm.room_id=r.id and rm.user_id=auth.uid();
 if state in ('removed','banned') then return public.rpc_error('not_member'); end if;
 if r.visibility='private' and r.host_id<>auth.uid() and coalesce(state,'')<>'joined' and not exists(select 1 from public.room_secrets s where s.room_id=r.id and s.join_key=movie_invitation.join_key) then return public.rpc_error('bad_key'); end if;
 select * into m from public.movies where id=r.content_ref::uuid and status='ready';
 if not found then return public.rpc_error('movie_unavailable'); end if;
 return public.rpc_ok(jsonb_build_object('title',m.title,'poster_path',m.poster_path,'host_name',(select display_name from public.profiles where id=r.host_id)));
end;$$;
revoke all on function public.movie_invitation(text,text) from public,anon;
grant execute on function public.movie_invitation(text,text) to authenticated;

create extension if not exists pg_net with schema extensions;
create function public.movie_cleanup_tick() returns void language plpgsql security definer set search_path='' as $$
declare key text; url text;begin
 select decrypted_secret into key from vault.decrypted_secrets where name='movie_cleanup_service_key';
 select decrypted_secret into url from vault.decrypted_secrets where name='movie_cleanup_url';
 if key is null or url is null then return; end if;
 perform net.http_post(url:=url,headers:=jsonb_build_object('Authorization','Bearer '||key,'Content-Type','application/json'),body:='{}'::jsonb,timeout_milliseconds:=120000);
end;$$;
revoke all on function public.movie_cleanup_tick() from public,anon,authenticated;
select cron.schedule('movie_storage_cleanup','*/10 * * * *','select public.movie_cleanup_tick()');
