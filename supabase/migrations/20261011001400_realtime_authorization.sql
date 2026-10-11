-- Realtime Authorization for the two private channels of each room:
--   room:<room_id>:<epoch>:server  written only by the database, read by members
--   room:<room_id>:<epoch>:client  read and written by members
-- A member may join (select) either topic, for broadcast and presence, when the epoch in the topic
-- is the room's current channel_epoch or the one before it, so remaining members can still read
-- the `moderation` event that tells them to move. Sending and presence tracking (insert) is allowed
-- only on the client topic under the same condition. Realtime checks these policies when a client
-- joins a channel and when it sends a new token.
-- RLS is already on for realtime.messages and is managed by Supabase; this migration only adds
-- policies to it.

-- Parses a topic and decides access. A malformed topic returns false instead of raising inside a
-- policy. The pattern accepts only the canonical form: a lowercase room id and an epoch without
-- leading zeros, the same text the server topic triggers write to.
create function public.realtime_topic_allowed(topic text, for_send boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_parts text[];
  v_room_id uuid;
  v_epoch integer;
  v_kind text;
  v_current integer;
begin
  if $1 is null or $2 is null then
    return false;
  end if;

  v_parts := regexp_match(
    $1,
    '^room:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([1-9][0-9]{0,8}):(server|client)$'
  );
  if v_parts is null then
    return false;
  end if;

  v_room_id := v_parts[1]::uuid;
  v_epoch := v_parts[2]::integer;
  v_kind := v_parts[3];

  if $2 and v_kind <> 'client' then
    return false;
  end if;

  select r.channel_epoch into v_current from public.rooms r where r.id = v_room_id;
  if not found then
    return false;
  end if;

  if v_epoch <> v_current and v_epoch <> v_current - 1 then
    return false;
  end if;

  return public.is_member(v_room_id);
end;
$$;

revoke execute on function public.realtime_topic_allowed(text, boolean) from public, anon;
grant execute on function public.realtime_topic_allowed(text, boolean) to authenticated;

create policy "room topics: members receive broadcast and presence"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.realtime_topic_allowed((select realtime.topic()), false)
  );

create policy "room topics: members send broadcast and presence on the client topic"
  on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and public.realtime_topic_allowed((select realtime.topic()), true)
  );
