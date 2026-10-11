-- Room membership. A member is a row in state `joined`; a member is present while `last_seen_at`
-- is within the last 60 seconds. `engine_session` names the one browser context allowed to act for
-- the member; `join_room` issues a new one each time.
create table public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null check (role in ('host', 'guest')),
  state text not null check (state in ('joined', 'left', 'removed', 'banned')),
  voice_muted boolean not null default false,
  sync_mode text not null default 'auto' check (sync_mode in ('auto', 'cue')),
  buffering_since timestamptz,
  engine_session uuid not null default gen_random_uuid(),
  first_joined_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  left_at timestamptz,
  primary key (room_id, user_id)
);

create index room_members_by_user on public.room_members (user_id);

alter table public.room_members enable row level security;
revoke all on table public.room_members from public, anon, authenticated;
grant select on table public.room_members to authenticated;
