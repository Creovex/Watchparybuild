-- moderate(room_id, target_id, action)
-- Host only; called by the `moderate` Edge Function with the host's JWT (gap G20 covers direct
-- calls). Actions and the target state each needs:
--   remove        joined                  -> removed
--   ban           joined, left or removed -> banned
--   mute_voice    joined                  -> voice_muted true
--   unmute_voice  joined                  -> voice_muted false
--   allow_back    removed                 -> left, so the user may join again
-- A target with no row, or in a state the action does not apply to, is not_member.
-- For remove and ban the RPC first sends the `moderation` event { target, action, new_epoch } on
-- the current server topic, then changes the member (its `members` event also goes to the current
-- topic, which the target still holds), then increments channel_epoch. Every later server event
-- goes to the new topics, which the target cannot join.
-- A member muted by the host cannot unmute themselves: no other RPC changes voice_muted.
-- data: { member: <member row without engine_session>, channel_epoch: the room's epoch after the call }
-- codes: unauthorized, invalid_input, not_host, not_member
create function public.moderate(room_id uuid, target_id uuid, action text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid := moderate.room_id;
  v_target uuid := moderate.target_id;
  v_action text := moderate.action;
  v_room public.rooms;
  v_member public.room_members;
begin
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  if v_action is null or v_action not in ('remove', 'ban', 'mute_voice', 'unmute_voice', 'allow_back') then
    return public.rpc_error('invalid_input');
  end if;

  select r.* into v_room from public.rooms r where r.id = v_room_id for update;
  if not found or not public.is_room_host(v_room_id, v_uid) then
    return public.rpc_error('not_host');
  end if;

  if v_target is null or v_target = v_uid then
    return public.rpc_error('invalid_input');
  end if;

  select m.* into v_member
  from public.room_members m
  where m.room_id = v_room_id and m.user_id = v_target
  for update;
  if not found
     or (v_action in ('remove', 'mute_voice', 'unmute_voice') and v_member.state <> 'joined')
     or (v_action = 'ban' and v_member.state = 'banned')
     or (v_action = 'allow_back' and v_member.state <> 'removed') then
    return public.rpc_error('not_member');
  end if;

  if v_action in ('remove', 'ban') then
    perform realtime.send(
      jsonb_build_object('target', v_target, 'action', v_action, 'new_epoch', v_room.channel_epoch + 1),
      'moderation',
      public.server_topic(v_room_id, v_room.channel_epoch),
      true
    );

    update public.room_members m
    set state = case when v_action = 'remove' then 'removed' else 'banned' end,
        left_at = case when m.state = 'joined' then clock_timestamp() else m.left_at end,
        buffering_since = null
    where m.room_id = v_room_id and m.user_id = v_target
    returning m.* into v_member;

    update public.rooms r set channel_epoch = r.channel_epoch + 1 where r.id = v_room_id
    returning r.* into v_room;
  elsif v_action in ('mute_voice', 'unmute_voice') then
    update public.room_members m
    set voice_muted = (v_action = 'mute_voice')
    where m.room_id = v_room_id and m.user_id = v_target
    returning m.* into v_member;
  else
    update public.room_members m
    set state = 'left'
    where m.room_id = v_room_id and m.user_id = v_target
    returning m.* into v_member;
  end if;

  return public.rpc_ok(jsonb_build_object(
    'member', to_jsonb(v_member) - 'engine_session',
    'channel_epoch', v_room.channel_epoch
  ));
end;
$$;

revoke execute on function public.moderate(uuid, uuid, text) from public, anon;
grant execute on function public.moderate(uuid, uuid, text) to authenticated;
