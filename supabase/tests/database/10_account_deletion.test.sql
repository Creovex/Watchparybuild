-- Account deletion, as the delete-account Edge Function does it: close the rooms the user hosts,
-- then delete the auth user. Foreign keys must then remove the profile and memberships, keep
-- messages with a null user_id ("Deleted user"), keep reports with a null reporter or target, and
-- set host_id to null on the closed rooms.
begin;
\ir _helpers.psql
select plan(11);

select tests.new_user('host');
select tests.new_user('leaving');
select tests.new_user('g1');

select tests.put('room', tests.new_room('host')::text);
select tests.put('own_room', tests.new_room('leaving')::text);
select tests.join('leaving', tests.id('room'));
select tests.join('g1', tests.id('room'));
select tests.put('msg', tests.call_as('leaving', format('public.send_chat(%L, %L, null)', tests.id('room'), 'bye')) -> 'data' ->> 'id');
select tests.call_as('host', format('public.set_playback(%L, 0, %L, 1, 1, 0, %L)', tests.id('room'), 'playing', 'user'));
select tests.call_as('host', format('public.moderate(%L, %L, %L)', tests.id('room'), tests.uid('leaving'), 'mute_voice'));
select tests.as_user('leaving');
insert into public.reports (room_id, target_user_id, reason) values (tests.id('room'), tests.uid('g1'), 'spam');
select tests.as_user('g1');
insert into public.reports (room_id, target_user_id, message_id, reason) values (tests.id('room'), tests.uid('leaving'), tests.id('msg'), 'harassment');
select tests.as_owner();

-- What the Edge Function does with the service role.
update public.rooms set status = 'closed' where host_id = tests.uid('leaving') and status = 'open';
select lives_ok(format('delete from auth.users where id = %L', tests.uid('leaving')), 'deletion: the auth user can be deleted');

select is((select count(*)::integer from public.profiles p where p.id = tests.uid('leaving')), 0, 'deletion: the profile is removed');
select is((select count(*)::integer from public.room_members m where m.user_id = tests.uid('leaving')), 0, 'deletion: memberships are removed');
select is((select m.user_id from public.messages m where m.id = tests.id('msg')), null, 'deletion: messages are kept with a null user_id');
select is((select m.body from public.messages m where m.id = tests.id('msg')), 'bye', 'deletion: the message text is kept');
select is((select count(*)::integer from public.reports r where r.reporter_id is null and r.target_user_id = tests.uid('g1')), 1, 'deletion: a report the user filed is kept with a null reporter');
select is((select count(*)::integer from public.reports r where r.target_user_id is null and r.reporter_id = tests.uid('g1')), 1, 'deletion: a report about the user is kept with a null target');
select is((tests.room(tests.id('own_room'))).host_id, null, 'deletion: rooms the user hosted keep a null host_id');
select is((tests.room(tests.id('own_room'))).status, 'closed', 'deletion: and stay closed');
select is((tests.playback(tests.id('room'))).seq, 1::bigint, 'deletion: playback state of other rooms is untouched');
select is((select count(*)::integer from public.room_members m where m.room_id = tests.id('room') and m.state = 'joined'), 2, 'deletion: the other members stay');

select * from finish();
rollback;
