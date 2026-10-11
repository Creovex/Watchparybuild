-- Helpers shared by policies, RPCs, triggers and scheduled jobs.
-- Only `is_member` is executable by signed in users, because read policies call it. Every other
-- helper runs inside SECURITY DEFINER functions or jobs, which execute as the owner.

-- True when the caller has a `joined` row in the room. SECURITY DEFINER so policies on
-- room_members can call it without recursing into their own policy.
create function public.is_member(room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.room_members m
    where m.room_id = is_member.room_id
      and m.user_id = auth.uid()
      and m.state = 'joined'
  );
$$;

revoke execute on function public.is_member(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;

-- RPC result envelopes: `{ "ok": true, "data": ... }` and `{ "ok": false, "code": ..., "data": ... }`.
create function public.rpc_ok(data jsonb default null)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('ok', true, 'data', $1);
$$;

create function public.rpc_error(code text, data jsonb default null)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when $2 is null then jsonb_build_object('ok', false, 'code', $1)
    else jsonb_build_object('ok', false, 'code', $1, 'data', $2)
  end;
$$;

-- The moment before which a `joined` member counts as absent: 60 seconds ago.
create function public.present_since()
returns timestamptz
language sql
volatile
set search_path = ''
as $$
  select clock_timestamp() - interval '60 seconds';
$$;

-- Number of present members in a room.
create function public.present_count(room_id uuid)
returns integer
language sql
volatile
set search_path = ''
as $$
  select count(*)::integer
  from public.room_members m
  where m.room_id = $1
    and m.state = 'joined'
    and m.last_seen_at > public.present_since();
$$;

-- The elected member: the present member on auto sync with the earliest first_joined_at. Null when
-- no present member is on auto sync.
create function public.elected_member(room_id uuid)
returns uuid
language sql
volatile
set search_path = ''
as $$
  select m.user_id
  from public.room_members m
  where m.room_id = $1
    and m.state = 'joined'
    and m.last_seen_at > public.present_since()
    and m.sync_mode = 'auto'
  order by m.first_joined_at, m.user_id
  limit 1;
$$;

-- True when the user is the room's host and has a `joined` row.
create function public.is_room_host(room_id uuid, user_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.rooms r
    join public.room_members m on m.room_id = r.id and m.user_id = r.host_id
    where r.id = $1
      and r.host_id = $2
      and m.state = 'joined'
  );
$$;

-- Expected position at a moment, as in "Sync design": while playing and past server_ts the
-- position advances at the rate; during a countdown, while paused and once ended it holds.
create function public.expected_position(state public.playback_state, at timestamptz)
returns double precision
language sql
immutable
set search_path = ''
as $$
  select case
    when ($1).status = 'playing' and $2 >= ($1).server_ts
      then ($1).position_sec + extract(epoch from ($2 - ($1).server_ts))::double precision * ($1).rate
    else ($1).position_sec
  end;
$$;

-- Cryptographically random bytes as base64url without padding.
create function public.random_base64url(bytes integer)
returns text
language sql
volatile
set search_path = ''
as $$
  select translate(rtrim(encode(extensions.gen_random_bytes($1), 'base64'), '='), '+/', '-_');
$$;

-- The room link: `<site_url>/r/<slug>` for a public room, with `#k=<join_key>` added for a
-- private room.
create function public.room_link(room_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select rtrim(c.value, '/') || '/r/' || r.slug
    || case when r.visibility = 'private' then '#k=' || s.join_key else '' end
  from public.rooms r
  cross join public.app_config c
  left join public.room_secrets s on s.room_id = r.id
  where r.id = $1
    and c.key = 'site_url';
$$;

-- The server topic for a room at an epoch: `room:<room_id>:<epoch>:server`.
create function public.server_topic(room_id uuid, epoch integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'room:' || $1::text || ':' || $2::text || ':server';
$$;

-- Writes a system message. `body` is stored as JSON text.
create function public.insert_system_message(room_id uuid, user_id uuid, system_code text, body jsonb)
returns public.messages
language sql
volatile
set search_path = ''
as $$
  insert into public.messages (room_id, user_id, kind, body, system_code)
  values ($1, $2, 'system', $4::text, $3)
  returning *;
$$;

revoke execute on function public.rpc_ok(jsonb) from public, anon, authenticated;
revoke execute on function public.rpc_error(text, jsonb) from public, anon, authenticated;
revoke execute on function public.present_since() from public, anon, authenticated;
revoke execute on function public.present_count(uuid) from public, anon, authenticated;
revoke execute on function public.elected_member(uuid) from public, anon, authenticated;
revoke execute on function public.is_room_host(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.expected_position(public.playback_state, timestamptz) from public, anon, authenticated;
revoke execute on function public.random_base64url(integer) from public, anon, authenticated;
revoke execute on function public.room_link(uuid) from public, anon, authenticated;
revoke execute on function public.server_topic(uuid, integer) from public, anon, authenticated;
revoke execute on function public.insert_system_message(uuid, uuid, text, jsonb) from public, anon, authenticated;
