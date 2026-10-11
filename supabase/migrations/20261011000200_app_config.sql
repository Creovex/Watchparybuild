-- Settings the database needs that differ per environment. No client may read or write this table:
-- RLS (Row Level Security) is on with no policies, and the client roles hold no grants.
-- `site_url` is the address room links start with. The local stack uses the Next.js dev server;
-- the preview and production projects must update the row to their own address.
create table public.app_config (
  key text primary key,
  value text not null
);

alter table public.app_config enable row level security;
revoke all on table public.app_config from public, anon, authenticated;

insert into public.app_config (key, value) values ('site_url', 'http://localhost:3000');
