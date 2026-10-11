-- leave_room(room_id)
-- Marks the caller `left` and posts a `left` system message. If the caller was the host, host
-- passes to the present guest with the earliest first_joined_at, who gets role `host`, and a
-- `host_changed` system message is posted. With no present guest the room keeps its host_id and
-- has no present host until someone is handed host or the host returns.
-- data: { host_id: the room's host after the call }
-- codes: unauthorized, not_member
create function public.leave_room(room_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid := leave_room.room_id;
  v_room public.rooms;
  v_member public.room_members;
  v_new_host uuid;
begin
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  select r.* into v_room from public.rooms r where r.id = v_room_id for update;
  if not found then
    return public.rpc_error('not_member');
  end if;

  select m.* into v_member
  from public.room_members m
  where m.room_id = v_room_id and m.user_id = v_uid
  for update;
  if not found or v_member.state <> 'joined' then
    return public.rpc_error('not_member');
  end if;

  if v_room.host_id = v_uid then
    select m.user_id into v_new_host
    from public.room_members m
    where m.room_id = v_room_id
      and m.user_id <> v_uid
      and m.state = 'joined'
      and m.last_seen_at > public.present_since()
    order by m.first_joined_at, m.user_id
    limit 1;
  end if;

  update public.room_members m
  set state = 'left',
      left_at = clock_timestamp(),
      buffering_since = null,
      role = case when v_new_host is not null then 'guest' else m.role end
  where m.room_id = v_room_id and m.user_id = v_uid;

  perform public.insert_system_message(v_room_id, v_uid, 'left', jsonb_build_object('user_id', v_uid));

  if v_new_host is not null then
    update public.room_members m set role = 'host'
    where m.room_id = v_room_id and m.user_id = v_new_host;

    update public.rooms r set host_id = v_new_host where r.id = v_room_id;

    perform public.insert_system_message(v_room_id, v_new_host, 'host_changed', jsonb_build_object('user_id', v_new_host));
  end if;

  return public.rpc_ok(jsonb_build_object('host_id', coalesce(v_new_host, v_room.host_id)));
end;
$$;

revoke execute on function public.leave_room(uuid) from public, anon;
grant execute on function public.leave_room(uuid) to authenticated;
