-- Extensions the schema depends on.
-- pgcrypto supplies cryptographic random bytes for room slugs and join keys, and the digest used to
-- compare join keys. Supabase keeps it in the `extensions` schema.
-- pg_cron runs the scheduled jobs. This is the install Supabase documents for its Cron module.
create extension if not exists pgcrypto with schema extensions;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
