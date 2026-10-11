-- set_playback(room_id, expected_seq, status, position_sec, rate, start_delay_ms, reason)
-- reason `user`: the caller must be a controller (the host in control mode `host`, any member in
--   `everyone`); status `playing` or `paused` at position_sec.
-- reason `buffer`: wait for everyone. The caller must be the elected member and the room must have
--   wait for everyone on. A buffer pause is allowed only while playing; a buffer resume only while
--   paused with paused_reason `buffer`. The server computes the position from the current expected
--   position and keeps the rate, so position_sec and rate may be null.
-- reason `ended`: the caller must be the host or the elected member; only status `ended` at the
--   given position is written, keeping the rate.
-- If expected_seq matches, writes seq + 1 with server_ts = clock_timestamp() + start_delay_ms
-- (0 to 5,000; null means 0), sets paused_reason from reason on every pause and clears it
-- otherwise, and returns the row. Otherwise returns stale_seq with the current row in data.
-- rate, when given, must be between 0.0625 and 16 (what browsers accept); null keeps the rate.
-- data: <playback_state row>
-- codes: unauthorized, invalid_input, not_controller, not_elected, stale_seq (data: current row)
create function public.set_playback(
  room_id uuid,
  expected_seq bigint,
  status text,
  position_sec double precision,
  rate double precision,
  start_delay_ms integer,
  reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid := set_playback.room_id;
  v_expected bigint := set_playback.expected_seq;
  v_status text := set_playback.status;
  v_position double precision := set_playback.position_sec;
  v_rate double precision := set_playback.rate;
  v_delay integer := coalesce(set_playback.start_delay_ms, 0);
  v_reason text := set_playback.reason;
  v_room public.rooms;
  v_state public.playback_state;
  v_is_member boolean;
  v_now timestamptz;
begin
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  if v_room_id is null or v_expected is null
     or v_status is null or v_status not in ('playing', 'paused', 'ended')
     or v_reason is null or v_reason not in ('user', 'buffer', 'ended')
     or (v_reason = 'ended') <> (v_status = 'ended')
     or v_delay < 0 or v_delay > 5000
     or (v_rate is not null and not (v_rate >= 0.0625 and v_rate <= 16))
     or (v_reason <> 'buffer' and (v_position is null or not (v_position >= 0 and v_position < 'infinity'::double precision))) then
    return public.rpc_error('invalid_input');
  end if;

  select r.* into v_room from public.rooms r where r.id = v_room_id;
  v_is_member := found and exists (
    select 1 from public.room_members m
    where m.room_id = v_room_id and m.user_id = v_uid and m.state = 'joined'
  );

  if v_reason = 'user' then
    if not v_is_member or (v_room.control_mode = 'host' and v_room.host_id is distinct from v_uid) then
      return public.rpc_error('not_controller');
    end if;
  elsif v_reason = 'buffer' then
    if not v_is_member or public.elected_member(v_room_id) is distinct from v_uid then
      return public.rpc_error('not_elected');
    end if;
    if not v_room.wait_for_everyone then
      return public.rpc_error('invalid_input');
    end if;
  else
    if not v_is_member
       or (v_room.host_id is distinct from v_uid and public.elected_member(v_room_id) is distinct from v_uid) then
      return public.rpc_error('not_elected');
    end if;
  end if;

  select ps.* into v_state from public.playback_state ps where ps.room_id = v_room_id for update;
  if v_state.seq <> v_expected then
    return public.rpc_error('stale_seq', to_jsonb(v_state));
  end if;

  v_now := clock_timestamp();

  if v_reason = 'buffer' then
    if v_status = 'paused' and v_state.status <> 'playing' then
      return public.rpc_error('invalid_input');
    end if;
    if v_status = 'playing' and not (v_state.status = 'paused' and v_state.paused_reason = 'buffer') then
      return public.rpc_error('invalid_input');
    end if;
    v_position := public.expected_position(v_state, v_now);
    v_rate := v_state.rate;
  elsif v_reason = 'ended' then
    v_rate := v_state.rate;
  end if;

  update public.playback_state ps
  set seq = ps.seq + 1,
      status = v_status,
      position_sec = v_position,
      rate = coalesce(v_rate, ps.rate),
      server_ts = v_now + v_delay * interval '1 millisecond',
      paused_reason = case when v_status = 'paused' then v_reason end,
      updated_by = v_uid
  where ps.room_id = v_room_id
  returning ps.* into v_state;

  return public.rpc_ok(to_jsonb(v_state));
end;
$$;

revoke execute on function public.set_playback(uuid, bigint, text, double precision, double precision, integer, text) from public, anon;
grant execute on function public.set_playback(uuid, bigint, text, double precision, double precision, integer, text) to authenticated;
