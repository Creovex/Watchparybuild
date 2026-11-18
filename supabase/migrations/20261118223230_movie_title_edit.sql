-- Owners may edit library titles without changing playback, files or storage usage.
create function public.rename_movie(movie_id uuid, title text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_title text := btrim(rename_movie.title); v_id uuid;
begin
  if auth.uid() is null then return public.rpc_error('unauthorized'); end if;
  if v_title is null or char_length(v_title) < 1 or char_length(v_title) > 120 then
    return public.rpc_error('invalid_input');
  end if;
  update public.movies m set title = v_title
    where m.id = rename_movie.movie_id and m.owner_id = auth.uid() and m.status = 'ready'
    returning m.id into v_id;
  if v_id is null then return public.rpc_error('not_found'); end if;
  return public.rpc_ok(jsonb_build_object('id', v_id, 'title', v_title));
end;
$$;
revoke all on function public.rename_movie(uuid,text) from public, anon;
grant execute on function public.rename_movie(uuid,text) to authenticated;
