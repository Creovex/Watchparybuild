-- set_playback, set_source and the expected position helper: controllers, the elected member,
-- the buffer and ended rules, stale seq and the countdown delay.
begin;
\ir _helpers.psql
select plan(67);

select tests.new_user('host');
select tests.new_user('g1');
select tests.new_user('g2');
select tests.new_user('stranger');

select tests.put('room', tests.new_room('host')::text);
select tests.join('g1', tests.id('room'), 'auto');
select tests.join('g2', tests.id('room'), 'cue');

-- Expected position ----------------------------------------------------------------------------

select is(
  public.expected_position(row(gen_random_uuid(), 1, 'playing', 100, 1, '2026-10-11 12:00:00+00', null, null)::public.playback_state, '2026-10-11 12:00:10+00'),
  110::double precision,
  'expected position: playing advances with time'
);
select is(
  public.expected_position(row(gen_random_uuid(), 1, 'playing', 100, 2, '2026-10-11 12:00:00+00', null, null)::public.playback_state, '2026-10-11 12:00:10+00'),
  120::double precision,
  'expected position: playing advances at the rate'
);
select is(
  public.expected_position(row(gen_random_uuid(), 1, 'playing', 100, 1, '2026-10-11 12:00:04+00', null, null)::public.playback_state, '2026-10-11 12:00:01+00'),
  100::double precision,
  'expected position: holds during a countdown'
);
select is(
  public.expected_position(row(gen_random_uuid(), 1, 'paused', 100, 1, '2026-10-11 12:00:00+00', 'user', null)::public.playback_state, '2026-10-11 12:00:10+00'),
  100::double precision,
  'expected position: holds while paused'
);
select is(
  public.expected_position(row(gen_random_uuid(), 1, 'ended', 100, 1, '2026-10-11 12:00:00+00', null, null)::public.playback_state, '2026-10-11 12:00:10+00'),
  100::double precision,
  'expected position: holds once ended'
);

-- Input checks ---------------------------------------------------------------------------------

select tests.as_owner();
select is(tests.code(public.set_playback(tests.id('room'), 0, 'playing', 0, 1, 0, 'user')), 'unauthorized', 'set_playback: unauthorized without a signed in user');
select tests.as_user('host');
select is(tests.code(public.set_playback(tests.id('room'), 0, 'rewinding', 0, 1, 0, 'user')), 'invalid_input', 'set_playback: invalid_input for an unknown status');
select is(tests.code(public.set_playback(tests.id('room'), 0, 'playing', 0, 1, 0, 'because')), 'invalid_input', 'set_playback: invalid_input for an unknown reason');
select is(tests.code(public.set_playback(tests.id('room'), 0, 'ended', 10, 1, 0, 'user')), 'invalid_input', 'set_playback: invalid_input for status ended with reason user');
select is(tests.code(public.set_playback(tests.id('room'), 0, 'paused', 10, 1, 0, 'ended')), 'invalid_input', 'set_playback: invalid_input for reason ended without status ended');
select is(tests.code(public.set_playback(tests.id('room'), 0, 'playing', 0, 1, 5001, 'user')), 'invalid_input', 'set_playback: invalid_input for a start delay over 5,000 ms');
select is(tests.code(public.set_playback(tests.id('room'), 0, 'playing', 0, 1, -1, 'user')), 'invalid_input', 'set_playback: invalid_input for a negative start delay');
select is(tests.code(public.set_playback(tests.id('room'), 0, 'playing', 0, 0, 0, 'user')), 'invalid_input', 'set_playback: invalid_input for rate 0');
select is(tests.code(public.set_playback(tests.id('room'), 0, 'playing', 0, 17, 0, 'user')), 'invalid_input', 'set_playback: invalid_input for rate above 16');
select is(tests.code(public.set_playback(tests.id('room'), 0, 'playing', -1, 1, 0, 'user')), 'invalid_input', 'set_playback: invalid_input for a negative position');
select is(tests.code(public.set_playback(tests.id('room'), 0, 'playing', 'NaN', 1, 0, 'user')), 'invalid_input', 'set_playback: invalid_input for a position that is not a number');
select is(tests.code(public.set_playback(tests.id('room'), 0, 'playing', null, 1, 0, 'user')), 'invalid_input', 'set_playback: invalid_input without a position for reason user');
select is(tests.code(public.set_playback(tests.id('room'), null, 'playing', 0, 1, 0, 'user')), 'invalid_input', 'set_playback: invalid_input without expected_seq');

-- Controllers ----------------------------------------------------------------------------------

select tests.as_user('g1');
select is(tests.code(public.set_playback(tests.id('room'), 0, 'playing', 0, 1, 0, 'user')), 'not_controller', 'set_playback: not_controller for a guest in control mode host');
select tests.as_user('stranger');
select is(tests.code(public.set_playback(tests.id('room'), 0, 'playing', 0, 1, 0, 'user')), 'not_controller', 'set_playback: not_controller for someone who is not a member');
select is((tests.playback(tests.id('room'))).seq, 0::bigint, 'set_playback: refused calls change nothing');

select tests.as_user('host');
select tests.put('play', public.set_playback(tests.id('room'), 0, 'playing', 12.5, 1, 4000, 'user')::text);
select is(tests.code(tests.get('play')::jsonb), 'ok', 'set_playback: the host plays');
select is((tests.get('play')::jsonb -> 'data' ->> 'seq')::bigint, 1::bigint, 'set_playback: seq goes up by one');
select is((tests.playback(tests.id('room'))).position_sec, 12.5::double precision, 'set_playback: position is stored');
select ok(
  (tests.playback(tests.id('room'))).server_ts between clock_timestamp() + interval '3.5 seconds' and clock_timestamp() + interval '4 seconds',
  'set_playback: server_ts is now plus the start delay for a countdown'
);
select is((tests.playback(tests.id('room'))).paused_reason, null, 'set_playback: paused_reason is null while playing');
select is((tests.playback(tests.id('room'))).updated_by, tests.uid('host'), 'set_playback: updated_by is the caller');
select is(tests.sent(tests.id('room'), 'state', 1), 2, 'set_playback: the state event goes to the server topic');

select tests.put('stale', public.set_playback(tests.id('room'), 0, 'paused', 13, 1, 0, 'user')::text);
select is(tests.code(tests.get('stale')::jsonb), 'stale_seq', 'set_playback: stale_seq for an old expected_seq');
select is(tests.get('stale')::jsonb -> 'data', to_jsonb(tests.playback(tests.id('room'))), 'set_playback: stale_seq carries the current row');

select tests.put('pause', public.set_playback(tests.id('room'), 1, 'paused', 20, 1, 0, 'user')::text);
select is((tests.playback(tests.id('room'))).paused_reason, 'user', 'set_playback: a user pause sets paused_reason user');
select is((tests.playback(tests.id('room'))).rate, 1::double precision, 'set_playback: rate is stored');

select tests.call_as('host', format('public.update_room_settings(%L, %L)', tests.id('room'), '{"control_mode": "everyone"}'));
select tests.as_user('g2');
select is(tests.code(public.set_playback(tests.id('room'), 2, 'playing', 20, 1, 0, 'user')), 'ok', 'set_playback: any member controls in control mode everyone');
select tests.call_as('host', format('public.update_room_settings(%L, %L)', tests.id('room'), '{"control_mode": "host"}'));

-- The elected member and buffer pauses ---------------------------------------------------------

-- Playing since 10 seconds ago at 100: the expected position is about 110.
select tests.as_owner();
update public.playback_state
set seq = 10, status = 'playing', position_sec = 100, rate = 1, server_ts = clock_timestamp() - interval '10 seconds', paused_reason = null
where room_id = tests.id('room');
-- The host joined first and is on auto sync, so the host is the elected member.
select tests.as_user('g1');
select is(tests.code(public.set_playback(tests.id('room'), 10, 'paused', null, null, 0, 'buffer')), 'not_elected', 'set_playback: not_elected for a buffer call from a member who is not elected');
select tests.as_user('g2');
select is(tests.code(public.set_playback(tests.id('room'), 10, 'paused', null, null, 0, 'buffer')), 'not_elected', 'set_playback: a member on cue sync is never elected');
select tests.as_user('stranger');
select is(tests.code(public.set_playback(tests.id('room'), 10, 'paused', null, null, 0, 'buffer')), 'not_elected', 'set_playback: not_elected for someone who is not a member');

select tests.as_user('host');
select is(tests.code(public.set_playback(tests.id('room'), 10, 'playing', null, null, 0, 'buffer')), 'invalid_input', 'set_playback: a buffer resume is refused unless paused for buffering');
select is(tests.code(public.set_playback(tests.id('room'), 9, 'paused', null, null, 0, 'buffer')), 'stale_seq', 'set_playback: a buffer call with an old seq is stale_seq');
select tests.put('buffer', public.set_playback(tests.id('room'), 10, 'paused', 5, 2, 0, 'buffer')::text);
select is(tests.code(tests.get('buffer')::jsonb), 'ok', 'set_playback: the elected member pauses for buffering while playing');
select is((tests.playback(tests.id('room'))).paused_reason, 'buffer', 'set_playback: a buffer pause sets paused_reason buffer');
select ok((tests.playback(tests.id('room'))).position_sec between 109.9 and 111, 'set_playback: the server computes the buffer pause position from the expected position, ignoring the given one');
select is((tests.playback(tests.id('room'))).rate, 1::double precision, 'set_playback: a buffer call keeps the rate');
select is(tests.code(public.set_playback(tests.id('room'), 11, 'paused', null, null, 0, 'buffer')), 'invalid_input', 'set_playback: a buffer pause is refused unless playing');

select tests.put('paused_at', (tests.playback(tests.id('room'))).position_sec::text);
select is(tests.code(public.set_playback(tests.id('room'), 11, 'playing', null, null, 0, 'buffer')), 'ok', 'set_playback: a buffer resume while paused for buffering');
select is((tests.playback(tests.id('room'))).position_sec::text, tests.get('paused_at'), 'set_playback: a buffer resume starts from the paused position');
select is((tests.playback(tests.id('room'))).status, 'playing', 'set_playback: the buffer resume plays');

-- A user pause is never resumed by the buffer rule.
select public.set_playback(tests.id('room'), 12, 'paused', 50, 1, 0, 'user');
select is(tests.code(public.set_playback(tests.id('room'), 13, 'playing', null, null, 0, 'buffer')), 'invalid_input', 'set_playback: a pause a controller made is not resumed by a buffer call');

-- When the host is absent, the next auto sync member is elected.
select public.set_playback(tests.id('room'), 13, 'playing', 50, 1, 0, 'user');
select tests.set_seen(tests.id('room'), 'host', 61);
select tests.as_user('g1');
select is(tests.code(public.set_playback(tests.id('room'), 14, 'paused', null, null, 0, 'buffer')), 'ok', 'set_playback: with the host absent, the auto sync member who joined next is elected');
select tests.as_owner();
select tests.call_as('g1', format('public.touch_member(%L, %L, false, %L)', tests.id('room'), (tests.member(tests.id('room'), 'g1')).engine_session, 'cue'));
select tests.as_user('g1');
select is(tests.code(public.set_playback(tests.id('room'), 15, 'playing', null, null, 0, 'buffer')), 'not_elected', 'set_playback: with nobody present on auto sync there is no elected member');

-- Wait for everyone off.
select tests.as_owner();
select tests.call_as('g1', format('public.touch_member(%L, %L, false, %L)', tests.id('room'), (tests.member(tests.id('room'), 'g1')).engine_session, 'auto'));
select tests.set_seen(tests.id('room'), 'host', 0);
select tests.call_as('host', format('public.update_room_settings(%L, %L)', tests.id('room'), '{"wait_for_everyone": false}'));
select tests.as_user('host');
select is(tests.code(public.set_playback(tests.id('room'), 15, 'playing', null, null, 0, 'buffer')), 'invalid_input', 'set_playback: buffer calls are refused when wait for everyone is off');
select tests.call_as('host', format('public.update_room_settings(%L, %L)', tests.id('room'), '{"wait_for_everyone": true}'));

-- Ended -------------------------------------------------------------------------------------

select tests.as_user('g1');
select is(tests.code(public.set_playback(tests.id('room'), 15, 'ended', 600, null, 0, 'ended')), 'not_elected', 'set_playback: ended is refused from a guest who is not elected');
select tests.as_user('host');
select is(tests.code(public.set_playback(tests.id('room'), 15, 'ended', 600, 2, 0, 'ended')), 'ok', 'set_playback: the host reports the end');
select is((tests.playback(tests.id('room'))).status, 'ended', 'set_playback: status is ended');
select is((tests.playback(tests.id('room'))).position_sec, 600::double precision, 'set_playback: ended is written at the given position');
select is((tests.playback(tests.id('room'))).rate, 1::double precision, 'set_playback: ended keeps the rate');
select is((tests.playback(tests.id('room'))).paused_reason, null, 'set_playback: ended has no paused_reason');
-- The elected member reports the end when the host is on cue sync.
select tests.call_as('host', format('public.touch_member(%L, %L, false, %L)', tests.id('room'), (tests.member(tests.id('room'), 'host')).engine_session, 'cue'));
select tests.as_user('g1');
select is(tests.code(public.set_playback(tests.id('room'), 16, 'ended', 601, null, 0, 'ended')), 'ok', 'set_playback: the elected member reports the end');

-- set_source -----------------------------------------------------------------------------------

select tests.as_owner();
select is(tests.code(public.set_source(tests.id('room'), 'youtube', 'dQw4w9WgXcQ')), 'unauthorized', 'set_source: unauthorized without a signed in user');
select tests.as_user('g1');
select is(tests.code(public.set_source(tests.id('room'), 'youtube', 'dQw4w9WgXcQ')), 'not_host', 'set_source: not_host for a guest');
select tests.as_user('host');
select is(tests.code(public.set_source(tests.id('room'), 'youtube', 'not-an-id')), 'invalid_input', 'set_source: invalid_input for an invalid content reference');
select is(tests.code(public.set_source(tests.id('room'), 'hulu', null)), 'invalid_input', 'set_source: invalid_input for an unknown source');
select tests.put('sent_room_before', tests.sent(tests.id('room'), 'room')::text);
select tests.put('src', public.set_source(tests.id('room'), 'prime', 'https://www.primevideo.com/detail/0ABC')::text);
select is(tests.code(tests.get('src')::jsonb), 'ok', 'set_source: the host changes the source');
select is((tests.room(tests.id('room'))).source || ' ' || (tests.room(tests.id('room'))).content_ref, 'prime https://www.primevideo.com/detail/0ABC', 'set_source: the room holds the new source and reference');
select is((tests.playback(tests.id('room'))).seq, 18::bigint, 'set_source: seq goes up by one');
select is(
  (tests.playback(tests.id('room'))).status || ' ' || (tests.playback(tests.id('room'))).position_sec || ' ' || (tests.playback(tests.id('room'))).rate,
  'paused 0 1',
  'set_source: playback resets to paused at 0 at normal rate'
);
select is(tests.sent(tests.id('room'), 'room'), tests.get('sent_room_before')::integer + 1, 'set_source: the room event is sent');
select is(tests.code(public.set_source(tests.id('room'), 'disney', null)), 'ok', 'set_source: a null content reference is allowed');

select * from finish();
rollback;
