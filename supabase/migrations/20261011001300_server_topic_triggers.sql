-- Server topic events. Only the database writes to `room:<room_id>:<epoch>:server`, through
-- `realtime.send` from these triggers (and the `moderation` event from the moderate RPC). Events go
-- to the room's current channel_epoch.
--   state:   every insert or update of playback_state, with the full row.
--   room:    updates of title, source, content_ref, control_mode, wait_for_everyone, locked, status
--            or host_id, with the room row. Never for last_active_at or channel_epoch.
--   members: inserts, and updates of state, role or voice_muted, with the member row. Never for
--            last_seen_at, buffering_since, engine_session or sync_mode, which change every 20
--            seconds and would use up the message quota. engine_session is left out of the payload.
--   chat:    message inserts and soft deletes, with the message row.
-- `realtime.send` adds an `id` key to payloads that have none; receivers ignore it.
-- The functions are SECURITY DEFINER so the insert into realtime.messages runs as the owner.

create function public.broadcast_playback_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_epoch integer;
begin
  select r.channel_epoch into v_epoch from public.rooms r where r.id = new.room_id;
  perform realtime.send(to_jsonb(new), 'state', public.server_topic(new.room_id, v_epoch), true);
  return null;
end;
$$;

create trigger playback_state_broadcast
  after insert or update on public.playback_state
  for each row execute function public.broadcast_playback_state();

create function public.broadcast_room()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.send(to_jsonb(new), 'room', public.server_topic(new.id, new.channel_epoch), true);
  return null;
end;
$$;

create trigger rooms_broadcast
  after update of title, source, content_ref, control_mode, wait_for_everyone, locked, status, host_id
  on public.rooms
  for each row
  when (
    (old.title, old.source, old.content_ref, old.control_mode, old.wait_for_everyone, old.locked, old.status, old.host_id)
    is distinct from
    (new.title, new.source, new.content_ref, new.control_mode, new.wait_for_everyone, new.locked, new.status, new.host_id)
  )
  execute function public.broadcast_room();

create function public.broadcast_member()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_epoch integer;
begin
  select r.channel_epoch into v_epoch from public.rooms r where r.id = new.room_id;
  perform realtime.send(to_jsonb(new) - 'engine_session', 'members', public.server_topic(new.room_id, v_epoch), true);
  return null;
end;
$$;

create trigger room_members_broadcast_insert
  after insert on public.room_members
  for each row execute function public.broadcast_member();

create trigger room_members_broadcast_update
  after update of state, role, voice_muted on public.room_members
  for each row
  when ((old.state, old.role, old.voice_muted) is distinct from (new.state, new.role, new.voice_muted))
  execute function public.broadcast_member();

create function public.broadcast_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_epoch integer;
begin
  select r.channel_epoch into v_epoch from public.rooms r where r.id = new.room_id;
  perform realtime.send(to_jsonb(new), 'chat', public.server_topic(new.room_id, v_epoch), true);
  return null;
end;
$$;

create trigger messages_broadcast_insert
  after insert on public.messages
  for each row execute function public.broadcast_message();

create trigger messages_broadcast_soft_delete
  after update of deleted_at on public.messages
  for each row
  when (old.deleted_at is null and new.deleted_at is not null)
  execute function public.broadcast_message();

revoke execute on function public.broadcast_playback_state() from public, anon, authenticated;
revoke execute on function public.broadcast_room() from public, anon, authenticated;
revoke execute on function public.broadcast_member() from public, anon, authenticated;
revoke execute on function public.broadcast_message() from public, anon, authenticated;
