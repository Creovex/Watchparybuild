-- join_room(slug, join_key, sync_mode)
-- Locks the room row so parallel joins are decided one at a time, then checks in this order:
-- status, ban, removal (a removed user is refused until the host allows them back), the join key
-- for a private room, the lock (a locked room admits only users who were members before and were
-- not removed or banned), and the room cap (a user already joined and present is admitted without
-- counting twice).
-- The join key is not asked of the room's host or of a user whose row is already `joined`, so a
-- member can open the room in a second browser context after the key was moved out of the address
-- bar (gap G25). Keys are compared by their SHA-256 digests, so the comparison time does not
-- depend on how much of the key matches.
-- Upserts the member as `joined`, role `host` when the caller is rooms.host_id and `guest`
-- otherwise, keeping first_joined_at and voice_muted, setting sync_mode and a new engine_session.
-- Posts a `joined` system message when the caller was not already joined.
-- data: { room: <room row>, playback_state: <playback_state row>, channel_epoch, engine_session }
-- codes: unauthorized, invalid_input, not_found, closed, banned, removed, bad_key, locked,
--        room_full (data: { room_cap })
create function public.join_room(slug text, join_key text, sync_mode text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_slug text := join_room.slug;
  v_key text := join_room.join_key;
  v_sync text := join_room.sync_mode;
  v_room public.rooms;
  v_member public.room_members;
  v_has_row boolean;
  v_old_state text;
  v_secret text;
  v_present_others integer;
  v_state public.playback_state;
begin
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  if v_slug is null or v_sync is null or v_sync not in ('auto', 'cue') then
    return public.rpc_error('invalid_input');
  end if;

  select r.* into v_room from public.rooms r where r.slug = v_slug for update;
  if not found then
    return public.rpc_error('not_found');
  end if;

  if v_room.status = 'closed' then
    return public.rpc_error('closed');
  end if;

  select m.* into v_member
  from public.room_members m
  where m.room_id = v_room.id and m.user_id = v_uid
  for update;
  v_has_row := found;
  v_old_state := case when v_has_row then v_member.state end;

  if v_old_state = 'banned' then
    return public.rpc_error('banned');
  end if;
  if v_old_state = 'removed' then
    return public.rpc_error('removed');
  end if;

  if v_room.visibility = 'private'
     and v_room.host_id is distinct from v_uid
     and v_old_state is distinct from 'joined' then
    select s.join_key into v_secret from public.room_secrets s where s.room_id = v_room.id;
    if v_key is null or v_secret is null
       or extensions.digest(v_key, 'sha256') <> extensions.digest(v_secret, 'sha256') then
      return public.rpc_error('bad_key');
    end if;
  end if;

  -- Former members are rows in state joined or left; removed and banned returned above.
  if v_room.locked and not v_has_row then
    return public.rpc_error('locked');
  end if;

  if not coalesce(v_old_state = 'joined' and v_member.last_seen_at > public.present_since(), false) then
    select count(*) into v_present_others
    from public.room_members m
    where m.room_id = v_room.id
      and m.user_id <> v_uid
      and m.state = 'joined'
      and m.last_seen_at > public.present_since();
    if v_present_others >= v_room.room_cap then
      return public.rpc_error('room_full', jsonb_build_object('room_cap', v_room.room_cap));
    end if;
  end if;

  insert into public.room_members as m (room_id, user_id, role, state, sync_mode, engine_session, first_joined_at, last_seen_at)
  values (
    v_room.id,
    v_uid,
    case when v_room.host_id = v_uid then 'host' else 'guest' end,
    'joined',
    v_sync,
    gen_random_uuid(),
    clock_timestamp(),
    clock_timestamp()
  )
  on conflict (room_id, user_id) do update
    set role = excluded.role,
        state = 'joined',
        sync_mode = excluded.sync_mode,
        engine_session = excluded.engine_session,
        last_seen_at = excluded.last_seen_at,
        buffering_since = null,
        left_at = null
  returning m.* into v_member;

  if v_old_state is distinct from 'joined' then
    perform public.insert_system_message(v_room.id, v_uid, 'joined', jsonb_build_object('user_id', v_uid));
  end if;

  update public.rooms r set last_active_at = clock_timestamp() where r.id = v_room.id
  returning r.* into v_room;

  select ps.* into v_state from public.playback_state ps where ps.room_id = v_room.id;

  return public.rpc_ok(jsonb_build_object(
    'room', to_jsonb(v_room),
    'playback_state', to_jsonb(v_state),
    'channel_epoch', v_room.channel_epoch,
    'engine_session', v_member.engine_session
  ));
end;
$$;

revoke execute on function public.join_room(text, text, text) from public, anon;
grant execute on function public.join_room(text, text, text) to authenticated;
