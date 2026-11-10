-- Private movie metadata and serialized storage reservations. No storage credentials live here.
alter table public.profiles add column upload_quota_bytes bigint not null default 0 check (upload_quota_bytes >= 0);
alter table public.profiles add column account_deleting boolean not null default false;
insert into public.app_config(key,value) values ('movie_storage_cap_bytes','9000000000');
create table public.movies (
 id uuid primary key, owner_id uuid not null references public.profiles(id) on delete restrict,
 title text not null check(char_length(btrim(title)) between 1 and 120),
 status text not null default 'uploading' check(status in ('uploading','completing','ready','deleting','failed')),
 size_bytes bigint not null check(size_bytes between 1 and 5368709120),
 content_type text not null check(content_type in ('video/mp4','video/webm')),
 duration_sec double precision not null check(duration_sec > 0 and duration_sec < 'infinity'::float8),
 width integer not null check(width between 1 and 16384), height integer not null check(height between 1 and 16384),
 object_key text not null unique, upload_id text, poster_path text,
 lease_token uuid, lease_until timestamptz,
 created_at timestamptz not null default clock_timestamp(), ready_at timestamptz,
 status_changed_at timestamptz not null default clock_timestamp()
);
create index movies_owner on public.movies(owner_id,created_at desc);
alter table public.movies enable row level security;
revoke all on public.movies from public,anon,authenticated;
grant all on public.movies to service_role;
create view public.movie_library with (security_barrier=true) as
 select id,owner_id,title,status,size_bytes,content_type,duration_sec,width,height,poster_path,created_at,ready_at
 from public.movies where owner_id=auth.uid();
revoke all on public.movie_library from public,anon,authenticated;
grant select on public.movie_library to authenticated;
create table public.movie_calls(user_id uuid not null references public.profiles(id) on delete cascade, action text not null, called_at timestamptz not null default clock_timestamp());
create index movie_calls_user on public.movie_calls(user_id,action,called_at);
alter table public.movie_calls enable row level security;
revoke all on public.movie_calls from public,anon,authenticated;
grant all on public.movie_calls to service_role;

create function public.movie_usage() returns jsonb language sql security definer set search_path='' as $$
 select public.rpc_ok(jsonb_build_object('quota',p.upload_quota_bytes,'used',coalesce((select sum(m.size_bytes) from public.movies m where m.owner_id=p.id and m.status<>'failed'),0),'site_used',coalesce((select sum(m.size_bytes) from public.movies m where m.status<>'failed'),0),'site_cap',(select value::bigint from public.app_config where key='movie_storage_cap_bytes'))) from public.profiles p where p.id=auth.uid();
$$;
revoke all on function public.movie_usage() from public,anon;
grant execute on function public.movie_usage() to authenticated;

-- Every storage transition takes the cap row first. Leases outlive the maximum function runtime.
create function public.movie_storage_action(caller uuid, action text, input jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare
 m public.movies; p public.profiles; cap bigint; used bigint; own_used bigint;
 mid uuid := (input->>'movie_id')::uuid; n bigint; token uuid; rid uuid;
begin
 select value::bigint into cap from public.app_config where key='movie_storage_cap_bytes' for update;
 select * into p from public.profiles where id=caller for update;
 if not found then return public.rpc_error('unauthorized'); end if;
 if action='reserve' then
  select * into m from public.movies where id=mid;
  if found then
   if m.owner_id<>caller or m.title<>input->>'title' or m.size_bytes<>(input->>'size_bytes')::bigint or m.content_type<>input->>'content_type' then return public.rpc_error('invalid_input'); end if;
   return public.rpc_ok(to_jsonb(m));
  end if;
  if p.account_deleting or p.upload_quota_bytes=0 then return public.rpc_error('upload_not_allowed'); end if;
  n:=(input->>'size_bytes')::bigint;
  if n not between 1 and 5368709120 or char_length(btrim(input->>'title')) not between 1 and 120 or input->>'content_type' not in ('video/mp4','video/webm') then return public.rpc_error('invalid_input'); end if;
  if exists(select 1 from public.movies where owner_id=caller and status in ('uploading','completing')) then return public.rpc_error('upload_in_progress'); end if;
  if (select count(*) from public.movie_calls c where c.user_id=caller and c.action='start' and c.called_at>clock_timestamp()-interval '1 hour')>=10 then return public.rpc_error('rate_limited'); end if;
  select coalesce(sum(size_bytes),0) into used from public.movies where status<>'failed';
  select coalesce(sum(size_bytes),0) into own_used from public.movies where status<>'failed' and owner_id=caller;
  if own_used+n>p.upload_quota_bytes then return public.rpc_error('quota_exceeded'); end if;
  if used+n>cap then return public.rpc_error('storage_full'); end if;
  insert into public.movie_calls(user_id,action) values(caller,'start');
  insert into public.movies(id,owner_id,title,size_bytes,content_type,duration_sec,width,height,object_key)
  values(mid,caller,btrim(input->>'title'),n,input->>'content_type',(input->>'duration_sec')::float8,(input->>'width')::integer,(input->>'height')::integer,'m/'||caller||'/'||mid||case when input->>'content_type'='video/mp4' then '.mp4' else '.webm' end) returning * into m;
  return public.rpc_ok(to_jsonb(m));
 end if;
 if action='account_delete' then
  update public.profiles set account_deleting=true where id=caller;
  return public.rpc_ok(null);
 end if;
 if action='play_rate' then
  if (select count(*) from public.movie_calls c where c.user_id=caller and c.action='play' and c.called_at>clock_timestamp()-interval '1 hour')>=60 then return public.rpc_error('rate_limited'); end if;
  insert into public.movie_calls(user_id,action) values(caller,'play');
  return public.rpc_ok(null);
 end if;
 select * into m from public.movies where id=mid and owner_id=caller for update;
 if not found then return public.rpc_error('not_found'); end if;
 if action='attach' then
  if m.status<>'uploading' or m.upload_id is not null then return public.rpc_error('upload_in_progress'); end if;
  update public.movies set upload_id=input->>'upload_id' where id=mid returning * into m;
 elsif action in ('complete','delete') then
  if action='complete' and m.status='ready' then return public.rpc_ok(to_jsonb(m)); end if;
  if action='delete' and m.status='failed' then return public.rpc_ok(to_jsonb(m)); end if;
  if m.lease_until>clock_timestamp() then return public.rpc_error('upload_in_progress'); end if;
  if action='complete' and m.status not in ('uploading','completing') then return public.rpc_error('movie_unavailable'); end if;
  token:=gen_random_uuid();
  update public.movies set status=case when action='complete' then 'completing' else 'deleting' end, lease_token=token,lease_until=clock_timestamp()+interval '5 minutes',status_changed_at=clock_timestamp() where id=mid returning * into m;
  if action='delete' then
   for rid in select id from public.rooms where source='upload' and content_ref=mid::text order by id for update loop
    update public.rooms set content_ref=null where id=rid;
    update public.playback_state set status='paused',position_sec=0,rate=1,seq=seq+1,server_ts=clock_timestamp(),paused_reason='user',updated_by=caller where room_id=rid;
   end loop;
  end if;
 elsif action in ('ready','cleaned') then
  if m.lease_token is distinct from (input->>'lease_token')::uuid then return public.rpc_error('upload_in_progress'); end if;
  if action='ready' and (m.status<>'completing' or m.size_bytes<>(input->>'actual_size')::bigint) then return public.rpc_error('size_mismatch'); end if;
  if action='cleaned' and m.status<>'deleting' then return public.rpc_error('movie_unavailable'); end if;
  update public.movies set status=case when action='ready' then 'ready' else 'failed' end,upload_id=null,lease_token=null,lease_until=null,ready_at=case when action='ready' then clock_timestamp() else ready_at end,status_changed_at=clock_timestamp() where id=mid returning * into m;
 else return public.rpc_error('invalid_input');
 end if;
 return public.rpc_ok(to_jsonb(m));
exception when invalid_text_representation or check_violation or not_null_violation or numeric_value_out_of_range then return public.rpc_error('invalid_input');
end;
$$;
revoke all on function public.movie_storage_action(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.movie_storage_action(uuid,text,jsonb) to service_role;

create function public.can_view_movie(movie_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.movies m where m.id=movie_id and m.status='ready' and (m.owner_id=auth.uid() or exists(select 1 from public.rooms r join public.room_members rm on rm.room_id=r.id where r.status='open' and r.source='upload' and r.content_ref=m.id::text and rm.user_id=auth.uid() and rm.state='joined')));
$$;
revoke all on function public.can_view_movie(uuid) from public,anon;
grant execute on function public.can_view_movie(uuid) to authenticated;
create view public.room_movie with (security_barrier=true) as select id,title,duration_sec,width,height,poster_path from public.movies where public.can_view_movie(id);
revoke all on public.room_movie from public,anon,authenticated;
grant select on public.room_movie to authenticated;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('posters','posters',false,300000,array['image/jpeg']) on conflict(id) do nothing;
create function public.poster_movie_id(path text) returns uuid language sql immutable set search_path='' as $$
 select case when path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' then split_part(split_part(path,'/',2),'.',1)::uuid else null end;
$$;
revoke all on function public.poster_movie_id(text) from public,anon;
grant execute on function public.poster_movie_id(text) to authenticated;
create policy "movie posters read" on storage.objects for select to authenticated using(bucket_id='posters' and public.can_view_movie(public.poster_movie_id(name)));
create policy "movie posters insert" on storage.objects for insert to authenticated with check(bucket_id='posters' and (storage.foldername(name))[1]=auth.uid()::text and exists(select 1 from public.movie_library m where m.id=public.poster_movie_id(name) and m.status='ready'));
create policy "movie posters update" on storage.objects for update to authenticated using(bucket_id='posters' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='posters' and (storage.foldername(name))[1]=auth.uid()::text and public.can_view_movie(public.poster_movie_id(name)));
create policy "movie posters delete" on storage.objects for delete to authenticated using(bucket_id='posters' and (storage.foldername(name))[1]=auth.uid()::text);
create function public.movie_set_poster(movie_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 update public.movies set poster_path=owner_id::text||'/'||id::text||'.jpg' where id=movie_id and owner_id=auth.uid() and status='ready' and exists(select 1 from storage.objects o where o.bucket_id='posters' and o.name=auth.uid()::text||'/'||movie_id::text||'.jpg');
 if not found then return public.rpc_error('not_found'); end if;
 return public.rpc_ok(null);
end;
$$;
revoke all on function public.movie_set_poster(uuid) from public,anon;
grant execute on function public.movie_set_poster(uuid) to authenticated;
create function public.movie_housekeeping() returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.app_config where key='movie_storage_cap_bytes' for update;
 -- Preserve reservations until object cleanup is confirmed by the storage function.
 update public.movies set status='deleting',status_changed_at=clock_timestamp() where status in ('uploading','completing') and status_changed_at<clock_timestamp()-interval '24 hours' and coalesce(lease_until,'-infinity')<clock_timestamp();
 delete from public.movies where status='failed' and status_changed_at<clock_timestamp()-interval '7 days';
 delete from public.movie_calls where called_at<clock_timestamp()-interval '1 day';
end;
$$;
revoke all on function public.movie_housekeeping() from public,anon,authenticated;
select cron.schedule('movie_housekeeping','0 * * * *','select public.movie_housekeeping()');
