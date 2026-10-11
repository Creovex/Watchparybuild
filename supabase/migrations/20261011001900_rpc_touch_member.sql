-- touch_member(room_id, engine_session, buffering, sync_mode)
-- Called every 20 seconds by the engine owner, and at once when buffering starts or stops.
-- Checks in this order: removed or banned; not_member when there is no row or the state is left;
-- closed; replaced when engine_session is not the member's current one; and, for a member who was
-- not present, the room cap again (room_full when another person took the slot). Then sets
-- last_seen_at, rooms.last_active_at, sync_mode and buffering_since (set when buffering turns true,
-- cleared when false). A null buffering or sync_mode leaves that value as it is.
-- The room row is locked first, as in every RPC that changes members, so calls cannot deadlock.
-- data: { member: <member row without engine_session>, channel_epoch }
-- codes: unauthorized, invalid_input, not_member, removed, banned, closed, replaced,
--        room_full (data: { room_cap })
create function public.touch_member(room_id uuid, engine_session uuid, buffering boolean, sync_mode text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid := touch_member.room_id;
  v_session uuid := touch_member.engine_session;
  v_buffering boolean := touch_member.buffering;
  v_sync text := touch_member.sync_mode;
  v_room public.rooms;
  v_member public.room_members;
  v_present_others integer;
begin
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  if v_room_id is null or v_session is null or (v_sync is not null and v_sync not in ('auto', 'cue')) then
    return public.rpc_error('invalid_input');
  end if;

  select r.* into v_room from public.rooms r where r.id = v_room_id for update;
  if not found then
    return public.rpc_error('not_member');
  end if;

  select m.* into v_member
  from public.room_members m
  where m.room_id = v_room_id and m.user_id = v_uid
  for update;
  if not found or v_member.state = 'left' then
    return public.rpc_error('not_member');
  end if;
  if v_member.state in ('removed', 'banned') then
    return public.rpc_error(v_member.state);
  end if;

  if v_room.status = 'closed' then
    return public.rpc_error('closed');
  end if;

  if v_member.engine_session <> v_session then
    return public.rpc_error('replaced');
  end if;

  if v_member.last_seen_at <= public.present_since() then
    select count(*) into v_present_others
    from public.room_members m
    where m.room_id = v_room_id
      and m.user_id <> v_uid
      and m.state = 'joined'
      and m.last_seen_at > public.present_since();
    if v_present_others >= v_room.room_cap then
      return public.rpc_error('room_full', jsonb_build_object('room_cap', v_room.room_cap));
    end if;
  end if;

  update public.room_members m
  set last_seen_at = clock_timestamp(),
      sync_mode = coalesce(v_sync, m.sync_mode),
      buffering_since = case
        when v_buffering is null then m.buffering_since
        when v_buffering then coalesce(m.buffering_since, clock_timestamp())
        else null
      end
  where m.room_id = v_room_id and m.user_id = v_uid
  returning m.* into v_member;

  update public.rooms r set last_active_at = clock_timestamp() where r.id = v_room_id;

  return public.rpc_ok(jsonb_build_object(
    'member', to_jsonb(v_member) - 'engine_session',
    'channel_epoch', v_room.channel_epoch
  ));
end;
$$;

revoke execute on function public.touch_member(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.touch_member(uuid, uuid, boolean, text) to authenticated;
