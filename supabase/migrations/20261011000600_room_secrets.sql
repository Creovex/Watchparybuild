-- Join keys for private rooms. No client policy and no client grant: the key is read only inside
-- SECURITY DEFINER functions (`join_room`, `get_room_link`, `rotate_join_key`, `create_room`).
create table public.room_secrets (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  join_key text not null check (join_key ~ '^[A-Za-z0-9_-]{22}$')
);

alter table public.room_secrets enable row level security;
revoke all on table public.room_secrets from public, anon, authenticated;
