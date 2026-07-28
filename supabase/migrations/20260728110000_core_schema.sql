create extension if not exists pgcrypto;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

create type public.game_status as enum ('draft','registration_open','ready','active','paused','finished','cancelled');
create type public.team_status as enum ('waiting','travelling','solving','finished','disqualified');
create type public.route_mode as enum ('linear','circular','free');
create type public.start_mode as enum ('scheduled','manual','rolling');
create type public.scoring_mode as enum ('completion','combined','time');
create type public.team_mode as enum ('solo','preassigned','automatic');
create type public.checkpoint_kind as enum ('text','choice','scan','location','photo','hybrid','finale');
create type public.outbox_status as enum ('pending','processing','sent','failed','cancelled');

create table public.admin_allowlist (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

create table public.organizer_invites (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.game_templates (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  brand_key text not null default 'tlv-quest',
  title jsonb not null,
  description jsonb not null default '{}'::jsonb,
  active_version integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.template_checkpoints (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.game_templates(id) on delete cascade,
  version integer not null,
  slug text not null,
  sequence_no integer not null,
  kind public.checkpoint_kind not null,
  latitude double precision,
  longitude double precision,
  radius_meters integer,
  accessibility jsonb not null default '{}'::jsonb,
  config jsonb not null,
  is_optional boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(template_id, version, slug),
  unique(template_id, version, sequence_no)
);

create table public.game_runs (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.game_templates(id),
  template_version integer not null,
  public_code text not null unique,
  organizer_token_hash text not null unique,
  status public.game_status not null default 'draft',
  route_mode public.route_mode not null default 'circular',
  start_mode public.start_mode not null default 'scheduled',
  scoring_mode public.scoring_mode not null default 'combined',
  team_mode public.team_mode not null default 'automatic',
  audience text not null default 'teens',
  locale_default text not null default 'he' check (locale_default in ('he','en')),
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  retention_until timestamptz,
  max_participants integer not null default 30 check (max_participants between 1 and 30),
  max_teams integer not null default 10 check (max_teams between 1 and 10),
  grace_minutes integer not null default 10 check (grace_minutes between 0 and 120),
  settings jsonb not null default '{}'::jsonb,
  organizer_contact_ciphertext text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.run_checkpoints (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.game_runs(id) on delete cascade,
  source_checkpoint_id uuid references public.template_checkpoints(id),
  slug text not null,
  sequence_no integer not null,
  kind public.checkpoint_kind not null,
  station_token_hash text unique,
  latitude double precision,
  longitude double precision,
  radius_meters integer,
  content jsonb not null,
  validation jsonb not null default '{}'::jsonb,
  hints jsonb not null default '[]'::jsonb,
  accessibility jsonb not null default '{}'::jsonb,
  scoring jsonb not null default '{}'::jsonb,
  prerequisites text[] not null default '{}',
  fallback_checkpoint jsonb,
  is_optional boolean not null default false,
  is_disabled boolean not null default false,
  created_at timestamptz not null default now(),
  unique(run_id, slug),
  unique(run_id, sequence_no)
);

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.game_runs(id) on delete cascade,
  public_name text not null,
  access_code_hash text not null,
  status public.team_status not null default 'waiting',
  current_checkpoint_slug text,
  score integer not null default 0,
  completed_count integer not null default 0,
  wrong_attempts integer not null default 0,
  hints_used integer not null default 0,
  started_at timestamptz,
  finished_at timestamptz,
  last_progress_at timestamptz,
  route_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(run_id, public_name)
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.game_runs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  first_name_ciphertext text not null,
  public_alias text,
  phone_ciphertext text,
  phone_hash text,
  language text not null default 'he' check (language in ('he','en')),
  personal_token_hash text not null unique,
  recovery_code_hash text not null,
  whatsapp_connected_at timestamptz,
  consent_at timestamptz not null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz,
  unique(run_id, phone_hash)
);

create table public.game_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.game_runs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  event_type text not null,
  idempotency_key text not null unique,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.game_runs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  checkpoint_id uuid not null references public.run_checkpoints(id) on delete cascade,
  submission_type text not null,
  normalized_answer text,
  payload jsonb not null default '{}'::jsonb,
  is_correct boolean,
  score_delta integer not null default 0,
  validation_reason text,
  created_at timestamptz not null default now()
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.game_runs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete set null,
  checkpoint_id uuid references public.run_checkpoints(id) on delete set null,
  storage_path text not null unique,
  mime_type text not null,
  source text not null check (source in ('web','whatsapp')),
  validation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.message_outbox (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.game_runs(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete cascade,
  channel text not null check (channel in ('whatsapp','email')),
  recipient_ciphertext text not null,
  template_key text,
  payload jsonb not null,
  status public.outbox_status not null default 'pending',
  attempts integer not null default 0,
  send_after timestamptz not null default now(),
  locked_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table public.leaderboard_entries (
  run_id uuid not null references public.game_runs(id) on delete cascade,
  run_public_code text not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  team_name text not null,
  score integer not null default 0,
  completed_count integer not null default 0,
  status public.team_status not null,
  last_progress_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (run_id, team_id)
);

create table public.anonymous_run_metrics (
  id bigint generated always as identity primary key,
  template_slug text not null,
  audience text not null,
  participant_count integer not null,
  team_count integer not null,
  finisher_count integer not null,
  duration_seconds integer,
  recorded_at timestamptz not null default now()
);

create index game_runs_status_scheduled_idx on public.game_runs(status, scheduled_at);
create index game_runs_retention_idx on public.game_runs(retention_until) where retention_until is not null;
create index game_runs_template_idx on public.game_runs(template_id);
create index teams_run_status_idx on public.teams(run_id, status);
create index participants_run_team_idx on public.participants(run_id, team_id);
create index participants_team_idx on public.participants(team_id) where team_id is not null;
create index participants_phone_hash_idx on public.participants(phone_hash) where phone_hash is not null;
create index events_run_created_idx on public.game_events(run_id, created_at desc);
create index game_events_participant_idx on public.game_events(participant_id) where participant_id is not null;
create index game_events_team_idx on public.game_events(team_id) where team_id is not null;
create index submissions_team_checkpoint_idx on public.submissions(team_id, checkpoint_id, created_at desc);
create index submissions_run_idx on public.submissions(run_id);
create index submissions_participant_idx on public.submissions(participant_id) where participant_id is not null;
create index submissions_checkpoint_idx on public.submissions(checkpoint_id);
create index outbox_pending_idx on public.message_outbox(status, send_after) where status in ('pending','failed');
create index outbox_run_idx on public.message_outbox(run_id) where run_id is not null;
create index outbox_participant_idx on public.message_outbox(participant_id) where participant_id is not null;
create index leaderboard_public_code_idx on public.leaderboard_entries(run_public_code, score desc);
create index leaderboard_team_idx on public.leaderboard_entries(team_id);
create index media_assets_run_idx on public.media_assets(run_id);
create index media_assets_team_idx on public.media_assets(team_id) where team_id is not null;
create index media_assets_participant_idx on public.media_assets(participant_id) where participant_id is not null;
create index media_assets_checkpoint_idx on public.media_assets(checkpoint_id) where checkpoint_id is not null;
create index run_checkpoints_source_idx on public.run_checkpoints(source_checkpoint_id) where source_checkpoint_id is not null;

alter table public.admin_allowlist enable row level security;
alter table public.organizer_invites enable row level security;
alter table public.game_templates enable row level security;
alter table public.template_checkpoints enable row level security;
alter table public.game_runs enable row level security;
alter table public.run_checkpoints enable row level security;
alter table public.teams enable row level security;
alter table public.participants enable row level security;
alter table public.game_events enable row level security;
alter table public.submissions enable row level security;
alter table public.media_assets enable row level security;
alter table public.message_outbox enable row level security;
alter table public.leaderboard_entries enable row level security;
alter table public.anonymous_run_metrics enable row level security;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from anon, authenticated, public;

grant usage on schema public to anon, authenticated, service_role;
grant select on public.leaderboard_entries to anon, authenticated;
create policy leaderboard_public_read
on public.leaderboard_entries
for select
to anon, authenticated
using (true);

grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('game-media', 'game-media', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'leaderboard_entries'
  ) then
    alter publication supabase_realtime add table public.leaderboard_entries;
  end if;
end
$$;
