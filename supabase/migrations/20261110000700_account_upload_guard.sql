-- Account deletion rejects new storage work, including retries of existing reservations.
create or replace function public.movie_storage_action(caller uuid, action text, input jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare
 m public.movies; p public.profiles; cap bigint; used bigint; own_used bigint;
 mid uuid := (input->>'movie_id')::uuid; n bigint; token uuid; rid uuid;
begin
 select value::bigint into cap from public.app_config where key='movie_storage_cap_bytes' for update;
 select * into p from public.profiles where id=caller for update;
 if not found then return public.rpc_error('unauthorized'); end if;
 if p.account_deleting and action not in ('account_delete','delete','cleaned') then return public.rpc_error('upload_not_allowed'); end if;
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
