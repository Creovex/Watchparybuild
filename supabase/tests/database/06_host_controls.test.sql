-- Host only RPCs: update_room_settings, close_room, transfer_host, get_room_link, rotate_join_key
-- and moderate (remove, ban, mute_voice, unmute_voice, allow_back, with the epoch change).
begin;
\ir _helpers.psql
select plan(81);

select tests.new_user('host');
select tests.new_user('g1');
select tests.new_user('g2');
select tests.new_user('g3');
select tests.new_user('newcomer');
select tests.new_user('stranger');

select tests.put('room', tests.new_room('host', 'private')::text);
select tests.join('g1', tests.id('room'));
select tests.join('g2', tests.id('room'));

-- update_room_settings -------------------------------------------------------------------------

select tests.as_owner();
select is(tests.code(public.update_room_settings(tests.id('room'), '{"locked": true}')), 'unauthorized', 'update_room_settings: unauthorized without a signed in user');
select tests.as_user('g1');
select is(tests.code(public.update_room_settings(tests.id('room'), '{"locked": true}')), 'not_host', 'update_room_settings: not_host for a guest');
select tests.as_user('stranger');
select is(tests.code(public.update_room_settings(tests.id('room'), '{"locked": true}')), 'not_host', 'update_room_settings: not_host for a stranger');
select tests.as_user('host');
select is(tests.code(public.update_room_settings(tests.id('room'), '{}')), 'invalid_input', 'update_room_settings: invalid_input for no settings');
select is(tests.code(public.update_room_settings(tests.id('room'), '[]')), 'invalid_input', 'update_room_settings: invalid_input for a value that is not an object');
select is(tests.code(public.update_room_settings(tests.id('room'), '{"room_cap": 10}')), 'invalid_input', 'update_room_settings: invalid_input for a setting that cannot change');
select is(tests.code(public.update_room_settings(tests.id('room'), '{"locked": "yes"}')), 'invalid_input', 'update_room_settings: invalid_input for a wrong type');
select is(tests.code(public.update_room_settings(tests.id('room'), '{"control_mode": "anyone"}')), 'invalid_input', 'update_room_settings: invalid_input for an unknown control mode');
select is(tests.code(public.update_room_settings(tests.id('room'), jsonb_build_object('title', repeat('t', 81)))), 'invalid_input', 'update_room_settings: invalid_input for a title over 80 characters');
select is(tests.code(public.update_room_settings(tests.id('room'), '{"title": 5}')), 'invalid_input', 'update_room_settings: invalid_input for a title that is not text');
select tests.put('settings', public.update_room_settings(tests.id('room'), '{"title": "  Late show ", "control_mode": "everyone", "wait_for_everyone": false, "locked": true}')::text);
select is(tests.code(tests.get('settings')::jsonb), 'ok', 'update_room_settings: the host changes every setting at once');
select is(
  (tests.get('settings')::jsonb -> 'data') - 'last_active_at',
  to_jsonb(tests.room(tests.id('room'))) - 'last_active_at',
  'update_room_settings: returns the room row'
);
select is(
  array[(tests.room(tests.id('room'))).title, (tests.room(tests.id('room'))).control_mode,
        (tests.room(tests.id('room'))).wait_for_everyone::text, (tests.room(tests.id('room'))).locked::text],
  array['Late show', 'everyone', 'false', 'true'],
  'update_room_settings: the settings are stored'
);
select is(tests.sent(tests.id('room'), 'room', 1), 1, 'update_room_settings: one room event');
select public.update_room_settings(tests.id('room'), '{"locked": false}');
select is((tests.room(tests.id('room'))).title, 'Late show', 'update_room_settings: settings left out keep their value');

-- get_room_link and rotate_join_key ----------------------------------------------------------

select tests.as_owner();
select is(tests.code(public.get_room_link(tests.id('room'))), 'unauthorized', 'get_room_link: unauthorized without a signed in user');
select tests.as_user('g1');
select is(tests.code(public.get_room_link(tests.id('room'))), 'not_host', 'get_room_link: not_host for a guest');
select is(tests.code(public.rotate_join_key(tests.id('room'))), 'not_host', 'rotate_join_key: not_host for a guest');
select tests.as_user('host');
select tests.put('old_key', tests.join_key(tests.id('room')));
select is(
  public.get_room_link(tests.id('room')) -> 'data' ->> 'room_link',
  'http://localhost:3000/r/' || tests.slug(tests.id('room')) || '#k=' || tests.get('old_key'),
  'get_room_link: the host gets the full link with the key'
);
select tests.put('rotated', public.rotate_join_key(tests.id('room'))::text);
select is(tests.code(tests.get('rotated')::jsonb), 'ok', 'rotate_join_key: ok');
select isnt(tests.join_key(tests.id('room')), tests.get('old_key'), 'rotate_join_key: the key changes');
select is(
  tests.get('rotated')::jsonb -> 'data' ->> 'room_link',
  'http://localhost:3000/r/' || tests.slug(tests.id('room')) || '#k=' || tests.join_key(tests.id('room')),
  'rotate_join_key: returns the new link'
);
-- Make room under the cap for the newcomer.
select tests.set_seen(tests.id('room'), 'g2', 61);
select tests.as_user('newcomer');
select is(tests.code(public.join_room(tests.slug(tests.id('room')), tests.get('old_key'), 'auto')), 'bad_key', 'rotate_join_key: the old link is refused');
select is(tests.code(public.join_room(tests.slug(tests.id('room')), tests.join_key(tests.id('room')), 'auto')), 'ok', 'rotate_join_key: the new link admits');
select tests.call_as('newcomer', format('public.leave_room(%L)', tests.id('room')));
select tests.set_seen(tests.id('room'), 'g2', 0);
select tests.put('public_room', tests.new_room('host')::text);
select tests.as_user('host');
select is(public.get_room_link(tests.id('public_room')) -> 'data' ->> 'room_link', 'http://localhost:3000/r/' || tests.slug(tests.id('public_room')), 'get_room_link: a public link has no key');
select is(tests.code(public.rotate_join_key(tests.id('public_room'))), 'invalid_input', 'rotate_join_key: invalid_input for a public room');

-- transfer_host (E14: A to B and back) ---------------------------------------------------------

select tests.as_owner();
select is(tests.code(public.transfer_host(tests.id('room'), tests.uid('g1'))), 'unauthorized', 'transfer_host: unauthorized without a signed in user');
select tests.as_user('g1');
select is(tests.code(public.transfer_host(tests.id('room'), tests.uid('g2'))), 'not_host', 'transfer_host: not_host for a guest');
select tests.as_user('host');
select is(tests.code(public.transfer_host(tests.id('room'), tests.uid('stranger'))), 'not_member', 'transfer_host: not_member for someone not in the room');
select is(tests.code(public.transfer_host(tests.id('room'), tests.uid('host'))), 'not_member', 'transfer_host: not_member for the host themself');
select tests.set_seen(tests.id('room'), 'g2', 61);
select is(tests.code(public.transfer_host(tests.id('room'), tests.uid('g2'))), 'not_member', 'transfer_host: not_member for an absent member');
select tests.set_seen(tests.id('room'), 'g2', 0);
select is(tests.code(public.transfer_host(tests.id('room'), tests.uid('g1'))), 'ok', 'transfer_host: the host hands host to a present member');
select is((tests.room(tests.id('room'))).host_id, tests.uid('g1'), 'transfer_host: rooms.host_id moves');
select is((tests.member(tests.id('room'), 'g1')).role || ' ' || (tests.member(tests.id('room'), 'host')).role, 'host guest', 'transfer_host: roles swap');
select is((select m.body::jsonb from tests.system_messages(tests.id('room'), 'host_changed') m), jsonb_build_object('user_id', tests.uid('g1')), 'transfer_host: posts host_changed');
select is((tests.room(tests.id('room'))).room_cap || ' ' || (tests.room(tests.id('room'))).voice_mode, '3 mesh', 'transfer_host: room cap and voice mode do not change');
select is(tests.code(public.update_room_settings(tests.id('room'), '{"locked": true}')), 'not_host', 'transfer_host: the old host is no longer host');
select tests.as_user('g1');
select is(tests.code(public.transfer_host(tests.id('room'), tests.uid('host'))), 'ok', 'transfer_host: and back');
select is((tests.room(tests.id('room'))).host_id, tests.uid('host'), 'transfer_host: the first host is host again');

-- moderate: input and permission codes -------------------------------------------------------

select tests.as_owner();
select is(tests.code(public.moderate(tests.id('room'), tests.uid('g1'), 'mute_voice')), 'unauthorized', 'moderate: unauthorized without a signed in user');
select tests.as_user('g1');
select is(tests.code(public.moderate(tests.id('room'), tests.uid('g2'), 'remove')), 'not_host', 'moderate: not_host for a guest');
select tests.as_user('host');
select is(tests.code(public.moderate(tests.id('room'), tests.uid('g1'), 'shout')), 'invalid_input', 'moderate: invalid_input for an unknown action');
select is(tests.code(public.moderate(tests.id('room'), tests.uid('host'), 'remove')), 'invalid_input', 'moderate: invalid_input for the host as target');
select is(tests.code(public.moderate(tests.id('room'), tests.uid('stranger'), 'remove')), 'not_member', 'moderate: not_member for someone with no row');
select is(tests.code(public.moderate(tests.id('room'), tests.uid('g1'), 'allow_back')), 'not_member', 'moderate: not_member for allow back on someone not removed');

-- mute_voice and unmute_voice ----------------------------------------------------------------

select is(tests.code(public.moderate(tests.id('room'), tests.uid('g2'), 'mute_voice')), 'ok', 'moderate: mute_voice');
select ok((tests.member(tests.id('room'), 'g2')).voice_muted, 'moderate: mute_voice sets voice_muted');
select is((tests.room(tests.id('room'))).channel_epoch, 1, 'moderate: mute does not change the epoch');
select is(tests.sent(tests.id('room'), 'moderation'), 0, 'moderate: mute sends no moderation event');
select is(
  (select count(*)::integer from tests.events(tests.id('room'), 'members', 1) e
   where e ->> 'user_id' = tests.uid('g2')::text and (e ->> 'voice_muted')::boolean),
  1,
  'moderate: mute is sent as a members event'
);
select tests.put('g2_session', tests.join('g2', tests.id('room')) -> 'data' ->> 'engine_session');
select tests.call_as('g2', format('public.touch_member(%L, %L, false, %L)', tests.id('room'), tests.id('g2_session'), 'auto'));
select ok((tests.member(tests.id('room'), 'g2')).voice_muted, 'moderate: the muted member cannot clear the mute by joining or refreshing');
select is(tests.code(public.moderate(tests.id('room'), tests.uid('g2'), 'unmute_voice')), 'ok', 'moderate: unmute_voice');
select ok(not (tests.member(tests.id('room'), 'g2')).voice_muted, 'moderate: unmute_voice clears voice_muted');

-- remove, then allow back (E14) --------------------------------------------------------------

select is(tests.code(public.moderate(tests.id('room'), tests.uid('g2'), 'remove')), 'ok', 'moderate: remove');
select is((tests.member(tests.id('room'), 'g2')).state, 'removed', 'moderate: remove sets state removed');
select is((tests.room(tests.id('room'))).channel_epoch, 2, 'moderate: remove increments the channel epoch');
select is(
  (select e - 'id' from tests.events(tests.id('room'), 'moderation', 1) e),
  jsonb_build_object('target', tests.uid('g2'), 'action', 'remove', 'new_epoch', 2),
  'moderate: remove sends { target, action, new_epoch } on the old server topic'
);
select is(tests.sent(tests.id('room'), 'moderation', 2), 0, 'moderate: nothing about the removal goes to the new topic');
select is(
  (select count(*)::integer from tests.events(tests.id('room'), 'members', 1) e
   where e ->> 'user_id' = tests.uid('g2')::text and e ->> 'state' = 'removed'),
  1,
  'moderate: the removed member row is sent on the old topic, which the removed user still holds'
);
select is(tests.code(public.moderate(tests.id('room'), tests.uid('g2'), 'remove')), 'not_member', 'moderate: not_member for removing someone already removed');
select is(tests.code(public.moderate(tests.id('room'), tests.uid('g2'), 'mute_voice')), 'not_member', 'moderate: not_member for muting someone not joined');
select is(tests.code(public.moderate(tests.id('room'), tests.uid('g2'), 'allow_back')), 'ok', 'moderate: allow_back');
select is((tests.member(tests.id('room'), 'g2')).state, 'left', 'moderate: allow_back sets a removed user to left');
select is((tests.room(tests.id('room'))).channel_epoch, 2, 'moderate: allow_back does not change the epoch');
select is(tests.code(tests.join('g2', tests.id('room'))), 'ok', 'moderate: the user rejoins after allow back');

-- ban ------------------------------------------------------------------------------------------

select is(tests.code(public.moderate(tests.id('room'), tests.uid('g2'), 'ban')), 'ok', 'moderate: ban');
select is((tests.member(tests.id('room'), 'g2')).state, 'banned', 'moderate: ban sets state banned');
select is((tests.room(tests.id('room'))).channel_epoch, 3, 'moderate: ban increments the channel epoch');
select is(
  (select e - 'id' from tests.events(tests.id('room'), 'moderation', 2) e),
  jsonb_build_object('target', tests.uid('g2'), 'action', 'ban', 'new_epoch', 3),
  'moderate: ban sends the moderation event on the then current topic'
);
select is(tests.code(public.moderate(tests.id('room'), tests.uid('g2'), 'ban')), 'not_member', 'moderate: not_member for banning someone already banned');
select is(tests.code(public.moderate(tests.id('room'), tests.uid('g2'), 'allow_back')), 'not_member', 'moderate: allow_back does not lift a ban');
select tests.join('g3', tests.id('room'));
select tests.call_as('g3', format('public.leave_room(%L)', tests.id('room')));
select is(tests.code(public.moderate(tests.id('room'), tests.uid('g3'), 'ban')), 'ok', 'moderate: someone who left can be banned');
select is(tests.code(tests.join('g3', tests.id('room'))), 'banned', 'moderate: and is refused afterwards');
select is(
  (tests.call_as('host', format('public.moderate(%L, %L, %L)', tests.id('room'), tests.uid('g1'), 'mute_voice')) -> 'data' -> 'member') ? 'engine_session',
  false,
  'moderate: the member in data has no engine session'
);

-- close_room -----------------------------------------------------------------------------------

select tests.as_owner();
select is(tests.code(public.close_room(tests.id('room'))), 'unauthorized', 'close_room: unauthorized without a signed in user');
select tests.as_user('g1');
select is(tests.code(public.close_room(tests.id('room'))), 'not_host', 'close_room: not_host for a guest');
select tests.as_user('host');
select tests.put('room_events', tests.sent(tests.id('room'), 'room')::text);
select is(tests.code(public.close_room(tests.id('room'))), 'ok', 'close_room: the host closes the room');
select is((tests.room(tests.id('room'))).status, 'closed', 'close_room: status is closed');
select is(tests.sent(tests.id('room'), 'room', 4), 1, 'close_room: members are told through the room event on the current topic');
select is(tests.code(public.close_room(tests.id('room'))), 'ok', 'close_room: closing again succeeds');
select is(tests.sent(tests.id('room'), 'room'), tests.get('room_events')::integer + 1, 'close_room: closing again sends nothing');

select * from finish();
rollback;
