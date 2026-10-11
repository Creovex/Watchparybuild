-- close_room(room_id)
-- Host only. Sets status `closed`; the `room` event on the server topic tells every member.
-- Closing a closed room changes nothing and succeeds.
-- data: <room row>
-- codes: unauthorized, not_host
create function public.close_room(room_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid := close_room.room_id;
  v_room public.rooms;
begin
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  select r.* into v_room from public.rooms r where r.id = v_room_id for update;
  if not found or not public.is_room_host(v_room_id, v_uid) then
    return public.rpc_error('not_host');
  end if;

  if v_room.status <> 'closed' then
    update public.rooms r set status = 'closed' where r.id = v_room_id
    returning r.* into v_room;
  end if;

  return public.rpc_ok(to_jsonb(v_room));
end;
$$;

revoke execute on function public.close_room(uuid) from public, anon;
grant execute on function public.close_room(uuid) to authenticated;
