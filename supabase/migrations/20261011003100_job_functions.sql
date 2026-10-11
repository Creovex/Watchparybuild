-- Functions the scheduled jobs call. They are plain functions run by pg_cron as postgres, and
-- tests call them directly. No client role may execute them.

-- Every minute: in each open room whose host is not present while a guest is, hand host to the
-- present guest with the earliest first_joined_at and post `host_changed`. Returns the number of
-- rooms handed over.
create function public.handover_absent_hosts()
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_new_host uuid;
  v_count integer := 0;
begin
  for v_room in
    select r.*
    from public.rooms r
    where r.status = 'open'
      and not exists (
        select 1 from public.room_members h
        where h.room_id = r.id
          and h.user_id = r.host_id
          and h.state = 'joined'
          and h.last_seen_at > public.present_since()
      )
      and exists (
        select 1 from public.room_members g
        where g.room_id = r.id
          and g.user_id is distinct from r.host_id
          and g.state = 'joined'
          and g.last_seen_at > public.present_since()
      )
    order by r.id
    for update of r
  loop
    select g.user_id into v_new_host
    from public.room_members g
    where g.room_id = v_room.id
      and g.user_id is distinct from v_room.host_id
      and g.state = 'joined'
      and g.last_seen_at > public.present_since()
    order by g.first_joined_at, g.user_id
    limit 1;

    if v_new_host is null then
      continue;
    end if;

    update public.room_members m set role = 'guest'
    where m.room_id = v_room.id and m.user_id = v_room.host_id and m.role = 'host';

    update public.room_members m set role = 'host'
    where m.room_id = v_room.id and m.user_id = v_new_host;

    update public.rooms r set host_id = v_new_host where r.id = v_room.id;

    perform public.insert_system_message(v_room.id, v_new_host, 'host_changed', jsonb_build_object('user_id', v_new_host));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Every 10 minutes: close open rooms that have had no present member for 30 minutes, long enough
-- for a phone call or a snack break. A member stays present for 60 seconds after their last
-- refresh, so the room's last activity and every joined member's last refresh must be more than
-- 31 minutes old. Returns the number of rooms closed.
create function public.close_idle_rooms()
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.rooms r
  set status = 'closed'
  where r.status = 'open'
    and r.last_active_at < clock_timestamp() - interval '31 minutes'
    and not exists (
      select 1 from public.room_members m
      where m.room_id = r.id
        and m.state = 'joined'
        and m.last_seen_at >= clock_timestamp() - interval '31 minutes'
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Every minute: clear buffering_since for members who are not present, so an absent member never
-- holds a room in a buffer pause. Returns the number of members cleared.
create function public.clear_stale_buffering()
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.room_members m
  set buffering_since = null
  where m.buffering_since is not null
    and not (m.state = 'joined' and m.last_seen_at > public.present_since());
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.handover_absent_hosts() from public, anon, authenticated;
revoke execute on function public.close_idle_rooms() from public, anon, authenticated;
revoke execute on function public.clear_stale_buffering() from public, anon, authenticated;
