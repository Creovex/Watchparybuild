-- Rooms. Clients read rooms through `room_view` (members only) and change them only through RPCs.
-- Room cap and voice mode are fixed at creation from the creating host's plan: 3 and mesh for free,
-- 10 and server for paid.
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[A-Za-z0-9_-]{10}$'),
  host_id uuid references public.profiles (id) on delete set null,
  title text not null check (char_length(title) between 1 and 80 and char_length(btrim(title)) >= 1),
  visibility text not null check (visibility in ('public', 'private')),
  source text not null check (source in ('youtube', 'netflix', 'prime', 'disney')),
  content_ref text check (content_ref is null or public.valid_content_ref(source, content_ref)),
  control_mode text not null default 'host' check (control_mode in ('host', 'everyone')),
  wait_for_everyone boolean not null default true,
  room_cap integer not null check (room_cap in (3, 10)),
  voice_mode text not null check (voice_mode in ('mesh', 'server')),
  locked boolean not null default false,
  status text not null default 'open' check (status in ('open', 'closed')),
  channel_epoch integer not null default 1 check (channel_epoch >= 1),
  created_at timestamptz not null default clock_timestamp(),
  last_active_at timestamptz not null default clock_timestamp(),
  constraint rooms_cap_matches_voice_mode check (
    (room_cap = 3 and voice_mode = 'mesh') or (room_cap = 10 and voice_mode = 'server')
  )
);

create index rooms_open_by_host on public.rooms (host_id) where status = 'open';
create index rooms_open_by_last_active on public.rooms (last_active_at) where status = 'open';

alter table public.rooms enable row level security;
revoke all on table public.rooms from public, anon, authenticated;
grant select on table public.rooms to authenticated;
