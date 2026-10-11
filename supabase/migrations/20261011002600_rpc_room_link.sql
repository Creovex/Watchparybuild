-- get_room_link(room_id): host only; the full room link, including the join key for a private
-- room.
-- rotate_join_key(room_id): host only, private rooms only; replaces the join key, so links
-- holding the old key are refused with bad_key, and returns the new link.
-- data (both): { room_link }
-- codes: unauthorized, not_host; rotate_join_key also invalid_input for a public room
create function public.get_room_link(room_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid := get_room_link.room_id;
begin
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  if not public.is_room_host(v_room_id, v_uid) then
    return public.rpc_error('not_host');
  end if;

  return public.rpc_ok(jsonb_build_object('room_link', public.room_link(v_room_id)));
end;
$$;

create function public.rotate_join_key(room_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid := rotate_join_key.room_id;
  v_room public.rooms;
begin
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  select r.* into v_room from public.rooms r where r.id = v_room_id for update;
  if not found or not public.is_room_host(v_room_id, v_uid) then
    return public.rpc_error('not_host');
  end if;

  if v_room.visibility <> 'private' then
    return public.rpc_error('invalid_input');
  end if;

  insert into public.room_secrets as s (room_id, join_key)
  values (v_room_id, public.random_base64url(16))
  on conflict on constraint room_secrets_pkey do update set join_key = excluded.join_key;

  return public.rpc_ok(jsonb_build_object('room_link', public.room_link(v_room_id)));
end;
$$;

revoke execute on function public.get_room_link(uuid) from public, anon;
grant execute on function public.get_room_link(uuid) to authenticated;
revoke execute on function public.rotate_join_key(uuid) from public, anon;
grant execute on function public.rotate_join_key(uuid) to authenticated;
