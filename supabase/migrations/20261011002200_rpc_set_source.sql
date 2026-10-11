-- set_source(room_id, source, content_ref)
-- Host only. Validates the content reference (null is allowed, as at creation), then in one
-- transaction updates the room and resets playback to paused at 0 at normal rate with seq + 1.
-- data: { room: <room row>, playback_state: <playback_state row> }
-- codes: unauthorized, not_host, invalid_input
create function public.set_source(room_id uuid, source text, content_ref text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid := set_source.room_id;
  v_source text := set_source.source;
  v_ref text := set_source.content_ref;
  v_room public.rooms;
  v_state public.playback_state;
begin
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  select r.* into v_room from public.rooms r where r.id = v_room_id for update;
  if not found or not public.is_room_host(v_room_id, v_uid) then
    return public.rpc_error('not_host');
  end if;

  if v_source is null or v_source not in ('youtube', 'netflix', 'prime', 'disney')
     or (v_ref is not null and not public.valid_content_ref(v_source, v_ref)) then
    return public.rpc_error('invalid_input');
  end if;

  update public.rooms r
  set source = v_source,
      content_ref = v_ref
  where r.id = v_room_id
  returning r.* into v_room;

  update public.playback_state ps
  set seq = ps.seq + 1,
      status = 'paused',
      position_sec = 0,
      rate = 1,
      server_ts = clock_timestamp(),
      paused_reason = 'user',
      updated_by = v_uid
  where ps.room_id = v_room_id
  returning ps.* into v_state;

  return public.rpc_ok(jsonb_build_object('room', to_jsonb(v_room), 'playback_state', to_jsonb(v_state)));
end;
$$;

revoke execute on function public.set_source(uuid, text, text) from public, anon;
grant execute on function public.set_source(uuid, text, text) to authenticated;
