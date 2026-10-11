-- server_time, create_room, room_preview and content reference validation.
begin;
\ir _helpers.psql
select plan(77);

select tests.new_user('host');
select tests.new_user('paid', 'paid');
select tests.new_user('busy');
select tests.new_user('ghost');
select tests.new_user('guest');

-- server_time ----------------------------------------------------------------------------------

select tests.as_user('host');
select is(jsonb_typeof(public.server_time() -> 'data'), 'number', 'server_time: data is a number');
select ok(
  abs((public.server_time() ->> 'data')::numeric - floor(extract(epoch from clock_timestamp()) * 1000)) < 5000,
  'server_time: epoch milliseconds from the server clock'
);
select is((public.server_time() ->> 'ok')::boolean, true, 'server_time: ok envelope');

-- create_room codes ----------------------------------------------------------------------------

select tests.as_owner();
select is(tests.code(public.create_room('Room', 'youtube', null, 'public', 'host')), 'unauthorized', 'create_room: unauthorized without a signed in user');

select tests.as_user('host');
select is(tests.code(public.create_room('', 'youtube', null, 'public', 'host')), 'invalid_input', 'create_room: invalid_input for an empty title');
select is(tests.code(public.create_room('   ', 'youtube', null, 'public', 'host')), 'invalid_input', 'create_room: invalid_input for a blank title');
select is(tests.code(public.create_room(repeat('t', 81), 'youtube', null, 'public', 'host')), 'invalid_input', 'create_room: invalid_input for a title over 80 characters');
select is(tests.code(public.create_room('Room', 'vimeo', null, 'public', 'host')), 'invalid_input', 'create_room: invalid_input for an unknown source');
select is(tests.code(public.create_room('Room', 'youtube', null, 'secret', 'host')), 'invalid_input', 'create_room: invalid_input for an unknown visibility');
select is(tests.code(public.create_room('Room', 'youtube', null, null, 'host')), 'invalid_input', 'create_room: invalid_input without a visibility');
select is(tests.code(public.create_room('Room', 'youtube', null, 'public', 'anyone')), 'invalid_input', 'create_room: invalid_input for an unknown control mode');
select is(tests.code(public.create_room('Room', 'youtube', 'https://youtu.be/dQw4w9WgXcQ', 'public', 'host')), 'invalid_input', 'create_room: invalid_input for a YouTube address instead of an id');
select is(tests.code(public.create_room('Room', 'netflix', 'https://www.disneyplus.com/video/x', 'public', 'host')), 'invalid_input', 'create_room: invalid_input for a reference from another service');

-- A user whose profile row is missing cannot get a plan: internal.
select tests.as_owner();
delete from public.profiles where id = tests.uid('ghost');
select tests.as_user('ghost');
select is(tests.code(public.create_room('Room', 'youtube', null, 'public', 'host')), 'internal', 'create_room: internal when the caller has no profile');

-- create_room: a public room on the free plan -------------------------------------------------

select tests.as_user('host');
select tests.put('result', public.create_room('  Movie night  ', 'youtube', 'dQw4w9WgXcQ', 'public', null)::text);
select tests.put('room', tests.get('result')::jsonb -> 'data' -> 'room' ->> 'id');
select is(tests.code(tests.get('result')::jsonb), 'ok', 'create_room: ok');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(tests.get('result')::jsonb -> 'data') k),
  array['room', 'room_link'],
  'create_room: data holds room and room_link'
);
select is(
  (select array_agg(k order by k) from jsonb_object_keys(tests.get('result')::jsonb -> 'data' -> 'room') k),
  array['channel_epoch', 'content_ref', 'control_mode', 'created_at', 'host_id', 'id', 'last_active_at', 'locked',
        'room_cap', 'slug', 'source', 'status', 'title', 'visibility', 'voice_mode', 'wait_for_everyone'],
  'create_room: the room has exactly the RoomRow fields'
);
select is((tests.room(tests.id('room'))).title, 'Movie night', 'create_room: the title is trimmed');
select is((tests.room(tests.id('room'))).host_id, tests.uid('host'), 'create_room: the caller is the host');
select is((tests.room(tests.id('room'))).control_mode, 'host', 'create_room: control mode defaults to host');
select is((tests.room(tests.id('room'))).room_cap, 3, 'create_room: a free host gets room cap 3');
select is((tests.room(tests.id('room'))).voice_mode, 'mesh', 'create_room: a free host gets mesh voice');
select is((tests.room(tests.id('room'))).status, 'open', 'create_room: the room is open');
select is((tests.room(tests.id('room'))).channel_epoch, 1, 'create_room: the channel epoch starts at 1');
select ok((tests.room(tests.id('room'))).wait_for_everyone and not (tests.room(tests.id('room'))).locked, 'create_room: wait for everyone on, unlocked');
select matches((tests.room(tests.id('room'))).slug, '^[A-Za-z0-9_-]{10}$', 'create_room: the slug is 10 base64url characters');
select is(
  tests.get('result')::jsonb -> 'data' ->> 'room_link',
  'http://localhost:3000/r/' || (tests.room(tests.id('room'))).slug,
  'create_room: a public room link has no key'
);
select is((tests.member(tests.id('room'), 'host')).role, 'host', 'create_room: the host member has role host');
select is((tests.member(tests.id('room'), 'host')).state, 'joined', 'create_room: the host member is joined');
select ok((tests.member(tests.id('room'), 'host')).last_seen_at > clock_timestamp() - interval '5 seconds', 'create_room: the host is present now');
select is((tests.playback(tests.id('room'))).seq, 0::bigint, 'create_room: playback seq starts at 0');
select is((tests.playback(tests.id('room'))).status, 'paused', 'create_room: playback starts paused');
select is((tests.playback(tests.id('room'))).position_sec, 0::double precision, 'create_room: playback starts at 0');
select is((tests.playback(tests.id('room'))).rate, 1::double precision, 'create_room: playback rate starts at 1');
select is(tests.join_key(tests.id('room')), null, 'create_room: a public room has no join key');
select is(tests.sent(tests.id('room'), 'state', 1), 1, 'create_room: the state event goes to the epoch 1 server topic');

-- create_room: a private room on the paid plan ------------------------------------------------

select tests.as_user('paid');
select tests.put('result', public.create_room('Paid room', 'netflix', 'https://www.netflix.com/watch/80100172', 'private', 'everyone')::text);
select tests.put('paid_room', tests.get('result')::jsonb -> 'data' -> 'room' ->> 'id');
select is((tests.room(tests.id('paid_room'))).room_cap, 10, 'create_room: a paid host gets room cap 10');
select is((tests.room(tests.id('paid_room'))).voice_mode, 'server', 'create_room: a paid host gets server voice');
select matches(tests.join_key(tests.id('paid_room')), '^[A-Za-z0-9_-]{22}$', 'create_room: a private room gets a 128 bit base64url join key');
select is(
  tests.get('result')::jsonb -> 'data' ->> 'room_link',
  'http://localhost:3000/r/' || (tests.room(tests.id('paid_room'))).slug || '#k=' || tests.join_key(tests.id('paid_room')),
  'create_room: a private room link carries the key in the fragment'
);
select is((tests.room(tests.id('paid_room'))).control_mode, 'everyone', 'create_room: control mode everyone is kept');

-- too_many_rooms -------------------------------------------------------------------------------

select tests.as_user('busy');
select is(
  (select count(*)::integer from generate_series(1, 20) n
   where tests.code(public.create_room('Room ' || n, 'youtube', null, 'public', 'host')) = 'ok'),
  20,
  'create_room: 20 open rooms are allowed'
);
select is(tests.code(public.create_room('Room 21', 'youtube', null, 'public', 'host')), 'too_many_rooms', 'create_room: too_many_rooms at 20 open rooms');
select tests.as_owner();
update public.rooms set status = 'closed' where id = (select r.id from public.rooms r where r.host_id = tests.uid('busy') limit 1);
select tests.as_user('busy');
select is(tests.code(public.create_room('Room 21', 'youtube', null, 'public', 'host')), 'ok', 'create_room: closed rooms do not count');

-- room_preview ---------------------------------------------------------------------------------

select tests.as_owner();
select is(tests.code(public.room_preview(tests.slug(tests.id('room')))), 'unauthorized', 'room_preview: unauthorized without a signed in user');
select tests.as_user('guest');
select is(tests.code(public.room_preview('nosuchroom')), 'not_found', 'room_preview: not_found for an unknown slug');
select is(
  public.room_preview(tests.slug(tests.id('room'))) -> 'data',
  jsonb_build_object('title', 'Movie night', 'source', 'youtube', 'visibility', 'public', 'locked', false,
                     'status', 'open', 'present_count', 1, 'room_cap', 3),
  'room_preview: title, source, visibility, locked, status, present count and room cap'
);
select tests.set_seen(tests.id('room'), 'host', 61);
select is((public.room_preview(tests.slug(tests.id('room'))) -> 'data' ->> 'present_count')::integer, 0, 'room_preview: an absent member is not counted');

-- Content references ---------------------------------------------------------------------------

select ok(public.valid_content_ref('youtube', 'dQw4w9WgXcQ'), 'content ref: an 11 character YouTube id');
select ok(public.valid_content_ref('youtube', 'a_b-C1d2E3f'), 'content ref: YouTube ids may hold _ and -');
select ok(not public.valid_content_ref('youtube', 'dQw4w9WgXc'), 'content ref: 10 characters is not a YouTube id');
select ok(not public.valid_content_ref('youtube', 'dQw4w9WgXcQQ'), 'content ref: 12 characters is not a YouTube id');
select ok(not public.valid_content_ref('youtube', 'dQw4w9WgX!Q'), 'content ref: punctuation is not allowed in a YouTube id');
select ok(not public.valid_content_ref('youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'content ref: the database stores the bare YouTube id only');
select ok(public.valid_content_ref('netflix', 'https://www.netflix.com/watch/80100172'), 'content ref: a Netflix watch address');
select ok(public.valid_content_ref('netflix', 'https://netflix.com/title/1?trackId=2'), 'content ref: Netflix without www and with a query');
select ok(public.valid_content_ref('netflix', 'https://WWW.Netflix.COM/watch/1'), 'content ref: the host is compared lowercased');
select ok(public.valid_content_ref('netflix', 'https://www.netflix.com:443/watch/1'), 'content ref: a port does not change the host');
select ok(not public.valid_content_ref('netflix', 'http://www.netflix.com/watch/1'), 'content ref: http is refused');
select ok(not public.valid_content_ref('netflix', 'https://www.netflix.com/watch/1#t=10'), 'content ref: a fragment is refused');
select ok(not public.valid_content_ref('netflix', 'https://www.netflix.com.evil.example/watch/1'), 'content ref: a look alike host is refused');
select ok(not public.valid_content_ref('netflix', 'https://www.netflix.com@evil.example/watch/1'), 'content ref: a user name that looks like the host is refused');
select ok(not public.valid_content_ref('netflix', 'https://evil.example/?u=netflix.com'), 'content ref: the service name in the query is refused');
select ok(not public.valid_content_ref('netflix', 'https://www.netflix.com/watch 1'), 'content ref: whitespace is refused');
select ok(public.valid_content_ref('prime', 'https://www.primevideo.com/detail/0ABCDEF'), 'content ref: Prime Video');
select ok(public.valid_content_ref('prime', 'https://www.amazon.co.uk/gp/video/detail/B0ABC'), 'content ref: Amazon UK');
select ok(public.valid_content_ref('prime', 'https://amazon.de/gp/video/detail/B0ABC'), 'content ref: Amazon Germany without www');
select ok(public.valid_content_ref('prime', 'https://www.amazon.ca/gp/video/detail/B0ABC'), 'content ref: Amazon Canada');
select ok(public.valid_content_ref('prime', 'https://www.amazon.com/gp/video/detail/B0ABC'), 'content ref: Amazon US');
select ok(not public.valid_content_ref('prime', 'https://www.amazon.fr/gp/video/detail/B0ABC'), 'content ref: Amazon France is not listed');
select ok(not public.valid_content_ref('prime', 'https://www.amazon.com.au/gp/video/detail/B0ABC'), 'content ref: Amazon Australia is not listed');
select ok(public.valid_content_ref('disney', 'https://www.disneyplus.com/video/abc'), 'content ref: Disney+');
select ok(not public.valid_content_ref('disney', 'https://www.disneyplus.co.uk/video/abc'), 'content ref: another Disney+ domain is not listed');
select ok(not public.valid_content_ref('netflix', 'https://www.disneyplus.com/video/abc'), 'content ref: the host must match the source');
select ok(not public.valid_content_ref('vimeo', 'https://vimeo.com/1'), 'content ref: unknown sources are refused');
select ok(not public.valid_content_ref('youtube', null), 'content ref: null is not a valid reference');
select tests.as_owner();
select throws_ok(
  format($$update public.rooms set content_ref = 'not a reference' where id = %L$$, tests.id('room')),
  '23514', null,
  'content ref: the rooms table refuses an invalid stored reference'
);

select * from finish();
rollback;
