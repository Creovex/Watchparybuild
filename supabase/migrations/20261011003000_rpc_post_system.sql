-- post_system(room_id, system_code)
-- Member only. Clients may post two codes:
--   cue_ready    any member; body { user_id, position_sec } where position_sec is the expected
--                position now, computed from playback_state.
--   waiting_for  the elected member only; body { user_ids } listing the present members whose
--                buffering_since is set, earliest first. invalid_input when nobody is buffering.
-- At most once per 10 seconds per member across both codes. joined, left and host_changed are
-- written only by other RPCs and jobs, so they are invalid_input here.
-- data: <message row>
-- codes: unauthorized, invalid_input, not_member, not_elected, rate_limited
create function public.post_system(room_id uuid, system_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid := post_system.room_id;
  v_code text := post_system.system_code;
  v_state public.playback_state;
  v_buffering jsonb;
  v_body jsonb;
  v_message public.messages;
begin
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  if v_code is null or v_code not in ('cue_ready', 'waiting_for') then
    return public.rpc_error('invalid_input');
  end if;

  -- Room row first, then the member row: the order every RPC uses, so this call cannot deadlock
  -- with touch_member or join_room from the same person. A key share lock still lets other
  -- members chat at the same time.
  perform 1 from public.rooms r where r.id = v_room_id for key share;
  perform 1
  from public.room_members m
  where m.room_id = v_room_id and m.user_id = v_uid and m.state = 'joined'
  for update;
  if not found then
    return public.rpc_error('not_member');
  end if;

  if v_code = 'waiting_for' and public.elected_member(v_room_id) is distinct from v_uid then
    return public.rpc_error('not_elected');
  end if;

  if exists (
    select 1 from public.messages msg
    where msg.room_id = v_room_id
      and msg.user_id = v_uid
      and msg.kind = 'system'
      and msg.system_code in ('cue_ready', 'waiting_for')
      and msg.created_at > clock_timestamp() - interval '10 seconds'
  ) then
    return public.rpc_error('rate_limited');
  end if;

  if v_code = 'cue_ready' then
    select ps.* into v_state from public.playback_state ps where ps.room_id = v_room_id;
    v_body := jsonb_build_object(
      'user_id', v_uid,
      'position_sec', public.expected_position(v_state, clock_timestamp())
    );
  else
    select coalesce(jsonb_agg(m.user_id order by m.buffering_since, m.user_id), '[]'::jsonb) into v_buffering
    from public.room_members m
    where m.room_id = v_room_id
      and m.state = 'joined'
      and m.last_seen_at > public.present_since()
      and m.buffering_since is not null;
    if jsonb_array_length(v_buffering) = 0 then
      return public.rpc_error('invalid_input');
    end if;
    v_body := jsonb_build_object('user_ids', v_buffering);
  end if;

  v_message := public.insert_system_message(v_room_id, v_uid, v_code, v_body);
  return public.rpc_ok(to_jsonb(v_message));
end;
$$;

revoke execute on function public.post_system(uuid, text) from public, anon;
grant execute on function public.post_system(uuid, text) to authenticated;
