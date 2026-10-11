-- send_chat(room_id, body, position_sec)
-- Member only. The body is trimmed of surrounding whitespace and must then hold 1 to 1,000
-- characters. A position_sec makes the message a timed comment; null makes it plain chat.
-- At most 5 messages per 5 seconds per user per room, because faster than that is flooding: the
-- sixth inside 5 seconds is rate_limited. Locking the caller's member row makes the count exact
-- when calls arrive in parallel.
-- data: <message row>
-- codes: unauthorized, not_member, invalid_input, rate_limited
create function public.send_chat(room_id uuid, body text, position_sec double precision)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid := send_chat.room_id;
  v_body text := regexp_replace(coalesce(send_chat.body, ''), '^\s+|\s+$', '', 'g');
  v_position double precision := send_chat.position_sec;
  v_recent integer;
  v_message public.messages;
begin
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  -- Room row first, then the member row: the order every RPC uses, so this call cannot deadlock
  -- with touch_member or join_room from the same person. A key share lock still lets other
  -- members chat at the same time.
  perform 1 from public.rooms r where r.id = v_room_id for key share;
  perform 1
  from public.room_members m
  where m.room_id = v_room_id and m.user_id = v_uid and m.state = 'joined'
  for update;
  if not found then
    return public.rpc_error('not_member');
  end if;

  if char_length(v_body) not between 1 and 1000
     or (v_position is not null and not (v_position >= 0 and v_position < 'infinity'::double precision)) then
    return public.rpc_error('invalid_input');
  end if;

  select count(*) into v_recent
  from public.messages msg
  where msg.room_id = v_room_id
    and msg.user_id = v_uid
    and msg.kind in ('chat', 'timed')
    and msg.created_at > clock_timestamp() - interval '5 seconds';
  if v_recent >= 5 then
    return public.rpc_error('rate_limited');
  end if;

  insert into public.messages as msg (room_id, user_id, kind, body, position_sec)
  values (v_room_id, v_uid, case when v_position is null then 'chat' else 'timed' end, v_body, v_position)
  returning msg.* into v_message;

  return public.rpc_ok(to_jsonb(v_message));
end;
$$;

revoke execute on function public.send_chat(uuid, text, double precision) from public, anon;
grant execute on function public.send_chat(uuid, text, double precision) to authenticated;
