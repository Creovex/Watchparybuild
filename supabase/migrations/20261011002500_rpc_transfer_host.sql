-- transfer_host(room_id, new_host_id)
-- Host only. The target must be a present member other than the caller. Swaps roles, sets
-- rooms.host_id and posts a `host_changed` system message. Room cap and voice mode do not change.
-- data: <room row>
-- codes: unauthorized, not_host, not_member
create function public.transfer_host(room_id uuid, new_host_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid := transfer_host.room_id;
  v_target uuid := transfer_host.new_host_id;
  v_room public.rooms;
begin
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  select r.* into v_room from public.rooms r where r.id = v_room_id for update;
  if not found or not public.is_room_host(v_room_id, v_uid) then
    return public.rpc_error('not_host');
  end if;

  if v_target is null or v_target = v_uid or not exists (
    select 1 from public.room_members m
    where m.room_id = v_room_id
      and m.user_id = v_target
      and m.state = 'joined'
      and m.last_seen_at > public.present_since()
  ) then
    return public.rpc_error('not_member');
  end if;

  update public.room_members m set role = 'guest'
  where m.room_id = v_room_id and m.user_id = v_uid;

  update public.room_members m set role = 'host'
  where m.room_id = v_room_id and m.user_id = v_target;

  update public.rooms r set host_id = v_target where r.id = v_room_id
  returning r.* into v_room;

  perform public.insert_system_message(v_room_id, v_target, 'host_changed', jsonb_build_object('user_id', v_target));

  return public.rpc_ok(to_jsonb(v_room));
end;
$$;

revoke execute on function public.transfer_host(uuid, uuid) from public, anon;
grant execute on function public.transfer_host(uuid, uuid) to authenticated;
