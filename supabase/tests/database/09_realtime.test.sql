-- Realtime: the realtime_topic_allowed truth table, the policies on realtime.messages checked the
-- way Realtime checks them, and which changes send server topic events.
begin;
\ir _helpers.psql
select plan(54);

select tests.new_user('host');
select tests.new_user('g1');
select tests.new_user('g2');
select tests.new_user('stranger');

select tests.put('room', tests.new_room('host')::text);
select tests.put('g1_session', tests.join('g1', tests.id('room')) -> 'data' ->> 'engine_session');
select tests.join('g2', tests.id('room'));

create function tests.topic(epoch integer, kind text)
returns text
language sql
stable
as $$
  select 'room:' || tests.get('room') || ':' || $1 || ':' || $2;
$$;

-- realtime_topic_allowed: a member at epoch 1 ---------------------------------------------------

select tests.as_user('g1');
select ok(public.realtime_topic_allowed(tests.topic(1, 'server'), false), 'topic: a member receives the server topic');
select ok(public.realtime_topic_allowed(tests.topic(1, 'client'), false), 'topic: a member receives the client topic');
select ok(not public.realtime_topic_allowed(tests.topic(1, 'server'), true), 'topic: a member cannot send on the server topic');
select ok(public.realtime_topic_allowed(tests.topic(1, 'client'), true), 'topic: a member sends on the client topic');
select ok(not public.realtime_topic_allowed(tests.topic(2, 'server'), false), 'topic: an epoch ahead of the room is refused');
select ok(not public.realtime_topic_allowed(tests.topic(0, 'server'), false), 'topic: epoch 0 is refused');

select tests.as_user('stranger');
select ok(not public.realtime_topic_allowed(tests.topic(1, 'server'), false), 'topic: a stranger cannot receive the server topic');
select ok(not public.realtime_topic_allowed(tests.topic(1, 'client'), false), 'topic: a stranger cannot receive the client topic');
select ok(not public.realtime_topic_allowed(tests.topic(1, 'client'), true), 'topic: a stranger cannot send on the client topic');

-- Malformed topics.
select tests.as_user('g1');
select ok(not public.realtime_topic_allowed(null, false), 'topic: null is refused');
select ok(not public.realtime_topic_allowed('', false), 'topic: an empty topic is refused');
select ok(not public.realtime_topic_allowed('room:not-a-uuid:1:server', false), 'topic: a room id that is not a UUID is refused');
select ok(not public.realtime_topic_allowed(upper(tests.topic(1, 'server')), false), 'topic: an uppercase topic is refused');
select ok(not public.realtime_topic_allowed('room:' || upper(tests.get('room')) || ':1:server', false), 'topic: an uppercase room id is refused');
select ok(not public.realtime_topic_allowed('room:' || tests.get('room') || ':01:server', false), 'topic: an epoch with a leading zero is refused');
select ok(not public.realtime_topic_allowed(tests.topic(1, 'voice'), false), 'topic: an unknown topic kind is refused');
select ok(not public.realtime_topic_allowed(tests.topic(1, 'server') || ':extra', false), 'topic: trailing text is refused');
select ok(not public.realtime_topic_allowed('x' || tests.topic(1, 'server'), false), 'topic: leading text is refused');
select ok(not public.realtime_topic_allowed('room:' || tests.get('room') || ':99999999999:server', false), 'topic: an epoch too large to be real is refused');
select ok(not public.realtime_topic_allowed('room:' || gen_random_uuid() || ':1:server', false), 'topic: a room that does not exist is refused');
select ok(not public.realtime_topic_allowed(tests.topic(1, 'server'), null), 'topic: a null send flag is refused');

-- After a removal: epoch 2 is current, epoch 1 is the one before.
select tests.call_as('host', format('public.moderate(%L, %L, %L)', tests.id('room'), tests.uid('g2'), 'remove'));
select tests.as_user('g1');
select ok(public.realtime_topic_allowed(tests.topic(2, 'server'), false), 'topic: a remaining member receives the new server topic');
select ok(public.realtime_topic_allowed(tests.topic(2, 'client'), true), 'topic: a remaining member sends on the new client topic');
select ok(public.realtime_topic_allowed(tests.topic(1, 'server'), false), 'topic: a remaining member still receives the previous epoch, to read the moderation event');
select ok(public.realtime_topic_allowed(tests.topic(1, 'client'), true), 'topic: a remaining member still sends on the previous client topic while moving');
select tests.as_user('g2');
select ok(not public.realtime_topic_allowed(tests.topic(2, 'server'), false), 'topic: the removed user cannot receive the new server topic');
select ok(not public.realtime_topic_allowed(tests.topic(2, 'client'), false), 'topic: the removed user cannot receive the new client topic');
select ok(not public.realtime_topic_allowed(tests.topic(1, 'server'), false), 'topic: the removed user cannot join the old topic again');
select tests.call_as('host', format('public.moderate(%L, %L, %L)', tests.id('room'), tests.uid('g2'), 'allow_back'));
select tests.call_as('host', format('public.moderate(%L, %L, %L)', tests.id('room'), tests.uid('g1'), 'ban'));
select tests.as_user('host');
select ok(not public.realtime_topic_allowed(tests.topic(1, 'server'), false), 'topic: two epochs back is refused');
select ok(public.realtime_topic_allowed(tests.topic(3, 'server'), false), 'topic: the host follows the epoch');
select tests.as_user('g1');
select ok(not public.realtime_topic_allowed(tests.topic(3, 'server'), false), 'topic: a banned user is refused');
select ok(not public.realtime_topic_allowed(tests.topic(2, 'server'), false), 'topic: a banned user is refused the previous epoch too');

-- Policies on realtime.messages, checked the way Realtime does --------------------------------
-- Realtime inserts a broadcast and a presence row for the topic, then reads them back as the
-- user with realtime.topic set (receive), and inserts as the user (send).

select tests.as_owner();
select tests.put('room2', tests.new_room('host')::text);
select tests.join('g2', tests.id('room2'));
insert into realtime.messages (topic, extension, event, payload, private)
select 'room:' || tests.get('room2') || ':1:' || k, e, 'probe', '{}'::jsonb, true
from unnest(array['server', 'client']) k cross join unnest(array['broadcast', 'presence']) e;

create function tests.can_receive(name text, topic text)
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  perform tests.as_user($1);
  perform set_config('realtime.topic', $2, true);
  select count(*) into v_count from realtime.messages m where m.topic = $2 and m.event = 'probe';
  perform tests.as_owner();
  return v_count;
end;
$$;

create function tests.can_send(name text, topic text, extension text)
returns boolean
language plpgsql
as $$
begin
  perform tests.as_user($1);
  perform set_config('realtime.topic', $2, true);
  insert into realtime.messages (topic, extension, event, payload, private) values ($2, $3, 'probe_send', '{}'::jsonb, true);
  perform tests.as_owner();
  return true;
exception when insufficient_privilege then
  perform tests.as_owner();
  return false;
end;
$$;

select is(tests.can_receive('g2', 'room:' || tests.get('room2') || ':1:server'), 2, 'policy: a member receives broadcast and presence on the server topic');
select is(tests.can_receive('g2', 'room:' || tests.get('room2') || ':1:client'), 2, 'policy: a member receives broadcast and presence on the client topic');
select is(tests.can_receive('stranger', 'room:' || tests.get('room2') || ':1:server'), 0, 'policy: a stranger receives nothing on the server topic');
select is(tests.can_receive('stranger', 'room:' || tests.get('room2') || ':1:client'), 0, 'policy: a stranger receives nothing on the client topic');
select ok(tests.can_send('g2', 'room:' || tests.get('room2') || ':1:client', 'broadcast'), 'policy: a member broadcasts on the client topic');
select ok(tests.can_send('g2', 'room:' || tests.get('room2') || ':1:client', 'presence'), 'policy: a member tracks presence on the client topic');
select ok(not tests.can_send('g2', 'room:' || tests.get('room2') || ':1:server', 'broadcast'), 'policy: a member cannot broadcast on the server topic');
select ok(not tests.can_send('g2', 'room:' || tests.get('room2') || ':1:server', 'presence'), 'policy: a member cannot track presence on the server topic');
select ok(not tests.can_send('stranger', 'room:' || tests.get('room2') || ':1:client', 'broadcast'), 'policy: a stranger cannot broadcast on the client topic');

-- Which changes send server topic events -------------------------------------------------------

select tests.put('room3', tests.new_room('host')::text);
select tests.put('s3', tests.join('g1', tests.id('room3')) -> 'data' ->> 'engine_session');
select tests.put('state_before', tests.sent(tests.id('room3'), 'state')::text);
select tests.put('room_before', tests.sent(tests.id('room3'), 'room')::text);
select tests.put('members_before', tests.sent(tests.id('room3'), 'members')::text);

-- Refreshes and last activity send nothing.
select tests.call_as('g1', format('public.touch_member(%L, %L, true, %L)', tests.id('room3'), tests.id('s3'), 'cue'));
select tests.call_as('g1', format('public.touch_member(%L, %L, false, %L)', tests.id('room3'), tests.id('s3'), 'auto'));
select tests.join('g1', tests.id('room3'));
select is(tests.sent(tests.id('room3'), 'members'), tests.get('members_before')::integer, 'events: last_seen_at, buffering_since, sync_mode and engine_session changes send no members event');
select is(tests.sent(tests.id('room3'), 'room'), tests.get('room_before')::integer, 'events: last_active_at changes send no room event');

-- Each listed change sends one event with the row.
select tests.call_as('host', format('public.set_playback(%L, 0, %L, 5, 1, 0, %L)', tests.id('room3'), 'playing', 'user'));
select is(tests.sent(tests.id('room3'), 'state'), tests.get('state_before')::integer + 1, 'events: a playback change sends state');
select is(
  (select e - 'id' from tests.events(tests.id('room3'), 'state') e where (e ->> 'seq')::integer = 1),
  to_jsonb(tests.playback(tests.id('room3'))),
  'events: the state payload is the full playback_state row'
);
select tests.call_as('host', format('public.update_room_settings(%L, %L)', tests.id('room3'), '{"title": "Renamed"}'));
select is(tests.sent(tests.id('room3'), 'room'), tests.get('room_before')::integer + 1, 'events: a title change sends room');
select is(
  (select e - 'last_active_at' from tests.events(tests.id('room3'), 'room') e where e ->> 'title' = 'Renamed'),
  to_jsonb(tests.room(tests.id('room3'))) - 'last_active_at',
  'events: the room payload is the room row'
);
select tests.call_as('host', format('public.update_room_settings(%L, %L)', tests.id('room3'), '{"title": "Renamed"}'));
select is(tests.sent(tests.id('room3'), 'room'), tests.get('room_before')::integer + 1, 'events: a setting saved without a change sends nothing');
select tests.call_as('host', format('public.moderate(%L, %L, %L)', tests.id('room3'), tests.uid('g1'), 'mute_voice'));
select is(tests.sent(tests.id('room3'), 'members'), tests.get('members_before')::integer + 1, 'events: a voice_muted change sends members');
select is(
  (select array_agg(k order by k) from tests.events(tests.id('room3'), 'members') e, jsonb_object_keys(e - 'id') k where e ->> 'voice_muted' = 'true'),
  array['buffering_since', 'first_joined_at', 'last_seen_at', 'left_at', 'role', 'room_id', 'state', 'sync_mode', 'user_id', 'voice_muted'],
  'events: the members payload is the MemberRow without engine_session'
);
select tests.put('chat_before', tests.sent(tests.id('room3'), 'chat')::text);
select tests.put('msg', tests.call_as('g1', format('public.send_chat(%L, %L, null)', tests.id('room3'), 'hi')) -> 'data' ->> 'id');
select is(tests.sent(tests.id('room3'), 'chat'), tests.get('chat_before')::integer + 1, 'events: a message insert sends chat');
select tests.call_as('g1', format('public.delete_message(%L)', tests.id('msg')));
select is(tests.sent(tests.id('room3'), 'chat'), tests.get('chat_before')::integer + 2, 'events: a soft delete sends chat');
select isnt(
  (select e ->> 'deleted_at' from tests.events(tests.id('room3'), 'chat') e where e ->> 'id' = tests.get('msg') and e ->> 'deleted_at' is not null),
  null,
  'events: the soft delete payload carries deleted_at'
);
select is(
  (select count(*)::integer from realtime.messages m where m.topic like 'room:' || tests.get('room3') || ':%' and not m.private),
  0,
  'events: every server event is sent as private'
);

select * from finish();
rollback;
