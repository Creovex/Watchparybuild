-- delete_message(message_id)
-- Sets deleted_at. Allowed for the author of a chat message or timed comment, and for the host of
-- the room on any message, while the caller is a member of the room. The soft delete is sent to
-- members as a `chat` event. Deleting a deleted message changes nothing and succeeds.
-- data: <message row>
-- codes: unauthorized, not_allowed (also for a message that does not exist)
create function public.delete_message(message_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_message public.messages;
begin
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  select msg.* into v_message from public.messages msg where msg.id = delete_message.message_id for update;
  if not found then
    return public.rpc_error('not_allowed');
  end if;

  if not exists (
       select 1 from public.room_members m
       where m.room_id = v_message.room_id and m.user_id = v_uid and m.state = 'joined'
     )
     or not (
       (v_message.user_id = v_uid and v_message.kind in ('chat', 'timed'))
       or public.is_room_host(v_message.room_id, v_uid)
     ) then
    return public.rpc_error('not_allowed');
  end if;

  if v_message.deleted_at is null then
    update public.messages msg set deleted_at = clock_timestamp()
    where msg.id = v_message.id
    returning msg.* into v_message;
  end if;

  return public.rpc_ok(to_jsonb(v_message));
end;
$$;

revoke execute on function public.delete_message(uuid) from public, anon;
grant execute on function public.delete_message(uuid) to authenticated;
