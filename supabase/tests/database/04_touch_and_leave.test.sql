-- touch_member and leave_room: every code, what a refresh updates, the second browser context
-- case from E14, and host handover when the host leaves.
begin;
\ir _helpers.psql
select plan(43);

select tests.new_user('host');
select tests.new_user('g1');
select tests.new_user('g2');
select tests.new_user('g3');
select tests.new_user('stranger');

select tests.put('room', tests.new_room('host')::text);
select tests.put('g1_session', tests.join('g1', tests.id('room')) -> 'data' ->> 'engine_session');

-- touch_member codes ---------------------------------------------------------------------------

select tests.as_owner();
select is(tests.code(public.touch_member(tests.id('room'), tests.id('g1_session'), false, 'auto')), 'unauthorized', 'touch_member: unauthorized without a signed in user');
select tests.as_user('g1');
select is(tests.code(public.touch_member(tests.id('room'), null, false, 'auto')), 'invalid_input', 'touch_member: invalid_input without an engine session');
select is(tests.code(public.touch_member(tests.id('room'), tests.id('g1_session'), false, 'sideways')), 'invalid_input', 'touch_member: invalid_input for an unknown sync mode');
select is(tests.code(public.touch_member(gen_random_uuid(), tests.id('g1_session'), false, 'auto')), 'not_member', 'touch_member: not_member for a room that does not exist');
select tests.as_user('stranger');
select is(tests.code(public.touch_member(tests.id('room'), gen_random_uuid(), false, 'auto')), 'not_member', 'touch_member: not_member without a row');
select tests.as_user('g1');
select is(tests.code(public.touch_member(tests.id('room'), gen_random_uuid(), false, 'auto')), 'replaced', 'touch_member: replaced for an engine session that is not the current one');

-- A refresh ---------------------------------------------------------------------------------------

select tests.set_seen(tests.id('room'), 'g1', 30);
select tests.as_owner();
update public.rooms set last_active_at = clock_timestamp() - interval '10 minutes' where id = tests.id('room');
select tests.as_user('g1');
select tests.put('touch', public.touch_member(tests.id('room'), tests.id('g1_session'), false, 'cue')::text);
select is(tests.code(tests.get('touch')::jsonb), 'ok', 'touch_member: ok for the current engine session');
select ok((tests.member(tests.id('room'), 'g1')).last_seen_at > clock_timestamp() - interval '5 seconds', 'touch_member: sets last_seen_at');
select ok((tests.room(tests.id('room'))).last_active_at > clock_timestamp() - interval '5 seconds', 'touch_member: sets rooms.last_active_at');
select is((tests.member(tests.id('room'), 'g1')).sync_mode, 'cue', 'touch_member: sets sync_mode');
select is((tests.get('touch')::jsonb -> 'data' ->> 'channel_epoch')::integer, 1, 'touch_member: returns the channel epoch');
select ok(not (tests.get('touch')::jsonb -> 'data' -> 'member' ? 'engine_session'), 'touch_member: the member in data has no engine session');
select is(tests.sent(tests.id('room'), 'members'), 2, 'touch_member: a refresh sends no members event');

select tests.put('t0', public.touch_member(tests.id('room'), tests.id('g1_session'), true, 'auto')::text);
select isnt((tests.member(tests.id('room'), 'g1')).buffering_since, null, 'touch_member: buffering true sets buffering_since');
select tests.put('since', (tests.member(tests.id('room'), 'g1')).buffering_since::text);
select public.touch_member(tests.id('room'), tests.id('g1_session'), true, 'auto');
select is((tests.member(tests.id('room'), 'g1')).buffering_since::text, tests.get('since'), 'touch_member: buffering_since keeps the moment buffering started');
select public.touch_member(tests.id('room'), tests.id('g1_session'), null, null);
select is((tests.member(tests.id('room'), 'g1')).buffering_since::text, tests.get('since'), 'touch_member: a null buffering leaves it as it is');
select is((tests.member(tests.id('room'), 'g1')).sync_mode, 'auto', 'touch_member: a null sync mode leaves it as it is');
select public.touch_member(tests.id('room'), tests.id('g1_session'), false, 'auto');
select is((tests.member(tests.id('room'), 'g1')).buffering_since, null, 'touch_member: buffering false clears buffering_since');

-- Second browser context (E14) ---------------------------------------------------------------

select tests.put('g1_second', tests.join('g1', tests.id('room')) -> 'data' ->> 'engine_session');
select tests.as_user('g1');
select is(tests.code(public.touch_member(tests.id('room'), tests.id('g1_session'), false, 'auto')), 'replaced', 'touch_member: the first context is replaced after the same person joins elsewhere');
select is(tests.code(public.touch_member(tests.id('room'), tests.id('g1_second'), false, 'auto')), 'ok', 'touch_member: the second context carries on');

-- Coming back after being absent: the cap is checked again ----------------------------------

select tests.put('g2_session', tests.join('g2', tests.id('room')) -> 'data' ->> 'engine_session');
select tests.set_seen(tests.id('room'), 'g2', 61);
select tests.join('g3', tests.id('room'));
select tests.as_user('g2');
select is(tests.code(public.touch_member(tests.id('room'), tests.id('g2_session'), false, 'auto')), 'room_full', 'touch_member: room_full when another person took the absent member''s slot');
select is((public.touch_member(tests.id('room'), tests.id('g2_session'), false, 'auto') -> 'data' ->> 'room_cap')::integer, 3, 'touch_member: room_full carries the room cap');
select tests.set_seen(tests.id('room'), 'g3', 61);
select is(tests.code(public.touch_member(tests.id('room'), tests.id('g2_session'), false, 'auto')), 'ok', 'touch_member: an absent member comes back when a slot is free');

-- removed, banned, left, closed --------------------------------------------------------------

select tests.put('mod_room', tests.new_room('host')::text);
select tests.put('s1', tests.join('g1', tests.id('mod_room')) -> 'data' ->> 'engine_session');
select tests.put('s2', tests.join('g2', tests.id('mod_room')) -> 'data' ->> 'engine_session');
select tests.call_as('host', format('public.moderate(%L, %L, %L)', tests.id('mod_room'), tests.uid('g1'), 'remove'));
select tests.call_as('host', format('public.moderate(%L, %L, %L)', tests.id('mod_room'), tests.uid('g2'), 'ban'));
select tests.as_user('g1');
select is(tests.code(public.touch_member(tests.id('mod_room'), tests.id('s1'), false, 'auto')), 'removed', 'touch_member: removed for a removed member');
select tests.as_user('g2');
select is(tests.code(public.touch_member(tests.id('mod_room'), tests.id('s2'), false, 'auto')), 'banned', 'touch_member: banned for a banned member');

select tests.put('left_room', tests.new_room('host')::text);
select tests.put('s3', tests.join('g3', tests.id('left_room')) -> 'data' ->> 'engine_session');
select tests.as_user('g3');
select public.leave_room(tests.id('left_room'));
select is(tests.code(public.touch_member(tests.id('left_room'), tests.id('s3'), false, 'auto')), 'not_member', 'touch_member: not_member after leaving');

select tests.put('closed_room', tests.new_room('host')::text);
select tests.put('s4', tests.join('g3', tests.id('closed_room')) -> 'data' ->> 'engine_session');
select tests.call_as('host', format('public.close_room(%L)', tests.id('closed_room')));
select tests.as_user('g3');
select is(tests.code(public.touch_member(tests.id('closed_room'), tests.id('s4'), false, 'auto')), 'closed', 'touch_member: closed once the host closes the room');

-- leave_room -------------------------------------------------------------------------------------

select tests.put('leave_room', tests.new_room('host')::text);
select tests.join('g1', tests.id('leave_room'));
select tests.join('g2', tests.id('leave_room'));
select tests.as_owner();
select is(tests.code(public.leave_room(tests.id('leave_room'))), 'unauthorized', 'leave_room: unauthorized without a signed in user');
select tests.as_user('stranger');
select is(tests.code(public.leave_room(tests.id('leave_room'))), 'not_member', 'leave_room: not_member without a row');

select tests.as_user('g2');
select is(tests.code(public.leave_room(tests.id('leave_room'))), 'ok', 'leave_room: a guest leaves');
select is((tests.member(tests.id('leave_room'), 'g2')).state, 'left', 'leave_room: the member is marked left');
select isnt((tests.member(tests.id('leave_room'), 'g2')).left_at, null, 'leave_room: left_at is set');
select is(
  (select m.body::jsonb from tests.system_messages(tests.id('leave_room'), 'left') m),
  jsonb_build_object('user_id', tests.uid('g2')),
  'leave_room: posts a left system message with the user id'
);
select is(tests.code(public.leave_room(tests.id('leave_room'))), 'not_member', 'leave_room: not_member when already left');
select is((tests.room(tests.id('leave_room'))).host_id, tests.uid('host'), 'leave_room: a guest leaving does not move host');

-- The host leaves: host goes to the present guest who joined first (E9).
select tests.join('g2', tests.id('leave_room'));
select tests.join('g3', tests.id('leave_room'));
select tests.as_owner();
update public.room_members set first_joined_at = clock_timestamp() - interval '2 hours' where room_id = tests.id('leave_room') and user_id = tests.uid('g3');
update public.room_members set first_joined_at = clock_timestamp() - interval '1 hour' where room_id = tests.id('leave_room') and user_id = tests.uid('g1');
select tests.set_seen(tests.id('leave_room'), 'g3', 61);
select tests.as_user('host');
select is(public.leave_room(tests.id('leave_room')) -> 'data' ->> 'host_id', tests.uid('g1')::text, 'leave_room: returns the new host');
select is((tests.room(tests.id('leave_room'))).host_id, tests.uid('g1'), 'leave_room: host goes to the present guest with the earliest first_joined_at, skipping an absent one');
select is((tests.member(tests.id('leave_room'), 'g1')).role, 'host', 'leave_room: the new host gets role host');
select is((tests.member(tests.id('leave_room'), 'host')).role, 'guest', 'leave_room: the old host becomes a guest');
select is(
  (select m.body::jsonb from tests.system_messages(tests.id('leave_room'), 'host_changed') m),
  jsonb_build_object('user_id', tests.uid('g1')),
  'leave_room: posts host_changed naming the new host'
);

-- The host leaves with no present guest: the room keeps its host id.
select tests.put('alone_room', tests.new_room('host')::text);
select tests.join('g1', tests.id('alone_room'));
select tests.set_seen(tests.id('alone_room'), 'g1', 61);
select tests.as_user('host');
select public.leave_room(tests.id('alone_room'));
select is((tests.room(tests.id('alone_room'))).host_id, tests.uid('host'), 'leave_room: with no present guest the room keeps its host id');
select is((select count(*)::integer from tests.system_messages(tests.id('alone_room'), 'host_changed')), 0, 'leave_room: no host_changed without a new host');
select is((tests.member(tests.id('alone_room'), 'host')).role, 'host', 'leave_room: the absent host keeps role host');

select * from finish();
rollback;
