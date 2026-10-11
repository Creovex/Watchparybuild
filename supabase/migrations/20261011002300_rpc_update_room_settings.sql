-- update_room_settings(room_id, settings)
-- Host only. settings is a JSON object holding any of: title (text, 1 to 80 characters after
-- trimming), control_mode ('host' or 'everyone'), wait_for_everyone (boolean), locked (boolean).
-- Any other key, a wrong type or an empty object is invalid_input.
-- data: <room row>
-- codes: unauthorized, not_host, invalid_input
create function public.update_room_settings(room_id uuid, settings jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_room_id uuid := update_room_settings.room_id;
  v_settings jsonb := update_room_settings.settings;
  v_room public.rooms;
  v_title text;
  v_control text;
begin
  if v_uid is null then
    return public.rpc_error('unauthorized');
  end if;

  select r.* into v_room from public.rooms r where r.id = v_room_id for update;
  if not found or not public.is_room_host(v_room_id, v_uid) then
    return public.rpc_error('not_host');
  end if;

  if v_settings is null or jsonb_typeof(v_settings) <> 'object' or v_settings = '{}'::jsonb
     or exists (
       select 1 from jsonb_object_keys(v_settings) k
       where k not in ('title', 'control_mode', 'wait_for_everyone', 'locked')
     ) then
    return public.rpc_error('invalid_input');
  end if;

  if v_settings ? 'title' then
    if jsonb_typeof(v_settings -> 'title') <> 'string' then
      return public.rpc_error('invalid_input');
    end if;
    v_title := btrim(v_settings ->> 'title');
    if char_length(v_title) not between 1 and 80 then
      return public.rpc_error('invalid_input');
    end if;
  end if;

  if v_settings ? 'control_mode' then
    v_control := v_settings ->> 'control_mode';
    if jsonb_typeof(v_settings -> 'control_mode') <> 'string' or v_control not in ('host', 'everyone') then
      return public.rpc_error('invalid_input');
    end if;
  end if;

  if (v_settings ? 'wait_for_everyone' and jsonb_typeof(v_settings -> 'wait_for_everyone') <> 'boolean')
     or (v_settings ? 'locked' and jsonb_typeof(v_settings -> 'locked') <> 'boolean') then
    return public.rpc_error('invalid_input');
  end if;

  update public.rooms r
  set title = coalesce(v_title, r.title),
      control_mode = coalesce(v_control, r.control_mode),
      wait_for_everyone = coalesce((v_settings ->> 'wait_for_everyone')::boolean, r.wait_for_everyone),
      locked = coalesce((v_settings ->> 'locked')::boolean, r.locked)
  where r.id = v_room_id
  returning r.* into v_room;

  return public.rpc_ok(to_jsonb(v_room));
end;
$$;

revoke execute on function public.update_room_settings(uuid, jsonb) from public, anon;
grant execute on function public.update_room_settings(uuid, jsonb) to authenticated;
