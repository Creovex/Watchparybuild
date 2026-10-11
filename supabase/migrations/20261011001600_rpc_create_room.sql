-- create_room(title, source, content_ref, visibility, control_mode)
-- In one transaction: refuses a caller who already hosts 20 open rooms (abuse limit), generates
-- the slug (up to 5 tries on collision), takes room cap and voice mode from the caller's plan, and
-- inserts the room, the host as a present member, playback state (seq 0, paused at 0) and, for a
-- private room, a join key of 128 random bits.
-- data: { room: <room row>, room_link: text }
-- codes: unauthorized, invalid_input, too_many_rooms, internal
create function public.create_room(
  title text,
  source text,
  content_ref text,
  visibility text,
  control_mode text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_title text := btrim(create_room.title);
  v_source text := create_room.source;
  v_ref text := create_room.content_ref;
  v_visibility text := create_room.visibility;
  v_control text := coalesce(create_room.control_mode, 'host');
  v_plan text;
  v_open integer;
  v_room public.rooms;
  v_slug text;
  v_attempt integer;
begin
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  if v_title is null or char_length(v_title) not between 1 and 80
     or v_source is null or v_source not in ('youtube', 'netflix', 'prime', 'disney')
     or v_visibility is null or v_visibility not in ('public', 'private')
     or v_control not in ('host', 'everyone')
     or (v_ref is not null and not public.valid_content_ref(v_source, v_ref)) then
    return public.rpc_error('invalid_input');
  end if;

  -- Locking the profile row serialises room creation per user, so two parallel calls cannot both
  -- pass the 20 room limit.
  select p.plan into v_plan from public.profiles p where p.id = v_uid for update;
  if not found then
    return public.rpc_error('internal');
  end if;

  select count(*) into v_open from public.rooms r where r.host_id = v_uid and r.status = 'open';
  if v_open >= 20 then
    return public.rpc_error('too_many_rooms');
  end if;

  for v_attempt in 1..5 loop
    -- 8 random bytes in base64 with + as -, / as _ and = removed; the first 10 characters hold
    -- 60 bits, enough that guessing a live room is impractical.
    v_slug := left(public.random_base64url(8), 10);
    insert into public.rooms as r (slug, host_id, title, visibility, source, content_ref, control_mode, room_cap, voice_mode)
    values (
      v_slug,
      v_uid,
      v_title,
      v_visibility,
      v_source,
      v_ref,
      v_control,
      case when v_plan = 'paid' then 10 else 3 end,
      case when v_plan = 'paid' then 'server' else 'mesh' end
    )
    on conflict (slug) do nothing
    returning r.* into v_room;
    exit when v_room.id is not null;
  end loop;

  if v_room.id is null then
    return public.rpc_error('internal');
  end if;

  insert into public.room_members (room_id, user_id, role, state, sync_mode)
  values (v_room.id, v_uid, 'host', 'joined', 'auto');

  insert into public.playback_state (room_id, seq, status, position_sec, rate, server_ts, paused_reason, updated_by)
  values (v_room.id, 0, 'paused', 0, 1, clock_timestamp(), 'user', v_uid);

  if v_visibility = 'private' then
    insert into public.room_secrets (room_id, join_key)
    values (v_room.id, public.random_base64url(16));
  end if;

  return public.rpc_ok(jsonb_build_object(
    'room', to_jsonb(v_room),
    'room_link', public.room_link(v_room.id)
  ));
end;
$$;

revoke execute on function public.create_room(text, text, text, text, text) from public, anon;
grant execute on function public.create_room(text, text, text, text, text) to authenticated;
