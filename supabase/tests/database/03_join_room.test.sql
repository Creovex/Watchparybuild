-- join_room: every code, the room cap for free and paid hosts, private keys, the lock, and what
-- the member row keeps across joins.
begin;
\ir _helpers.psql
select plan(47);

select tests.new_user('host');
select tests.new_user('g1');
select tests.new_user('g2');
select tests.new_user('g3');
select tests.new_user('newcomer');
select tests.new_user('phost', 'paid');
select tests.new_user(name) from (select 'p' || n as name from generate_series(1, 10) n) people;

select tests.put('room', tests.new_room('host')::text);
select tests.put('slug', tests.slug(tests.id('room')));

-- Codes before any checks on the room ------------------------------------------------------

select tests.as_owner();
select is(tests.code(public.join_room(tests.get('slug'), null, 'auto')), 'unauthorized', 'join_room: unauthorized without a signed in user');
select tests.as_user('g1');
select is(tests.code(public.join_room(tests.get('slug'), null, 'sideways')), 'invalid_input', 'join_room: invalid_input for an unknown sync mode');
select is(tests.code(public.join_room(tests.get('slug'), null, null)), 'invalid_input', 'join_room: invalid_input without a sync mode');
select is(tests.code(public.join_room('nosuchroom', null, 'auto')), 'not_found', 'join_room: not_found for an unknown slug');

-- A first join -------------------------------------------------------------------------------

select tests.put('result', public.join_room(tests.get('slug'), null, 'cue')::text);
select is(tests.code(tests.get('result')::jsonb), 'ok', 'join_room: a signed in user joins a public room');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(tests.get('result')::jsonb -> 'data') k),
  array['channel_epoch', 'engine_session', 'playback_state', 'room'],
  'join_room: data holds room, playback_state, channel_epoch and engine_session'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(tests.get('result')::jsonb -> 'data' -> 'playback_state') k),
  array['paused_reason', 'position_sec', 'rate', 'room_id', 'seq', 'server_ts', 'status', 'updated_by'],
  'join_room: playback_state has exactly the PlaybackStateRow fields'
);
select is((tests.get('result')::jsonb -> 'data' ->> 'channel_epoch')::integer, 1, 'join_room: returns the channel epoch');
select is(
  (tests.get('result')::jsonb -> 'data' ->> 'engine_session')::uuid,
  (tests.member(tests.id('room'), 'g1')).engine_session,
  'join_room: returns the member''s engine session'
);
select is((tests.member(tests.id('room'), 'g1')).role, 'guest', 'join_room: a guest gets role guest');
select is((tests.member(tests.id('room'), 'g1')).sync_mode, 'cue', 'join_room: sync mode comes from the input');
select is(
  (select count(*)::integer from tests.system_messages(tests.id('room'), 'joined') m where m.body::jsonb = jsonb_build_object('user_id', tests.uid('g1'))),
  1,
  'join_room: posts a joined system message with the user id'
);
select is(tests.sent(tests.id('room'), 'members', 1), 2, 'join_room: the new member row is sent on the server topic');

-- Joining again while joined and present -----------------------------------------------------

select tests.put('first_joined', (tests.member(tests.id('room'), 'g1')).first_joined_at::text);
select tests.put('again', public.join_room(tests.get('slug'), null, 'auto')::text);
select is(tests.code(tests.get('again')::jsonb), 'ok', 'join_room: joining again is ok');
select isnt(
  tests.get('again')::jsonb -> 'data' ->> 'engine_session',
  tests.get('result')::jsonb -> 'data' ->> 'engine_session',
  'join_room: every join issues a new engine session'
);
select is((tests.member(tests.id('room'), 'g1')).first_joined_at::text, tests.get('first_joined'), 'join_room: first_joined_at is kept');
select is((tests.member(tests.id('room'), 'g1')).sync_mode, 'auto', 'join_room: sync mode is updated');
select is((select count(*)::integer from tests.system_messages(tests.id('room'), 'joined')), 1, 'join_room: no second joined message for a member already joined');

-- Room cap on a free host's room: 3 present members ----------------------------------------

select is(tests.code(tests.join('g2', tests.id('room'))), 'ok', 'join_room: the third present member is admitted');
select tests.as_user('g3');
select is(tests.code(public.join_room(tests.get('slug'), null, 'auto')), 'room_full', 'join_room: room_full for a fourth person in a free host''s room');
select is((public.join_room(tests.get('slug'), null, 'auto') -> 'data' ->> 'room_cap')::integer, 3, 'join_room: room_full carries the room cap');
select is(tests.code(tests.join('g2', tests.id('room'))), 'ok', 'join_room: a member already joined and present is admitted at the cap without counting twice');
select tests.set_seen(tests.id('room'), 'g2', 61);
select is(tests.code(tests.join('g3', tests.id('room'))), 'ok', 'join_room: an absent member frees the slot');
select is(tests.code(tests.join('g2', tests.id('room'))), 'room_full', 'join_room: the absent member is refused once the slot is taken');

-- Room cap on a paid host's room: 10 present members ---------------------------------------

select tests.put('paid_room', tests.new_room('phost')::text);
select is(
  (select count(*)::integer from generate_series(1, 9) n where tests.code(tests.join('p' || n, tests.id('paid_room'))) = 'ok'),
  9,
  'join_room: a paid host''s room admits nine guests beside the host'
);
select is(tests.code(tests.join('p10', tests.id('paid_room'))), 'room_full', 'join_room: room_full for the eleventh person in a paid host''s room');
select is((tests.join('p10', tests.id('paid_room')) -> 'data' ->> 'room_cap')::integer, 10, 'join_room: room_full carries room cap 10');

-- Closed rooms ---------------------------------------------------------------------------------

select tests.put('closed_room', tests.new_room('host')::text);
select tests.call_as('host', format('public.close_room(%L)', tests.id('closed_room')));
select is(tests.code(tests.join('g1', tests.id('closed_room'))), 'closed', 'join_room: closed for a closed room');

-- Private rooms --------------------------------------------------------------------------------

select tests.put('private_room', tests.new_room('host', 'private')::text);
select tests.put('private_slug', tests.slug(tests.id('private_room')));
select tests.as_user('g1');
select is(tests.code(public.join_room(tests.get('private_slug'), null, 'auto')), 'bad_key', 'join_room: bad_key without a key');
select is(tests.code(public.join_room(tests.get('private_slug'), 'AAAAAAAAAAAAAAAAAAAAAA', 'auto')), 'bad_key', 'join_room: bad_key for a wrong key');
select is(tests.code(public.join_room(tests.get('private_slug'), '', 'auto')), 'bad_key', 'join_room: bad_key for an empty key');
select is(tests.code(public.join_room(tests.get('private_slug'), tests.join_key(tests.id('private_room')), 'auto')), 'ok', 'join_room: the right key admits');
select is(tests.code(public.join_room(tests.get('private_slug'), null, 'auto')), 'ok', 'join_room: a joined member opens the room again without the key');
select tests.as_user('host');
select is(tests.code(public.join_room(tests.get('private_slug'), null, 'auto')), 'ok', 'join_room: the host never needs the key');
select tests.call_as('g1', format('public.leave_room(%L)', tests.id('private_room')));
select tests.as_user('g1');
select is(tests.code(public.join_room(tests.get('private_slug'), null, 'auto')), 'bad_key', 'join_room: someone who left needs the key again');

-- Bans and removals ----------------------------------------------------------------------------

select tests.put('mod_room', tests.new_room('host')::text);
select tests.join('g1', tests.id('mod_room'));
select tests.join('g2', tests.id('mod_room'));
select tests.call_as('host', format('public.moderate(%L, %L, %L)', tests.id('mod_room'), tests.uid('g1'), 'ban'));
select tests.call_as('host', format('public.moderate(%L, %L, %L)', tests.id('mod_room'), tests.uid('g2'), 'remove'));
select is(tests.code(tests.join('g1', tests.id('mod_room'))), 'banned', 'join_room: banned for a banned user');
select is(tests.code(tests.join('g2', tests.id('mod_room'))), 'removed', 'join_room: removed for a removed user');
select tests.call_as('host', format('public.moderate(%L, %L, %L)', tests.id('mod_room'), tests.uid('g2'), 'allow_back'));
select is(tests.code(tests.join('g2', tests.id('mod_room'))), 'ok', 'join_room: a removed user joins again after allow back');

-- Locked rooms ---------------------------------------------------------------------------------

select tests.put('locked_room', tests.new_room('host', 'private')::text);
select tests.join('g1', tests.id('locked_room'));
select tests.join('g2', tests.id('locked_room'));
select tests.call_as('g1', format('public.leave_room(%L)', tests.id('locked_room')));
select tests.call_as('host', format('public.moderate(%L, %L, %L)', tests.id('locked_room'), tests.uid('g2'), 'remove'));
select tests.call_as('host', format('public.update_room_settings(%L, %L)', tests.id('locked_room'), '{"locked": true}'));
select is(tests.code(tests.join('newcomer', tests.id('locked_room'))), 'locked', 'join_room: a locked room refuses a new user who has the key');
select is(tests.code(tests.join('g1', tests.id('locked_room'))), 'ok', 'join_room: a locked room readmits a former member');
select is(tests.code(tests.join('g2', tests.id('locked_room'))), 'removed', 'join_room: a locked room still refuses a removed former member as removed');
select tests.as_user('newcomer');
select is(tests.code(public.join_room(tests.slug(tests.id('locked_room')), 'wrongwrongwrongwrongww', 'auto')), 'bad_key', 'join_room: the key is checked before the lock');

-- What a returning member keeps ---------------------------------------------------------------

select tests.put('keep_room', tests.new_room('host')::text);
select tests.join('g1', tests.id('keep_room'));
select tests.call_as('host', format('public.moderate(%L, %L, %L)', tests.id('keep_room'), tests.uid('g1'), 'mute_voice'));
select tests.call_as('g1', format('public.leave_room(%L)', tests.id('keep_room')));
select is(tests.code(tests.join('g1', tests.id('keep_room'))), 'ok', 'join_room: someone who left joins again');
select ok((tests.member(tests.id('keep_room'), 'g1')).voice_muted, 'join_room: a host mute survives leaving and joining again');
select is((tests.member(tests.id('keep_room'), 'g1')).left_at, null, 'join_room: left_at is cleared');
select is((select count(*)::integer from tests.system_messages(tests.id('keep_room'), 'joined')), 2, 'join_room: joining after leaving posts joined again');
select tests.as_owner();
update public.rooms set last_active_at = clock_timestamp() - interval '1 hour' where id = tests.id('keep_room');
select tests.join('g1', tests.id('keep_room'));
select ok((tests.room(tests.id('keep_room'))).last_active_at > clock_timestamp() - interval '5 seconds', 'join_room: a join counts as room activity');

select * from finish();
rollback;
