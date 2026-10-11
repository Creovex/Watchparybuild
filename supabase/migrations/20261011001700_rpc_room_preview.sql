-- room_preview(slug): what the join screen shows before someone joins.
-- data: { title, source, visibility, locked, status, present_count, room_cap }
-- codes: unauthorized, not_found
create function public.room_preview(slug text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
begin
  if auth.uid() is null then
    return public.rpc_error('unauthorized');
  end if;

  select r.* into v_room from public.rooms r where r.slug = room_preview.slug;
  if not found then
    return public.rpc_error('not_found');
  end if;

  return public.rpc_ok(jsonb_build_object(
    'title', v_room.title,
    'source', v_room.source,
    'visibility', v_room.visibility,
    'locked', v_room.locked,
    'status', v_room.status,
    'present_count', public.present_count(v_room.id),
    'room_cap', v_room.room_cap
  ));
end;
$$;

revoke execute on function public.room_preview(text) from public, anon;
grant execute on function public.room_preview(text) to authenticated;
