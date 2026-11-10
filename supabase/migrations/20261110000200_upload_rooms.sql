-- Content reference validation, the same rules as `packages/sync-core/src/content-ref.ts`.
-- The client normalises what a person types before calling an RPC (Remote Procedure Call); the
-- database checks the stored form again.
--   youtube: exactly 11 characters of [A-Za-z0-9_-].
--   netflix, prime, disney: an https address whose host, lowercased and without any user name or
--   port, matches the service, with no fragment.
create or replace function public.valid_content_ref(source text, ref text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_authority text;
  v_host text;
begin
  if $1 is null or $2 is null then
    return false;
  end if;

  if $1 = 'upload' then return $2 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; end if;
  if $1 = 'youtube' then
    return $2 ~ '^[A-Za-z0-9_-]{11}$';
  end if;

  if $1 not in ('netflix', 'prime', 'disney') then
    return false;
  end if;

  -- The normalised form never holds whitespace, control characters or a fragment.
  if char_length($2) > 2048 or $2 ~ '[[:space:][:cntrl:]]' or position('#' in $2) > 0 then
    return false;
  end if;

  if left($2, 8) <> 'https://' then
    return false;
  end if;

  -- Authority: everything after the scheme up to the first slash, question mark or end.
  v_authority := substring($2 from '^https://([^/?]*)');
  -- Drop a user name (up to the last @) and a port, as a browser does when it reads the host.
  v_host := lower(regexp_replace(regexp_replace(coalesce(v_authority, ''), '^.*@', ''), ':[0-9]*$', ''));
  if v_host = '' then
    return false;
  end if;

  return case $1
    when 'netflix' then v_host ~ '^(www\.)?netflix\.com$'
    when 'prime' then v_host ~ '^(www\.)?(primevideo\.com|amazon\.(com|co\.uk|de|ca))$'
    when 'disney' then v_host ~ '^(www\.)?disneyplus\.com$'
  end;
end;
$$;

revoke execute on function public.valid_content_ref(text, text) from public, anon;
grant execute on function public.valid_content_ref(text, text) to authenticated;

alter table public.rooms drop constraint rooms_source_check;
alter table public.rooms add constraint rooms_source_check check(source in ('youtube','netflix','prime','disney','upload'));

-- create_room(title, source, content_ref, visibility, control_mode)
-- In one transaction: refuses a caller who already hosts 20 open rooms (abuse limit), generates
-- the slug (up to 5 tries on collision), takes room cap and voice mode from the caller's plan, and
-- inserts the room, the host as a present member, playback state (seq 0, paused at 0) and, for a
-- private room, a join key of 128 random bits.
-- data: { room: <room row>, room_link: text }
-- codes: unauthorized, invalid_input, too_many_rooms, internal
create or replace function public.create_room(
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
  perform 1 from public.app_config where key='movie_storage_cap_bytes' for update;
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  if v_title is null or char_length(v_title) not between 1 and 80
     or v_source is null or v_source not in ('youtube', 'netflix', 'prime', 'disney', 'upload')
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


  if v_source='upload' and v_ref is not null and not exists(select 1 from public.movies where id=v_ref::uuid and owner_id=v_uid and status='ready') then return public.rpc_error('movie_unavailable'); end if;

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

-- set_source(room_id, source, content_ref)
-- Host only. Validates the content reference (null is allowed, as at creation), then in one
-- transaction updates the room and resets playback to paused at 0 at normal rate with seq + 1.
-- data: { room: <room row>, playback_state: <playback_state row> }
-- codes: unauthorized, not_host, invalid_input
create or replace function public.set_source(room_id uuid, source text, content_ref text)
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
  perform 1 from public.app_config where key='movie_storage_cap_bytes' for update;
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  select r.* into v_room from public.rooms r where r.id = v_room_id for update;
  if not found or not public.is_room_host(v_room_id, v_uid) then
    return public.rpc_error('not_host');
  end if;

  if v_source is null or v_source not in ('youtube', 'netflix', 'prime', 'disney', 'upload')
     or (v_ref is not null and not public.valid_content_ref(v_source, v_ref)) then
    return public.rpc_error('invalid_input');
  end if;


  if v_source='upload' and v_ref is not null and not exists(select 1 from public.movies where id=v_ref::uuid and owner_id=v_uid and status='ready') then return public.rpc_error('movie_unavailable'); end if;

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
