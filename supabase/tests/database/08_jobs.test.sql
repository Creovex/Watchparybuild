-- Scheduled job functions, called directly: handover_absent_hosts, close_idle_rooms and
-- clear_stale_buffering. Also their schedules, and that no client role can execute them.
begin;
\ir _helpers.psql
select plan(26);

select tests.new_user('host');
select tests.new_user('g1');
select tests.new_user('g2');

-- Schedules and privileges ---------------------------------------------------------------------

select is(
  (select array_agg(j.jobname || ' ' || j.schedule || ' ' || j.command order by j.jobname) from cron.job j),
  array[
    'clear_stale_buffering * * * * * select public.clear_stale_buffering()',
    'close_idle_rooms */10 * * * * select public.close_idle_rooms()',
    'handover_absent_hosts * * * * * select public.handover_absent_hosts()'
  ],
  'jobs: scheduled every minute, every 10 minutes and every minute'
);
select ok(
  not has_function_privilege('authenticated', 'public.handover_absent_hosts()', 'execute')
  and not has_function_privilege('authenticated', 'public.close_idle_rooms()', 'execute')
  and not has_function_privilege('authenticated', 'public.clear_stale_buffering()', 'execute'),
  'jobs: signed in users cannot execute the job functions'
);
select ok(
  not has_function_privilege('anon', 'public.handover_absent_hosts()', 'execute')
  and not has_function_privilege('anon', 'public.close_idle_rooms()', 'execute')
  and not has_function_privilege('anon', 'public.clear_stale_buffering()', 'execute'),
  'jobs: anonymous visitors cannot execute the job functions'
);
select tests.as_user('host');
select throws_ok('select public.handover_absent_hosts()', '42501', null, 'jobs: a signed in call is refused');
select tests.as_owner();

-- handover_absent_hosts (E9) ---------------------------------------------------------------------

-- Room A: the host is absent, two guests are present; g2 joined first.
select tests.put('a', tests.new_room('host')::text);
select tests.join('g1', tests.id('a'));
select tests.join('g2', tests.id('a'));
update public.room_members set first_joined_at = clock_timestamp() - interval '1 hour' where room_id = tests.id('a') and user_id = tests.uid('g2');
select tests.set_seen(tests.id('a'), 'host', 61);
-- Room B: the host is present.
select tests.put('b', tests.new_room('host')::text);
select tests.join('g1', tests.id('b'));
-- Room C: the host is absent and so is the only guest.
select tests.put('c', tests.new_room('host')::text);
select tests.join('g1', tests.id('c'));
select tests.set_seen(tests.id('c'), 'host', 61);
select tests.set_seen(tests.id('c'), 'g1', 61);
-- Room D: closed, host absent, guest present.
select tests.put('d', tests.new_room('host')::text);
select tests.join('g1', tests.id('d'));
select tests.call_as('host', format('public.close_room(%L)', tests.id('d')));
select tests.set_seen(tests.id('d'), 'host', 61);

select is(public.handover_absent_hosts(), 1, 'handover_absent_hosts: hands over exactly one room');
select is((tests.room(tests.id('a'))).host_id, tests.uid('g2'), 'handover_absent_hosts: host goes to the present guest with the earliest first_joined_at');
select is((tests.member(tests.id('a'), 'g2')).role, 'host', 'handover_absent_hosts: the new host gets role host');
select is((tests.member(tests.id('a'), 'host')).role, 'guest', 'handover_absent_hosts: the absent host becomes a guest');
select is(
  (select m.body::jsonb from tests.system_messages(tests.id('a'), 'host_changed') m),
  jsonb_build_object('user_id', tests.uid('g2')),
  'handover_absent_hosts: posts host_changed'
);
select is(tests.sent(tests.id('a'), 'room', 1), 1, 'handover_absent_hosts: the room event tells members');
select is((tests.room(tests.id('b'))).host_id, tests.uid('host'), 'handover_absent_hosts: a present host keeps host');
select is((tests.room(tests.id('c'))).host_id, tests.uid('host'), 'handover_absent_hosts: nothing changes with no present guest');
select is((tests.room(tests.id('d'))).host_id, tests.uid('host'), 'handover_absent_hosts: closed rooms are left alone');
select is(public.handover_absent_hosts(), 0, 'handover_absent_hosts: a second run finds nothing to do');

-- The former host returns: they are a guest now.
select is(tests.join('host', tests.id('a')) -> 'data' -> 'room' ->> 'host_id', tests.uid('g2')::text, 'handover_absent_hosts: the former host returns as a guest');

-- close_idle_rooms -----------------------------------------------------------------------------

-- Room E: nobody present for 32 minutes.
select tests.put('e', tests.new_room('host')::text);
update public.rooms set last_active_at = clock_timestamp() - interval '32 minutes' where id = tests.id('e');
select tests.set_seen(tests.id('e'), 'host', 32 * 60);
-- Room F: last activity 29 minutes ago.
select tests.put('f', tests.new_room('host')::text);
update public.rooms set last_active_at = clock_timestamp() - interval '29 minutes' where id = tests.id('f');
select tests.set_seen(tests.id('f'), 'host', 29 * 60);
-- Room G: everyone left 40 minutes ago.
select tests.put('g', tests.new_room('host')::text);
select tests.call_as('host', format('public.leave_room(%L)', tests.id('g')));
update public.rooms set last_active_at = clock_timestamp() - interval '40 minutes' where id = tests.id('g');
-- Room H: the room looks idle but a joined member refreshed 10 minutes ago.
select tests.put('h', tests.new_room('host')::text);
update public.rooms set last_active_at = clock_timestamp() - interval '40 minutes' where id = tests.id('h');
select tests.set_seen(tests.id('h'), 'host', 10 * 60);
-- Rooms A to D were active just now.

select is(public.close_idle_rooms(), 2, 'close_idle_rooms: closes exactly the two idle rooms');
select is((tests.room(tests.id('e'))).status, 'closed', 'close_idle_rooms: closes a room with no present member for 30 minutes');
select is((tests.room(tests.id('g'))).status, 'closed', 'close_idle_rooms: closes a room everyone left 30 minutes ago');
select is((tests.room(tests.id('f'))).status, 'open', 'close_idle_rooms: keeps a room idle for less than 30 minutes');
select is((tests.room(tests.id('h'))).status, 'open', 'close_idle_rooms: keeps a room with a member seen inside the window');
select is((tests.room(tests.id('a'))).status, 'open', 'close_idle_rooms: keeps an active room');
select is(tests.sent(tests.id('e'), 'room', 1), 1, 'close_idle_rooms: members are told through the room event');

-- clear_stale_buffering ------------------------------------------------------------------------

select tests.put('k', tests.new_room('host')::text);
select tests.join('g1', tests.id('k'));
select tests.join('g2', tests.id('k'));
update public.room_members set buffering_since = clock_timestamp() - interval '5 seconds' where room_id = tests.id('k');
select tests.set_seen(tests.id('k'), 'g1', 61);
select tests.call_as('g2', format('public.leave_room(%L)', tests.id('k')));
update public.room_members set buffering_since = clock_timestamp() where room_id = tests.id('k') and user_id = tests.uid('g2');

select is(public.clear_stale_buffering(), 2, 'clear_stale_buffering: clears two members');
select is((tests.member(tests.id('k'), 'g1')).buffering_since, null, 'clear_stale_buffering: clears a member who is absent');
select is((tests.member(tests.id('k'), 'g2')).buffering_since, null, 'clear_stale_buffering: clears a member who left');
select isnt((tests.member(tests.id('k'), 'host')).buffering_since, null, 'clear_stale_buffering: keeps a present member buffering');

select * from finish();
rollback;
