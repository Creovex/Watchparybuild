-- The shared playback record, one row per room, created with the room.
-- `server_ts` is the moment `position_sec` applies and may be up to 5 seconds ahead for a
-- countdown start. `paused_reason` is set exactly while the status is `paused`.
create table public.playback_state (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  seq bigint not null default 0 check (seq >= 0),
  status text not null default 'paused' check (status in ('playing', 'paused', 'ended')),
  position_sec double precision not null default 0
    check (position_sec >= 0 and position_sec < 'infinity'::double precision),
  rate double precision not null default 1 check (rate >= 0.0625 and rate <= 16),
  server_ts timestamptz not null default clock_timestamp(),
  paused_reason text check (paused_reason in ('user', 'buffer')),
  updated_by uuid references public.profiles (id) on delete set null,
  constraint playback_state_reason_only_when_paused check ((status = 'paused') = (paused_reason is not null))
);

alter table public.playback_state enable row level security;
revoke all on table public.playback_state from public, anon, authenticated;
grant select on table public.playback_state to authenticated;
