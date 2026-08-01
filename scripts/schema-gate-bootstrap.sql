-- CI-only bootstrap for the schema gate.
--
-- The `supabase/postgres` image already ships the roles (`anon`,
-- `authenticated`, `service_role`), the `extensions` / `auth` / `storage`
-- schemas, `pgcrypto` in `extensions`, and `auth.users` / `auth.uid()`.
--
-- Three things are supplied by Supabase *services* rather than by the database
-- image, so they are provided here and here only. Nothing in this file is a
-- migration and nothing in it runs against a real environment:
--
--   * `pg_cron` / `pg_net` are installable but not preinstalled.
--   * `realtime.send` is created by the Realtime service's own migrations.
--   * `storage.buckets` ships in an older shape; the Storage service adds
--     `public`, `file_size_limit` and `allowed_mime_types`, which our
--     migrations write to.
--
-- The gate verifies that our schema builds and that every object the
-- application references exists. It does not attempt to reproduce Realtime
-- delivery or Storage enforcement.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

create schema if not exists realtime;
alter schema realtime owner to postgres;

create or replace function realtime.send(
  payload jsonb,
  event text,
  topic text,
  private boolean default true
)
returns void
language plpgsql
as $$
begin
  -- CI stub: Realtime broadcast is a service concern, not a schema concern.
  return;
end;
$$;

alter table storage.buckets
  add column if not exists public boolean not null default false,
  add column if not exists file_size_limit bigint,
  add column if not exists allowed_mime_types text[];
