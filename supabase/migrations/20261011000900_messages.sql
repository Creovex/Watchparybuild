-- Chat, timed comments and system messages. A deleted account leaves its messages with a null
-- `user_id`, shown as "Deleted user". Deleting a message sets `deleted_at`; members never read
-- deleted messages.
-- System messages carry a `system_code` and a JSON `body` holding the data the client needs to
-- build the sentence: `{"user_id": ...}` for joined, left and host_changed; `{"user_ids": [...]}`
-- for waiting_for; `{"user_id": ..., "position_sec": ...}` for cue_ready.
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('chat', 'timed', 'system')),
  body text not null check (char_length(body) between 1 and 1000),
  system_code text check (system_code in ('waiting_for', 'cue_ready', 'joined', 'left', 'host_changed')),
  position_sec double precision
    check (position_sec is null or (position_sec >= 0 and position_sec < 'infinity'::double precision)),
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  constraint messages_system_code_only_for_system check ((kind = 'system') = (system_code is not null)),
  constraint messages_position_only_for_timed check ((kind = 'timed') = (position_sec is not null))
);

create index messages_by_room_time on public.messages (room_id, created_at);
create index messages_by_room_user_time on public.messages (room_id, user_id, created_at);
create index messages_by_user on public.messages (user_id);

alter table public.messages enable row level security;
revoke all on table public.messages from public, anon, authenticated;
grant select on table public.messages to authenticated;
