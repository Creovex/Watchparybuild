-- Reports one member files about another. James reviews them in the Supabase dashboard (gap G19).
-- A member inserts a report directly (policy in the read access migration); nothing else is
-- writable by clients. Deleting either account keeps the report with that id set to null.
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  reporter_id uuid default auth.uid() references public.profiles (id) on delete set null,
  target_user_id uuid references public.profiles (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  reason text not null check (reason in ('spam', 'harassment', 'sexual', 'other')),
  note text check (note is null or char_length(note) <= 500),
  status text not null default 'new' check (status in ('new', 'reviewed')),
  created_at timestamptz not null default clock_timestamp()
);

create index reports_by_room on public.reports (room_id);
create index reports_by_reporter on public.reports (reporter_id);
create index reports_by_target on public.reports (target_user_id);
create index reports_by_message on public.reports (message_id);

alter table public.reports enable row level security;
revoke all on table public.reports from public, anon, authenticated;
grant select on table public.reports to authenticated;
grant insert (room_id, reporter_id, target_user_id, message_id, reason, note) on table public.reports to authenticated;
