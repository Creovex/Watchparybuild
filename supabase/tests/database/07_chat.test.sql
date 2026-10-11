-- send_chat, delete_message and post_system: every code, the chat rate limit, timed comments,
-- soft deletes and the system message bodies.
begin;
\ir _helpers.psql
select plan(52);

select tests.new_user('host');
select tests.new_user('g1');
select tests.new_user('g2');
select tests.new_user('stranger');

select tests.put('room', tests.new_room('host')::text);
select tests.join('g1', tests.id('room'));
select tests.join('g2', tests.id('room'), 'cue');

-- send_chat --------------------------------------------------------------------------------------

select tests.as_owner();
select is(tests.code(public.send_chat(tests.id('room'), 'hi', null)), 'unauthorized', 'send_chat: unauthorized without a signed in user');
select tests.as_user('stranger');
select is(tests.code(public.send_chat(tests.id('room'), 'hi', null)), 'not_member', 'send_chat: not_member for a stranger');
select tests.as_user('g1');
select is(tests.code(public.send_chat(tests.id('room'), '', null)), 'invalid_input', 'send_chat: invalid_input for an empty body');
select is(tests.code(public.send_chat(tests.id('room'), E' \n\t ', null)), 'invalid_input', 'send_chat: invalid_input for a body of whitespace');
select is(tests.code(public.send_chat(tests.id('room'), null, null)), 'invalid_input', 'send_chat: invalid_input without a body');
select is(tests.code(public.send_chat(tests.id('room'), repeat('x', 1001), null)), 'invalid_input', 'send_chat: invalid_input for a body over 1,000 characters');
select is(tests.code(public.send_chat(tests.id('room'), 'hi', -1)), 'invalid_input', 'send_chat: invalid_input for a negative position');

select tests.put('chat', public.send_chat(tests.id('room'), '  hello there  ', null)::text);
select is(tests.code(tests.get('chat')::jsonb), 'ok', 'send_chat: a member sends chat');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(tests.get('chat')::jsonb -> 'data') k),
  array['body', 'created_at', 'deleted_at', 'id', 'kind', 'position_sec', 'room_id', 'system_code', 'user_id'],
  'send_chat: data has exactly the MessageRow fields'
);
select is(tests.get('chat')::jsonb -> 'data' ->> 'body', 'hello there', 'send_chat: the body is trimmed');
select is(tests.get('chat')::jsonb -> 'data' ->> 'kind', 'chat', 'send_chat: without a position the message is chat');
select is(tests.get('chat')::jsonb -> 'data' ->> 'user_id', tests.uid('g1')::text, 'send_chat: the author is the caller');
select is(tests.sent(tests.id('room'), 'chat', 1), 3, 'send_chat: the chat event is sent (after two joined messages)');
select tests.put('timed', public.send_chat(tests.id('room'), 'look at this', 42.5)::text);
select is(tests.get('timed')::jsonb -> 'data' ->> 'kind', 'timed', 'send_chat: a position makes a timed comment');
select is((tests.get('timed')::jsonb -> 'data' ->> 'position_sec')::double precision, 42.5::double precision, 'send_chat: the timed comment keeps its position');
select is(tests.code(public.send_chat(tests.id('room'), repeat('y', 1000), null)), 'ok', 'send_chat: 1,000 characters is allowed');

-- Rate limit: 5 messages per 5 seconds; three are sent above.
select is(tests.code(public.send_chat(tests.id('room'), 'four', null)), 'ok', 'send_chat: the fourth message inside 5 seconds');
select is(tests.code(public.send_chat(tests.id('room'), 'five', null)), 'ok', 'send_chat: the fifth message inside 5 seconds');
select is(tests.code(public.send_chat(tests.id('room'), 'six', null)), 'rate_limited', 'send_chat: rate_limited on the sixth message inside 5 seconds');
select tests.as_user('g2');
select is(tests.code(public.send_chat(tests.id('room'), 'mine', null)), 'ok', 'send_chat: the limit is per user');
select tests.as_owner();
update public.messages set created_at = created_at - interval '6 seconds' where user_id = tests.uid('g1');
select tests.as_user('g1');
select is(tests.code(public.send_chat(tests.id('room'), 'later', null)), 'ok', 'send_chat: allowed again once the messages are older than 5 seconds');
select tests.call_as('g2', format('public.leave_room(%L)', tests.id('room')));
select tests.as_user('g2');
select is(tests.code(public.send_chat(tests.id('room'), 'gone', null)), 'not_member', 'send_chat: not_member after leaving');
select tests.join('g2', tests.id('room'), 'cue');

-- delete_message ---------------------------------------------------------------------------------

select tests.put('msg', tests.get('chat')::jsonb -> 'data' ->> 'id');
select tests.as_owner();
select is(tests.code(public.delete_message(tests.id('msg'))), 'unauthorized', 'delete_message: unauthorized without a signed in user');
select tests.as_user('g2');
select is(tests.code(public.delete_message(tests.id('msg'))), 'not_allowed', 'delete_message: not_allowed for another member''s message');
select is(tests.code(public.delete_message(gen_random_uuid())), 'not_allowed', 'delete_message: not_allowed for a message that does not exist');
select tests.as_user('stranger');
select is(tests.code(public.delete_message(tests.id('msg'))), 'not_allowed', 'delete_message: not_allowed for a stranger');
select tests.as_user('g1');
select tests.put('joined_msg', (select m.id::text from tests.system_messages(tests.id('room'), 'joined') m where m.user_id = tests.uid('g1') limit 1));
select is(tests.code(public.delete_message(tests.id('joined_msg'))), 'not_allowed', 'delete_message: a member cannot delete a system message about them');
select tests.put('chat_events', tests.sent(tests.id('room'), 'chat')::text);
select is(tests.code(public.delete_message(tests.id('msg'))), 'ok', 'delete_message: the author deletes their message');
select is((select count(*)::integer from public.messages m where m.id = tests.id('msg')), 0, 'delete_message: hidden from members once deleted');
select is(tests.sent(tests.id('room'), 'chat'), tests.get('chat_events')::integer + 1, 'delete_message: the soft delete is sent as a chat event');
select is(tests.code(public.delete_message(tests.id('msg'))), 'ok', 'delete_message: deleting again succeeds');
select is(tests.sent(tests.id('room'), 'chat'), tests.get('chat_events')::integer + 1, 'delete_message: deleting again sends nothing');
select tests.as_user('host');
select is(tests.code(public.delete_message((tests.get('timed')::jsonb -> 'data' ->> 'id')::uuid)), 'ok', 'delete_message: the host deletes a guest''s message');
select is(tests.code(public.delete_message(tests.id('joined_msg'))), 'ok', 'delete_message: the host deletes a system message');

-- post_system ------------------------------------------------------------------------------------

select tests.as_owner();
select is(tests.code(public.post_system(tests.id('room'), 'cue_ready')), 'unauthorized', 'post_system: unauthorized without a signed in user');
select tests.as_user('g2');
select is(tests.code(public.post_system(tests.id('room'), 'joined')), 'invalid_input', 'post_system: clients cannot post joined');
select is(tests.code(public.post_system(tests.id('room'), 'left')), 'invalid_input', 'post_system: clients cannot post left');
select is(tests.code(public.post_system(tests.id('room'), 'host_changed')), 'invalid_input', 'post_system: clients cannot post host_changed');
select is(tests.code(public.post_system(tests.id('room'), 'party')), 'invalid_input', 'post_system: invalid_input for an unknown code');
select tests.as_user('stranger');
select is(tests.code(public.post_system(tests.id('room'), 'cue_ready')), 'not_member', 'post_system: not_member for a stranger');

-- Playing since 30 seconds ago at 60: a cue member is ready at about 90.
select tests.as_owner();
update public.playback_state
set seq = 5, status = 'playing', position_sec = 60, rate = 1, server_ts = clock_timestamp() - interval '30 seconds', paused_reason = null
where room_id = tests.id('room');
select tests.as_user('g2');
select tests.put('cue', public.post_system(tests.id('room'), 'cue_ready')::text);
select is(tests.code(tests.get('cue')::jsonb), 'ok', 'post_system: any member posts cue_ready');
select is(tests.get('cue')::jsonb -> 'data' ->> 'kind', 'system', 'post_system: the message is a system message');
select is(tests.get('cue')::jsonb -> 'data' ->> 'system_code', 'cue_ready', 'post_system: with its code');
select is((tests.get('cue')::jsonb -> 'data' ->> 'body')::jsonb ->> 'user_id', tests.uid('g2')::text, 'post_system: cue_ready names the member');
select ok(((tests.get('cue')::jsonb -> 'data' ->> 'body')::jsonb ->> 'position_sec')::double precision between 89.9 and 91, 'post_system: cue_ready carries the expected position now');
select is(tests.code(public.post_system(tests.id('room'), 'cue_ready')), 'rate_limited', 'post_system: rate_limited inside 10 seconds');
select is(tests.code(public.post_system(tests.id('room'), 'waiting_for')), 'not_elected', 'post_system: not_elected for waiting_for from a member who is not elected');

-- The host is the elected member. Nobody buffers yet.
select tests.as_user('host');
select is(tests.code(public.post_system(tests.id('room'), 'waiting_for')), 'invalid_input', 'post_system: invalid_input for waiting_for while nobody buffers');
select tests.call_as('g2', format('public.touch_member(%L, %L, true, %L)', tests.id('room'), (tests.member(tests.id('room'), 'g2')).engine_session, 'cue'));
select tests.call_as('g1', format('public.touch_member(%L, %L, true, %L)', tests.id('room'), (tests.member(tests.id('room'), 'g1')).engine_session, 'auto'));
select tests.as_owner();
update public.room_members set buffering_since = clock_timestamp() - interval '3 seconds' where room_id = tests.id('room') and user_id = tests.uid('g1');
select tests.as_user('host');
select tests.put('waiting', public.post_system(tests.id('room'), 'waiting_for')::text);
select is(tests.code(tests.get('waiting')::jsonb), 'ok', 'post_system: the elected member posts waiting_for');
select is(
  (tests.get('waiting')::jsonb -> 'data' ->> 'body')::jsonb,
  jsonb_build_object('user_ids', jsonb_build_array(tests.uid('g1'), tests.uid('g2'))),
  'post_system: waiting_for names the buffering members, earliest first'
);
select is(tests.code(public.post_system(tests.id('room'), 'cue_ready')), 'rate_limited', 'post_system: the 10 second limit covers both codes');
select tests.as_owner();
update public.messages set created_at = created_at - interval '11 seconds' where room_id = tests.id('room') and user_id = tests.uid('host') and kind = 'system';
select tests.set_seen(tests.id('room'), 'g2', 61);
select tests.as_user('host');
select is(
  (public.post_system(tests.id('room'), 'waiting_for') -> 'data' ->> 'body')::jsonb,
  jsonb_build_object('user_ids', jsonb_build_array(tests.uid('g1'))),
  'post_system: an absent member is not named'
);

select * from finish();
rollback;
