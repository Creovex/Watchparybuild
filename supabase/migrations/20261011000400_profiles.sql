-- Profiles: one row per signed in person, created by a trigger on sign up.
-- A person may change only their display name and ducking level. Column grants allow exactly those
-- two columns, and a trigger refuses a client update that changes anything else, so the rule holds
-- even if a grant is widened by mistake.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null
    check (char_length(display_name) <= 40 and char_length(btrim(display_name)) >= 1),
  avatar_url text,
  plan text not null default 'free' check (plan in ('free', 'paid')),
  duck_level real default 0.35 check (duck_level is null or (duck_level >= 0 and duck_level <= 1)),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, duck_level) on table public.profiles to authenticated;

-- Refuses a client update that touches any column other than display_name and duck_level.
-- SECURITY DEFINER functions run as their owner, so updates made inside RPCs are not affected.
create function public.profiles_guard_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon')
     and (to_jsonb(new) - 'display_name' - 'duck_level') is distinct from (to_jsonb(old) - 'display_name' - 'duck_level') then
    raise exception 'only display_name and duck_level can be changed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function public.profiles_guard_columns() from public, anon, authenticated;

create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function public.profiles_guard_columns();

-- Creates the profile when Supabase Auth creates a user. The display name comes from the Google
-- account (`full_name`, then `name`), else the part of the email before the @, trimmed and cut to
-- 40 characters; `New user` covers an account with none of these. The avatar comes from
-- `avatar_url`, else `picture`.
create function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  v_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
    'New user'
  );
  v_name := btrim(left(v_name, 40));

  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    v_name,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
      nullif(new.raw_user_meta_data ->> 'picture', '')
    )
  );
  return new;
end;
$$;

revoke execute on function public.create_profile_for_new_user() from public, anon, authenticated;

create trigger profiles_create_on_sign_up
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();
