-- Read rules: every rule allows a member and refuses a stranger. Also the client write rules
-- (profile column grants and their guard trigger, report inserts), the sign up trigger, and the
-- tables no client may read at all.
begin;
\ir _helpers.psql
select plan(68);

select tests.new_user('host');
select tests.new_user('guest');
select tests.new_user('leaver');
select tests.new_user('stranger');

select set_config('tests.room', tests.new_room('host', 'private')::text, true);
select tests.join('guest', current_setting('tests.room')::uuid);
select tests.join('leaver', current_setting('tests.room')::uuid);
select tests.call_as('leaver', format('public.leave_room(%L)', current_setting('tests.room')));
select set_config('tests.live_msg', (tests.call_as('guest', format('public.send_chat(%L, %L, null)', current_setting('tests.room'), 'hello')) -> 'data' ->> 'id'), true);
select set_config('tests.gone_msg', (tests.call_as('guest', format('public.send_chat(%L, %L, null)', current_setting('tests.room'), 'oops')) -> 'data' ->> 'id'), true);
select tests.call_as('guest', format('public.delete_message(%L)', current_setting('tests.gone_msg')));

-- Structure ----------------------------------------------------------------------------------

select is(
  (select count(*)::integer from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0,
  'RLS is on for every table in public'
);
select ok(
  (select 'security_invoker=true' = any (c.reloptions) from pg_class c where c.oid = 'public.room_view'::regclass),
  'room_view is a security_invoker view'
);
select ok(
  (select 'security_barrier=true' = any (c.reloptions) from pg_class c where c.oid = 'public.profile_public'::regclass),
  'profile_public is a security_barrier view'
);
select columns_are('public', 'profile_public', array['id', 'display_name', 'avatar_url'], 'profile_public exposes only id, display_name and avatar_url');
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and tablename in ('room_secrets', 'app_config')),
  0,
  'room_secrets and app_config have no policies'
);

-- Functions: what each role may execute, and how they run. Functions that belong to an extension
-- are left out.
select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('authenticated', p.oid, 'execute')),
  array['close_room', 'create_room', 'delete_message', 'get_room_link', 'is_member', 'join_room', 'leave_room',
        'moderate', 'post_system', 'realtime_topic_allowed', 'room_preview', 'rotate_join_key', 'send_chat',
        'server_time', 'set_playback', 'set_source', 'touch_member', 'transfer_host', 'update_room_settings',
        'valid_content_ref'],
  'functions: signed in users execute exactly the RPCs, the two policy helpers and valid_content_ref'
);
select is(
  (select count(*)::integer
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'execute')),
  0,
  'functions: anonymous visitors execute nothing'
);
select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and not p.prosecdef
     and p.proname <> 'valid_content_ref'),
  null,
  'functions: every function signed in users execute, other than valid_content_ref, is SECURITY DEFINER'
);
select is(
  (select array_agg(p.proname::text order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and not coalesce(p.proconfig @> array['search_path=""'], false)),
  null,
  'functions: every function sets search_path to empty'
);

-- profiles -------------------------------------------------------------------------------------

select tests.as_user('guest');
select is((select count(*)::integer from public.profiles), 1, 'profiles: a person reads exactly one profile row');
select is((select p.id from public.profiles p), tests.uid('guest'), 'profiles: the row is their own');
select is((select count(*)::integer from public.profiles p where p.id = tests.uid('host')), 0, 'profiles: a fellow member cannot read the host''s full row');
select tests.as_user('stranger');
select is((select count(*)::integer from public.profiles p where p.id = tests.uid('host')), 0, 'profiles: a stranger cannot read the host''s row');

-- profile_public -------------------------------------------------------------------------------

select tests.as_user('guest');
select is(
  (select array_agg(pp.id order by pp.id) from public.profile_public pp),
  (select array_agg(x order by x) from unnest(array[tests.uid('host'), tests.uid('guest'), tests.uid('leaver')]) x),
  'profile_public: a member sees themself and everyone who shares a room'
);
select is((select pp.display_name from public.profile_public pp where pp.id = tests.uid('host')), 'Person host', 'profile_public: a member reads the host''s display name');
select tests.as_user('leaver');
select is((select count(*)::integer from public.profile_public pp where pp.id = tests.uid('host')), 1, 'profile_public: someone who left still shares the room (any member state)');
select tests.as_user('stranger');
select is(
  (select array_agg(pp.id) from public.profile_public pp),
  array[tests.uid('stranger')],
  'profile_public: a stranger sees only themself'
);

-- rooms and room_view --------------------------------------------------------------------------

select tests.as_user('guest');
select is((select count(*)::integer from public.room_view), 1, 'room_view: a member reads the room');
select is((select count(*)::integer from public.rooms), 1, 'rooms: a member reads the room');
select tests.as_user('stranger');
select is((select count(*)::integer from public.room_view), 0, 'room_view: a stranger reads nothing');
select is((select count(*)::integer from public.rooms), 0, 'rooms: a stranger reads nothing');
select tests.as_user('leaver');
select is((select count(*)::integer from public.room_view), 0, 'room_view: someone who left reads nothing');

-- room_members ---------------------------------------------------------------------------------

select tests.as_user('guest');
select is((select count(*)::integer from public.room_members), 3, 'room_members: a member reads every row of the room');
select tests.as_user('stranger');
select is((select count(*)::integer from public.room_members), 0, 'room_members: a stranger reads nothing');
select tests.as_user('leaver');
select is((select count(*)::integer from public.room_members), 0, 'room_members: someone who left reads nothing');

-- playback_state -------------------------------------------------------------------------------

select tests.as_user('guest');
select is((select count(*)::integer from public.playback_state), 1, 'playback_state: a member reads it');
select tests.as_user('stranger');
select is((select count(*)::integer from public.playback_state), 0, 'playback_state: a stranger reads nothing');

-- messages -------------------------------------------------------------------------------------

select tests.as_user('host');
select is((select count(*)::integer from public.messages m where m.id = current_setting('tests.live_msg')::uuid), 1, 'messages: a member reads a live message');
select is((select count(*)::integer from public.messages m where m.id = current_setting('tests.gone_msg')::uuid), 0, 'messages: a soft deleted message is hidden from members');
select is((select count(*)::integer from public.messages m where m.deleted_at is not null), 0, 'messages: no deleted message is readable');
select tests.as_user('stranger');
select is((select count(*)::integer from public.messages), 0, 'messages: a stranger reads nothing');
select tests.as_owner();
select isnt((select m.deleted_at from public.messages m where m.id = current_setting('tests.gone_msg')::uuid), null, 'messages: the deleted message is kept with deleted_at set');

-- reports --------------------------------------------------------------------------------------

select tests.as_user('guest');
select lives_ok(
  format($$insert into public.reports (room_id, target_user_id, message_id, reason, note) values (%L, %L, null, 'spam', 'test')$$,
    current_setting('tests.room'), tests.uid('host')),
  'reports: a member files a report in their room'
);
select is((select count(*)::integer from public.reports), 1, 'reports: the reporter reads their report');
select is((select r.reporter_id from public.reports r), tests.uid('guest'), 'reports: reporter_id defaults to the caller');
select throws_ok(
  format($$insert into public.reports (room_id, reporter_id, target_user_id, reason) values (%L, %L, %L, 'spam')$$,
    current_setting('tests.room'), tests.uid('host'), tests.uid('host')),
  '42501', null,
  'reports: a member cannot file a report in someone else''s name'
);
select throws_ok(
  format($$insert into public.reports (room_id, target_user_id, reason, status) values (%L, %L, 'spam', 'reviewed')$$,
    current_setting('tests.room'), tests.uid('host')),
  '42501', null,
  'reports: a member cannot set the status'
);
select throws_ok(
  format($$insert into public.reports (room_id, target_user_id, reason) values (%L, %L, 'spam')$$,
    current_setting('tests.room'), tests.uid('stranger')),
  '42501', null,
  'reports: the target must have a membership row in the room'
);
select tests.as_user('host');
select is((select count(*)::integer from public.reports), 0, 'reports: the person reported cannot read the report');
select tests.as_user('stranger');
select is((select count(*)::integer from public.reports), 0, 'reports: a stranger reads nothing');
select throws_ok(
  format($$insert into public.reports (room_id, target_user_id, reason) values (%L, %L, 'spam')$$,
    current_setting('tests.room'), tests.uid('host')),
  '42501', null,
  'reports: a stranger cannot file a report in the room'
);

-- Tables no client reads --------------------------------------------------------------------

select tests.as_user('host');
select throws_ok('select * from public.room_secrets', '42501', null, 'room_secrets: even the host cannot read join keys');
select throws_ok('select * from public.app_config', '42501', null, 'app_config: a signed in user cannot read it');
select tests.as_anon();
select throws_ok('select * from public.room_view', '42501', null, 'room_view: anonymous visitors are refused');
select throws_ok('select * from public.profile_public', '42501', null, 'profile_public: anonymous visitors are refused');
select throws_ok('select * from public.profiles', '42501', null, 'profiles: anonymous visitors are refused');
select throws_ok('select public.server_time()', '42501', null, 'RPCs: anonymous visitors cannot execute them');

-- Direct writes are refused -------------------------------------------------------------------

select tests.as_user('host');
select throws_ok(
  $$insert into public.rooms (slug, host_id, title, visibility, source, room_cap, voice_mode) values ('abcdefghij', auth.uid(), 'x', 'public', 'youtube', 10, 'server')$$,
  '42501', null, 'rooms: no direct insert'
);
select throws_ok(format($$update public.rooms set room_cap = 10 where id = %L$$, current_setting('tests.room')), '42501', null, 'rooms: no direct update');
select throws_ok(format($$update public.playback_state set seq = 99 where room_id = %L$$, current_setting('tests.room')), '42501', null, 'playback_state: no direct update');
select throws_ok(format($$update public.room_members set state = 'joined' where room_id = %L$$, current_setting('tests.room')), '42501', null, 'room_members: no direct update');
select throws_ok(format($$insert into public.messages (room_id, kind, body) values (%L, 'chat', 'x')$$, current_setting('tests.room')), '42501', null, 'messages: no direct insert');
select throws_ok(format($$delete from public.messages where room_id = %L$$, current_setting('tests.room')), '42501', null, 'messages: no direct delete');
select throws_ok(format($$insert into public.room_secrets (room_id, join_key) values (%L, 'x')$$, current_setting('tests.room')), '42501', null, 'room_secrets: no direct insert');

-- profiles: column grants and guard trigger ---------------------------------------------------

select tests.as_user('guest');
select lives_ok($$update public.profiles set display_name = 'Renamed', duck_level = 0.5 where id = auth.uid()$$, 'profiles: a person changes their display name and ducking level');
select is((select p.display_name || ' ' || p.duck_level from public.profiles p), 'Renamed 0.5', 'profiles: the change is stored');
select lives_ok($$update public.profiles set duck_level = null where id = auth.uid()$$, 'profiles: a null ducking level turns ducking off');
select throws_ok($$update public.profiles set plan = 'paid' where id = auth.uid()$$, '42501', null, 'profiles: plan is not writable');
select throws_ok($$update public.profiles set avatar_url = 'https://example.com/a.png' where id = auth.uid()$$, '42501', null, 'profiles: avatar_url is not writable');
select throws_ok($$update public.profiles set display_name = '' where id = auth.uid()$$, '23514', null, 'profiles: an empty display name is refused');
select throws_ok($$update public.profiles set display_name = repeat('x', 41) where id = auth.uid()$$, '23514', null, 'profiles: a display name over 40 characters is refused');
select throws_ok($$update public.profiles set duck_level = 1.5 where id = auth.uid()$$, '23514', null, 'profiles: a ducking level above 1 is refused');
select tests.as_user('stranger');
update public.profiles set display_name = 'Hijacked' where id = tests.uid('host');
select tests.as_owner();
select is((select p.display_name from public.profiles p where p.id = tests.uid('host')), 'Person host', 'profiles: nobody changes someone else''s row');
-- Widen the grant by mistake, inside this transaction only: the trigger still refuses.
grant update (plan) on table public.profiles to authenticated;
select tests.as_user('guest');
select throws_ok($$update public.profiles set plan = 'paid' where id = auth.uid()$$, '42501', 'only display_name and duck_level can be changed', 'profiles: the guard trigger refuses any other column');
select tests.as_owner();

-- Sign up trigger -------------------------------------------------------------------------------

select tests.new_user('named', 'free', '{"name": "  Only Name  ", "picture": "https://example.com/p.png"}');
select tests.new_user('emailonly', 'free', '{}');
select tests.new_user('longname', 'free', jsonb_build_object('full_name', repeat('n', 60), 'avatar_url', 'https://example.com/a.png'));
select is((select p.display_name from public.profiles p where p.id = tests.uid('named')), 'Only Name', 'sign up: name is used, trimmed, when full_name is missing');
select is((select p.avatar_url from public.profiles p where p.id = tests.uid('named')), 'https://example.com/p.png', 'sign up: picture is used when avatar_url is missing');
select is((select p.display_name from public.profiles p where p.id = tests.uid('emailonly')), 'emailonly', 'sign up: the email local part is used when there is no name');
select is((select p.display_name from public.profiles p where p.id = tests.uid('longname')), repeat('n', 40), 'sign up: the display name is cut to 40 characters');

select * from finish();
rollback;
