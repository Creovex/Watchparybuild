-- Read access for signed in users, as in "Read access (RLS and views)".
--   profiles full row: the user themself.
--   profile_public: id, display_name and avatar_url of users who share a room with the caller.
--   rooms (and room_view), room_members, playback_state: members of the room.
--   messages: members of the room, deleted messages never.
--   reports: the reporter.
-- room_secrets and app_config have no policy at all.
-- The only client writes are the profile columns granted in the profiles migration and report
-- inserts by a member of the room, below.

create policy "profiles: the user reads their own row"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()));

create policy "profiles: the user updates their own row"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "rooms: members read"
  on public.rooms for select to authenticated
  using (public.is_member(id));

create policy "room_members: members of the same room read"
  on public.room_members for select to authenticated
  using (public.is_member(room_id));

create policy "playback_state: members read"
  on public.playback_state for select to authenticated
  using (public.is_member(room_id));

create policy "messages: members read messages that are not deleted"
  on public.messages for select to authenticated
  using (deleted_at is null and public.is_member(room_id));

create policy "reports: the reporter reads"
  on public.reports for select to authenticated
  using (reporter_id = (select auth.uid()));

-- A member files a report about someone who has a membership row in the same room.
create policy "reports: members file reports in their room"
  on public.reports for insert to authenticated
  with check (
    reporter_id = (select auth.uid())
    and status = 'new'
    and public.is_member(room_id)
    and exists (
      select 1
      from public.room_members t
      where t.room_id = reports.room_id
        and t.user_id = reports.target_user_id
    )
  );

-- Every rooms column, for rooms where the caller is a member. security_invoker keeps the rooms
-- policy in force.
create view public.room_view
with (security_invoker = true)
as
  select r.*
  from public.rooms r
  where public.is_member(r.id);

revoke all on table public.room_view from public, anon, authenticated;
grant select on table public.room_view to authenticated;

-- Public profile fields of the caller and of everyone who shares at least one room with the
-- caller, in any membership state. This view runs with its owner's rights instead of
-- security_invoker, because profiles are readable only by their owner and an invoker view could
-- not show anyone else's name (gap G24). security_barrier stops a caller's filter functions from
-- seeing rows before the view's own filter runs.
create view public.profile_public
with (security_barrier = true)
as
  select p.id, p.display_name, p.avatar_url
  from public.profiles p
  where p.id = auth.uid()
     or exists (
       select 1
       from public.room_members mine
       join public.room_members theirs on theirs.room_id = mine.room_id
       where mine.user_id = auth.uid()
         and theirs.user_id = p.id
     );

revoke all on table public.profile_public from public, anon, authenticated;
grant select on table public.profile_public to authenticated;
