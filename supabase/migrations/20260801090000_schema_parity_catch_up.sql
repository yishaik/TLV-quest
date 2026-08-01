-- Schema parity catch-up.
--
-- Between 2026-07-30 and 2026-07-31 the roadmap branch (#40) applied twelve
-- migrations directly to the production Supabase project. Four harvest pull
-- requests (#61, #63, #66, #67) then landed the application code that depends
-- on those objects, but the migration files themselves were never harvested.
-- `main` therefore shipped code against tables and functions that no migration
-- in this repository creates: a fresh `supabase db reset`, a preview branch or
-- a disaster-recovery restore produced a database where bulk import, recap
-- sharing, the AI epilogue, translation and route generation all fail at
-- runtime, and where `purge_expired_run_data` was the pre-#40 version that
-- cannot satisfy the production `anonymous_run_metrics` schema.
--
-- This migration reconstructs exactly what production already contains, so it
-- is a no-op there and a repair everywhere else. Every statement is written to
-- be idempotent. The object definitions below were verified column by column,
-- constraint by constraint and index by index against the live project on
-- 2026-08-01 rather than copied on trust from #40.
--
-- `marketing_leads` is the exception worth calling out: it exists in neither
-- `main` nor #40. It was created out of band and has been serving the
-- marketing lead form ever since. It is reconstructed here from the live
-- catalog.
--
-- See docs/schema-integrity.md.

begin;

-- ---------------------------------------------------------------------------
-- Tenancy foundation
-- ---------------------------------------------------------------------------

create table if not exists public.organizer_tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (length(trim(name)) between 2 and 120),
  plan text not null default 'starter'
    check (plan in ('starter','growth','enterprise')),
  monthly_run_quota integer not null default 10
    check (monthly_run_quota between 1 and 100000),
  active_run_quota integer not null default 3
    check (active_run_quota between 1 and 10000),
  participant_quota integer not null default 30
    check (participant_quota between 1 and 100000),
  storage_mb_quota integer not null default 1024
    check (storage_mb_quota between 10 and 10000000),
  branding jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The default tenant must exist before the NOT NULL DEFAULT foreign-key
-- columns below are added, or backfilling existing rows violates the FK.
insert into public.organizer_tenants (
  id, slug, name, plan,
  monthly_run_quota, active_run_quota, participant_quota, storage_mb_quota,
  branding
)
values (
  '00000000-0000-4000-8000-000000000001',
  'tlv-quest',
  'TLV Quest',
  'growth',
  100, 20, 30, 5120,
  jsonb_build_object(
    'productName', 'TLV Quest',
    'primaryColor', '#f6c35b',
    'surfaceColor', '#08131f',
    'logoUrl', '/visuals/quest-mark.svg'
  )
)
on conflict (id) do nothing;

create table if not exists public.tenant_memberships (
  tenant_id uuid not null
    references public.organizer_tenants(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null default 'organizer'
    check (role in ('owner','admin','organizer','viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, email)
);

insert into public.tenant_memberships (tenant_id, email, role)
select '00000000-0000-4000-8000-000000000001', email, 'owner'
from public.admin_allowlist
on conflict do nothing;

alter table public.game_templates
  add column if not exists tenant_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.organizer_tenants(id);

alter table public.game_runs
  add column if not exists tenant_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.organizer_tenants(id);

alter table public.organizer_invites
  add column if not exists tenant_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.organizer_tenants(id);

create index if not exists game_templates_tenant_idx
  on public.game_templates(tenant_id, updated_at desc);
create index if not exists game_runs_tenant_created_idx
  on public.game_runs(tenant_id, created_at desc);
create index if not exists organizer_invites_tenant_idx
  on public.organizer_invites(tenant_id, created_at desc);

create table if not exists public.tenant_usage_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null
    references public.organizer_tenants(id) on delete cascade,
  run_id uuid references public.game_runs(id) on delete set null,
  kind text not null
    check (kind in ('run_created','participant_joined','storage_bytes','ai_request')),
  quantity bigint not null default 1 check (quantity >= 0),
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists tenant_usage_events_summary_idx
  on public.tenant_usage_events(tenant_id, occurred_at desc, kind);
create index if not exists tenant_usage_events_run_idx
  on public.tenant_usage_events(run_id)
  where run_id is not null;

-- ---------------------------------------------------------------------------
-- Quota enforcement and usage accounting
-- ---------------------------------------------------------------------------

create or replace function private.enforce_tenant_run_quota()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_tenant public.organizer_tenants%rowtype;
  v_monthly_runs integer;
  v_active_runs integer;
begin
  select * into v_tenant
  from public.organizer_tenants
  where id = new.tenant_id
  for update;

  if not found or not v_tenant.is_active then
    raise exception 'tenant_unavailable';
  end if;

  select count(*) into v_monthly_runs
  from public.game_runs
  where tenant_id = new.tenant_id
    and created_at >= date_trunc('month', now());

  select count(*) into v_active_runs
  from public.game_runs
  where tenant_id = new.tenant_id
    and status in ('draft','registration_open','ready','active','paused');

  if v_monthly_runs >= v_tenant.monthly_run_quota then
    raise exception 'tenant_monthly_run_quota_exceeded';
  end if;
  if v_active_runs >= v_tenant.active_run_quota then
    raise exception 'tenant_active_run_quota_exceeded';
  end if;
  if new.max_participants > v_tenant.participant_quota then
    raise exception 'tenant_participant_quota_exceeded';
  end if;

  return new;
end;
$$;

create or replace function private.record_run_usage()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.tenant_usage_events (
    tenant_id, run_id, kind, idempotency_key
  )
  values (
    new.tenant_id, new.id, 'run_created', 'run-created:' || new.id::text
  )
  on conflict (idempotency_key) do nothing;
  return new;
end;
$$;

create or replace function private.record_participant_usage()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_tenant_id uuid;
begin
  select tenant_id into v_tenant_id
  from public.game_runs
  where id = new.run_id;

  insert into public.tenant_usage_events (
    tenant_id, run_id, kind, idempotency_key
  )
  values (
    v_tenant_id,
    new.run_id,
    'participant_joined',
    'participant-joined:' || new.id::text
  )
  on conflict (idempotency_key) do nothing;
  return new;
end;
$$;

drop trigger if exists enforce_tenant_run_quota on public.game_runs;
create trigger enforce_tenant_run_quota
before insert on public.game_runs
for each row execute function private.enforce_tenant_run_quota();

drop trigger if exists record_run_usage on public.game_runs;
create trigger record_run_usage
after insert on public.game_runs
for each row execute function private.record_run_usage();

drop trigger if exists record_participant_usage on public.participants;
create trigger record_participant_usage
after insert on public.participants
for each row execute function private.record_participant_usage();

-- ---------------------------------------------------------------------------
-- Advanced gameplay tables (schema only; no application code on main yet)
-- ---------------------------------------------------------------------------

create table if not exists public.adaptive_difficulty_decisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.game_runs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  checkpoint_slug text not null,
  level text not null check (level in ('challenge','standard','assisted')),
  inputs jsonb not null default '{}'::jsonb,
  policy jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(team_id, checkpoint_slug, level)
);

create index if not exists adaptive_difficulty_run_idx
  on public.adaptive_difficulty_decisions(run_id, created_at desc);

create table if not exists public.cross_team_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.game_runs(id) on delete cascade,
  title jsonb not null,
  instructions jsonb not null default '{}'::jsonb,
  team_ids uuid[] not null,
  bonus_points integer not null default 25
    check (bonus_points between 0 and 10000),
  status text not null default 'active'
    check (status in ('scheduled','active','resolved','cancelled')),
  winning_team_ids uuid[] not null default '{}',
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  resolved_at timestamptz,
  created_by text not null,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  check (cardinality(team_ids) >= 2)
);

create index if not exists cross_team_events_run_idx
  on public.cross_team_events(run_id, status, created_at desc);

create table if not exists public.generated_epilogues (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.game_runs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  locale text not null check (locale in ('he','en')),
  body text not null check (length(body) between 1 and 4000),
  provider text not null,
  model text,
  provenance jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists generated_epilogues_run_idx
  on public.generated_epilogues(run_id, team_id, created_at desc);
create index if not exists generated_epilogues_team_idx
  on public.generated_epilogues(team_id)
  where team_id is not null;

create table if not exists public.translation_suggestions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null
    references public.organizer_tenants(id) on delete cascade,
  source_locale text not null check (source_locale in ('he','en')),
  target_locale text not null check (target_locale in ('he','en')),
  source_text text not null,
  suggested_text text not null,
  provider text not null,
  model text,
  status text not null default 'pending_review'
    check (status in ('pending_review','accepted','rejected')),
  context jsonb not null default '{}'::jsonb,
  requested_by text not null,
  created_at timestamptz not null default now(),
  check (source_locale <> target_locale)
);

create index if not exists translation_suggestions_tenant_idx
  on public.translation_suggestions(tenant_id, created_at desc);

create table if not exists public.operational_anomalies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null
    references public.organizer_tenants(id) on delete cascade,
  run_id uuid references public.game_runs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  kind text not null,
  severity text not null check (severity in ('info','warning','critical')),
  status text not null default 'open'
    check (status in ('open','acknowledged','resolved')),
  fingerprint text not null unique,
  evidence jsonb not null default '{}'::jsonb,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  occurrences integer not null default 1 check (occurrences > 0),
  resolved_at timestamptz
);

create index if not exists operational_anomalies_open_idx
  on public.operational_anomalies(tenant_id, status, severity, last_detected_at desc);
create index if not exists operational_anomalies_run_idx
  on public.operational_anomalies(run_id)
  where run_id is not null;
create index if not exists operational_anomalies_team_idx
  on public.operational_anomalies(team_id)
  where team_id is not null;

create or replace function public.create_cross_team_event(
  p_run_id uuid,
  p_team_ids uuid[],
  p_title jsonb,
  p_instructions jsonb,
  p_bonus_points integer,
  p_expires_at timestamptz,
  p_actor text,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.cross_team_events%rowtype;
  v_valid_teams integer;
begin
  if trim(coalesce(p_actor, '')) = '' or trim(coalesce(p_reason, '')) = '' then
    raise exception 'actor_and_reason_required';
  end if;
  if cardinality(p_team_ids) < 2 then
    raise exception 'at_least_two_teams_required';
  end if;

  select count(distinct id) into v_valid_teams
  from public.teams
  where run_id = p_run_id and id = any(p_team_ids);
  if v_valid_teams <> cardinality(p_team_ids) then
    raise exception 'invalid_cross_team_scope';
  end if;

  insert into public.cross_team_events (
    run_id, title, instructions, team_ids,
    bonus_points, expires_at, created_by, idempotency_key
  )
  values (
    p_run_id,
    p_title,
    coalesce(p_instructions, '{}'::jsonb),
    p_team_ids,
    greatest(0, least(10000, p_bonus_points)),
    p_expires_at,
    p_actor,
    p_idempotency_key
  )
  on conflict (idempotency_key) do update
    set idempotency_key = excluded.idempotency_key
  returning * into v_event;

  insert into public.in_app_banners (
    run_id, team_id, body, active_until, idempotency_key
  )
  select
    p_run_id,
    team_id,
    jsonb_build_object(
      'he',
      coalesce(p_title->>'he', 'אתגר קבוצות חדש') || E'\n' ||
        coalesce(p_instructions->>'he', ''),
      'en',
      coalesce(p_title->>'en', 'New team challenge') || E'\n' ||
        coalesce(p_instructions->>'en', '')
    ),
    coalesce(p_expires_at, now() + interval '1 hour'),
    p_idempotency_key || ':banner:' || team_id::text
  from unnest(p_team_ids) as team_id
  on conflict (idempotency_key) do nothing;

  insert into public.game_events (
    run_id, event_type, idempotency_key, payload
  )
  values (
    p_run_id,
    'CROSS_TEAM_EVENT_CREATED',
    p_idempotency_key || ':event',
    jsonb_build_object(
      'cross_team_event_id', v_event.id,
      'team_ids', p_team_ids,
      'bonus_points', v_event.bonus_points
    )
  )
  on conflict (idempotency_key) do nothing;

  insert into public.organizer_audit_log (
    run_id, action, actor, reason, before_state, after_state, idempotency_key
  )
  values (
    p_run_id,
    'create_cross_team_event',
    p_actor,
    p_reason,
    '{}'::jsonb,
    to_jsonb(v_event),
    p_idempotency_key || ':audit'
  )
  on conflict (idempotency_key) do nothing;

  return to_jsonb(v_event);
end;
$$;

create or replace function public.resolve_cross_team_event(
  p_event_id uuid,
  p_winning_team_ids uuid[],
  p_actor text,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.cross_team_events%rowtype;
  v_winner uuid;
begin
  select * into v_event
  from public.cross_team_events
  where id = p_event_id
  for update;
  if not found then raise exception 'cross_team_event_not_found'; end if;
  if trim(coalesce(p_actor, '')) = '' or trim(coalesce(p_reason, '')) = '' then
    raise exception 'actor_and_reason_required';
  end if;
  if v_event.status = 'resolved' then
    return to_jsonb(v_event);
  end if;
  if exists (
    select 1 from unnest(p_winning_team_ids) winner
    where not (winner = any(v_event.team_ids))
  ) then
    raise exception 'winner_outside_event_scope';
  end if;

  update public.cross_team_events
  set
    status = 'resolved',
    winning_team_ids = coalesce(p_winning_team_ids, '{}'),
    resolved_at = now()
  where id = p_event_id
  returning * into v_event;

  foreach v_winner in array coalesce(p_winning_team_ids, '{}') loop
    update public.teams
    set score = score + v_event.bonus_points
    where id = v_winner and run_id = v_event.run_id;

    insert into public.game_events (
      run_id, team_id, event_type, idempotency_key, payload
    )
    values (
      v_event.run_id,
      v_winner,
      'CROSS_TEAM_BONUS_AWARDED',
      p_idempotency_key || ':winner:' || v_winner::text,
      jsonb_build_object(
        'cross_team_event_id', v_event.id,
        'bonus_points', v_event.bonus_points
      )
    )
    on conflict (idempotency_key) do nothing;
  end loop;

  insert into public.organizer_audit_log (
    run_id, action, actor, reason, before_state, after_state, idempotency_key
  )
  values (
    v_event.run_id,
    'resolve_cross_team_event',
    p_actor,
    p_reason,
    '{}'::jsonb,
    to_jsonb(v_event),
    p_idempotency_key || ':audit'
  )
  on conflict (idempotency_key) do nothing;

  return to_jsonb(v_event);
end;
$$;

-- ---------------------------------------------------------------------------
-- Content bulk import (CNT-04) — powers the imports route harvested in #63
-- ---------------------------------------------------------------------------

create table if not exists public.content_import_batches (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  version integer not null,
  idempotency_key text not null unique,
  payload_hash text not null,
  actor text not null,
  format text not null check (format in ('csv', 'json')),
  status text not null default 'applied'
    check (status in ('applied', 'rolled_back')),
  row_count integer not null check (row_count > 0),
  prior_route_stops jsonb not null default '[]'::jsonb,
  created_station_ids uuid[] not null default '{}',
  created_riddle_ids uuid[] not null default '{}',
  created_stop_ids uuid[] not null default '{}',
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  rolled_back_by text,
  foreign key (template_id, version)
    references public.template_versions(template_id, version)
);

create index if not exists content_import_batches_version_idx
  on public.content_import_batches(template_id, version, created_at desc);

create or replace function public.content_bulk_import(
  p_template_id uuid,
  p_version integer,
  p_rows jsonb,
  p_actor text,
  p_idempotency_key text,
  p_format text,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_batch public.content_import_batches%rowtype;
  v_item jsonb;
  v_ordinal bigint;
  v_count integer;
  v_payload_hash text;
  v_errors jsonb := '[]'::jsonb;
  v_prior_stops jsonb;
  v_station_id uuid;
  v_riddle_id uuid;
  v_stop_id uuid;
  v_station_ids uuid[] := '{}';
  v_riddle_ids uuid[] := '{}';
  v_stop_ids uuid[] := '{}';
  v_summary jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'import_rows_must_be_array';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 500 then
    raise exception 'import_row_count_invalid';
  end if;
  if p_format not in ('csv', 'json') then
    raise exception 'import_format_invalid';
  end if;
  if char_length(trim(coalesce(p_actor, ''))) < 3 then
    raise exception 'import_actor_required';
  end if;
  if char_length(trim(coalesce(p_idempotency_key, ''))) < 8 then
    raise exception 'import_idempotency_key_required';
  end if;

  perform public.content_assert_editable_version(p_template_id, p_version);
  v_payload_hash := encode(
    extensions.digest(convert_to(p_rows::text, 'UTF8'), 'sha256'),
    'hex'
  );

  if not p_dry_run then
    select * into v_batch
    from public.content_import_batches
    where idempotency_key = p_idempotency_key;
    if found then
      if v_batch.payload_hash <> v_payload_hash then
        raise exception 'import_idempotency_payload_mismatch';
      end if;
      return v_batch.summary || jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'batchId', v_batch.id,
        'status', v_batch.status
      );
    end if;
  end if;

  for v_item, v_ordinal in
    select value, ordinality
    from jsonb_array_elements(p_rows) with ordinality
  loop
    if exists (
      select 1
      from public.content_stations
      where slug = v_item -> 'station' ->> 'slug'
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_ordinal,
        'field', 'station.slug',
        'code', 'station_slug_exists',
        'message', 'A station with this slug already exists.'
      ));
    end if;
  end loop;

  if (
    select count(*) <> count(distinct value -> 'station' ->> 'slug')
    from jsonb_array_elements(p_rows)
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'row', null,
      'field', 'station.slug',
      'code', 'duplicate_station_slug',
      'message', 'Station slugs must be unique within one import.'
    ));
  end if;
  if (
    select count(*) <> count(distinct value -> 'stop' ->> 'slug')
    from jsonb_array_elements(p_rows)
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'row', null,
      'field', 'stop.slug',
      'code', 'duplicate_stop_slug',
      'message', 'Route stop slugs must be unique within one import.'
    ));
  end if;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object(
      'ok', false,
      'dryRun', p_dry_run,
      'rowCount', v_count,
      'errors', v_errors
    );
  end if;

  v_summary := jsonb_build_object(
    'ok', true,
    'dryRun', p_dry_run,
    'duplicate', false,
    'rowCount', v_count,
    'stationsCreated', v_count,
    'riddlesCreated', v_count,
    'stopsCreated', v_count,
    'errors', '[]'::jsonb
  );
  if p_dry_run then
    return v_summary;
  end if;

  select coalesce(jsonb_agg(to_jsonb(stop) order by stop.sequence_no), '[]'::jsonb)
    into v_prior_stops
  from public.content_route_stops stop
  where stop.template_id = p_template_id
    and stop.version = p_version;

  delete from public.content_route_stops
  where template_id = p_template_id
    and version = p_version;

  for v_item, v_ordinal in
    select value, ordinality
    from jsonb_array_elements(p_rows) with ordinality
  loop
    insert into public.content_stations(
      slug, brand_key, title, description, address,
      latitude, longitude, radius_meters, tags, accessibility,
      field_verification_required, health_status, status,
      created_by, updated_by
    ) values (
      v_item -> 'station' ->> 'slug',
      coalesce(v_item -> 'station' ->> 'brandKey', 'tlv-quest'),
      coalesce(v_item -> 'station' -> 'title', '{"he":"","en":""}'::jsonb),
      coalesce(v_item -> 'station' -> 'description', '{"he":"","en":""}'::jsonb),
      coalesce(v_item -> 'station' -> 'address', '{}'::jsonb),
      nullif(v_item -> 'station' ->> 'latitude', '')::double precision,
      nullif(v_item -> 'station' ->> 'longitude', '')::double precision,
      nullif(v_item -> 'station' ->> 'radiusMeters', '')::integer,
      array(
        select jsonb_array_elements_text(
          coalesce(v_item -> 'station' -> 'tags', '[]'::jsonb)
        )
      ),
      coalesce(v_item -> 'station' -> 'accessibility', '{}'::jsonb),
      coalesce(
        (v_item -> 'station' ->> 'fieldVerificationRequired')::boolean,
        false
      ),
      case
        when coalesce(
          (v_item -> 'station' ->> 'fieldVerificationRequired')::boolean,
          false
        ) then 'pending'
        else 'not_required'
      end,
      coalesce(v_item -> 'station' ->> 'status', 'draft'),
      p_actor,
      p_actor
    )
    returning id into v_station_id;
    v_station_ids := array_append(v_station_ids, v_station_id);

    insert into public.content_riddles(
      station_id, slug, title, kind, content, validation, hints,
      scoring, fallback, interaction, tags, status, created_by, updated_by
    ) values (
      v_station_id,
      v_item -> 'riddle' ->> 'slug',
      coalesce(v_item -> 'riddle' -> 'title', '{"he":"","en":""}'::jsonb),
      (v_item -> 'riddle' ->> 'kind')::public.checkpoint_kind,
      coalesce(v_item -> 'riddle' -> 'content', '{"he":{},"en":{}}'::jsonb),
      coalesce(v_item -> 'riddle' -> 'validation', '{}'::jsonb),
      coalesce(v_item -> 'riddle' -> 'hints', '[]'::jsonb),
      coalesce(v_item -> 'riddle' -> 'scoring', '{}'::jsonb),
      nullif(v_item -> 'riddle' -> 'fallback', 'null'::jsonb),
      coalesce(v_item -> 'riddle' -> 'interaction', '{}'::jsonb),
      array(
        select jsonb_array_elements_text(
          coalesce(v_item -> 'riddle' -> 'tags', '[]'::jsonb)
        )
      ),
      coalesce(v_item -> 'riddle' ->> 'status', 'draft'),
      p_actor,
      p_actor
    )
    returning id into v_riddle_id;
    v_riddle_ids := array_append(v_riddle_ids, v_riddle_id);

    insert into public.content_route_stops(
      template_id, version, station_id, riddle_id, slug,
      sequence_no, is_optional, is_active, overrides, created_by, updated_by
    ) values (
      p_template_id,
      p_version,
      v_station_id,
      v_riddle_id,
      v_item -> 'stop' ->> 'slug',
      v_ordinal::integer,
      coalesce((v_item -> 'stop' ->> 'isOptional')::boolean, false),
      coalesce((v_item -> 'stop' ->> 'isActive')::boolean, true),
      coalesce(v_item -> 'stop' -> 'overrides', '{}'::jsonb),
      p_actor,
      p_actor
    )
    returning id into v_stop_id;
    v_stop_ids := array_append(v_stop_ids, v_stop_id);
  end loop;

  perform public.content_compile_route_version(
    p_template_id, p_version, p_actor
  );

  insert into public.content_import_batches(
    template_id, version, idempotency_key, payload_hash, actor, format,
    row_count, prior_route_stops, created_station_ids, created_riddle_ids,
    created_stop_ids, summary
  ) values (
    p_template_id, p_version, p_idempotency_key, v_payload_hash, p_actor,
    p_format, v_count, v_prior_stops, v_station_ids, v_riddle_ids,
    v_stop_ids, v_summary
  )
  returning * into v_batch;

  insert into public.content_audit_log(
    template_id, version, actor_email, action, payload
  ) values (
    p_template_id,
    p_version,
    p_actor,
    'BULK_IMPORT_APPLIED',
    jsonb_build_object(
      'batchId', v_batch.id,
      'format', p_format,
      'rowCount', v_count
    )
  );

  return v_summary || jsonb_build_object(
    'batchId', v_batch.id,
    'status', v_batch.status
  );
end;
$$;

create or replace function public.content_rollback_import(
  p_batch_id uuid,
  p_actor text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_batch public.content_import_batches%rowtype;
  v_current_count integer;
begin
  select * into v_batch
  from public.content_import_batches
  where id = p_batch_id
  for update;
  if not found then raise exception 'import_batch_not_found'; end if;
  if v_batch.status = 'rolled_back' then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'batchId', v_batch.id,
      'status', v_batch.status
    );
  end if;

  perform public.content_assert_editable_version(
    v_batch.template_id, v_batch.version
  );
  select count(*) into v_current_count
  from public.content_route_stops
  where template_id = v_batch.template_id
    and version = v_batch.version
    and id = any(v_batch.created_stop_ids);
  if v_current_count <> cardinality(v_batch.created_stop_ids)
     or exists (
       select 1
       from public.content_route_stops
       where template_id = v_batch.template_id
         and version = v_batch.version
         and not (id = any(v_batch.created_stop_ids))
     ) then
    raise exception 'import_has_later_route_changes';
  end if;

  delete from public.content_route_stops
  where template_id = v_batch.template_id
    and version = v_batch.version;

  insert into public.content_route_stops
  select *
  from jsonb_populate_recordset(
    null::public.content_route_stops,
    v_batch.prior_route_stops
  );

  delete from public.content_riddles
  where id = any(v_batch.created_riddle_ids);
  delete from public.content_stations
  where id = any(v_batch.created_station_ids);

  perform public.content_compile_route_version(
    v_batch.template_id, v_batch.version, p_actor
  );

  update public.content_import_batches
  set status = 'rolled_back',
      rolled_back_at = now(),
      rolled_back_by = left(p_actor, 320)
  where id = v_batch.id;

  insert into public.content_audit_log(
    template_id, version, actor_email, action, payload
  ) values (
    v_batch.template_id,
    v_batch.version,
    p_actor,
    'BULK_IMPORT_ROLLED_BACK',
    jsonb_build_object('batchId', v_batch.id)
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'batchId', v_batch.id,
    'status', 'rolled_back',
    'restoredStopCount', jsonb_array_length(v_batch.prior_route_stops)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Shareable recap (GROW-01) — powers /api/recap/{token} harvested in #67
-- ---------------------------------------------------------------------------

create table if not exists public.recap_shares (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.game_runs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  token_hash text not null unique,
  idempotency_key text not null unique,
  active_until timestamptz not null,
  revoked_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists recap_shares_run_created_idx
  on public.recap_shares(run_id, created_at desc);
create index if not exists recap_shares_active_idx
  on public.recap_shares(token_hash, active_until)
  where revoked_at is null;
create index if not exists recap_shares_team_idx
  on public.recap_shares(team_id)
  where team_id is not null;

create or replace function public.create_recap_share(
  p_run_id uuid,
  p_team_id uuid,
  p_actor text,
  p_reason text,
  p_idempotency_key text,
  p_active_hours integer default 72
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_share public.recap_shares%rowtype;
  v_active_until timestamptz;
begin
  if char_length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'override_reason_required';
  end if;
  if not exists (
    select 1 from public.game_runs where id = p_run_id
  ) then
    raise exception 'run_not_found';
  end if;
  if p_team_id is not null and not exists (
    select 1 from public.teams
    where id = p_team_id and run_id = p_run_id
  ) then
    raise exception 'team_not_found';
  end if;

  select * into v_share
  from public.recap_shares
  where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'duplicate', true,
      'shareId', v_share.id,
      'teamId', v_share.team_id,
      'activeUntil', v_share.active_until
    );
  end if;

  v_active_until := least(
    now() + make_interval(hours => greatest(1, least(p_active_hours, 168))),
    coalesce(
      (select retention_until from public.game_runs where id = p_run_id),
      now() + interval '72 hours'
    )
  );
  if v_active_until <= now() then
    raise exception 'recap_retention_expired';
  end if;

  insert into public.recap_shares(
    run_id, team_id, token_hash, idempotency_key, active_until, created_by
  ) values (
    p_run_id,
    p_team_id,
    encode(
      extensions.digest(convert_to(p_idempotency_key, 'UTF8'), 'sha256'),
      'hex'
    ),
    p_idempotency_key,
    v_active_until,
    left(p_actor, 120)
  )
  returning * into v_share;

  insert into public.organizer_audit_log(
    run_id, action, actor, reason, idempotency_key, before_state, after_state
  ) values (
    p_run_id,
    'create_recap_share',
    left(p_actor, 120),
    left(trim(p_reason), 500),
    p_idempotency_key,
    '{}'::jsonb,
    jsonb_build_object(
      'shareId', v_share.id,
      'teamId', v_share.team_id,
      'activeUntil', v_share.active_until
    )
  );

  insert into public.game_events(
    run_id, team_id, event_type, idempotency_key, payload
  ) values (
    p_run_id,
    p_team_id,
    'RECAP_SHARE_CREATED',
    p_idempotency_key,
    jsonb_build_object(
      'share_id', v_share.id,
      'active_until', v_share.active_until
    )
  );

  return jsonb_build_object(
    'duplicate', false,
    'shareId', v_share.id,
    'teamId', v_share.team_id,
    'activeUntil', v_share.active_until
  );
end;
$$;

create or replace function public.revoke_recap_share(
  p_run_id uuid,
  p_share_id uuid,
  p_actor text,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_share public.recap_shares%rowtype;
begin
  if char_length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'override_reason_required';
  end if;
  if exists (
    select 1 from public.organizer_audit_log
    where idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('duplicate', true, 'shareId', p_share_id);
  end if;

  select * into v_share
  from public.recap_shares
  where id = p_share_id and run_id = p_run_id
  for update;
  if not found then raise exception 'recap_share_not_found'; end if;

  update public.recap_shares
  set revoked_at = coalesce(revoked_at, now())
  where id = v_share.id
  returning * into v_share;

  insert into public.organizer_audit_log(
    run_id, action, actor, reason, idempotency_key, before_state, after_state
  ) values (
    p_run_id,
    'revoke_recap_share',
    left(p_actor, 120),
    left(trim(p_reason), 500),
    p_idempotency_key,
    jsonb_build_object('shareId', v_share.id, 'revoked', false),
    jsonb_build_object(
      'shareId', v_share.id,
      'revoked', true,
      'revokedAt', v_share.revoked_at
    )
  );

  insert into public.game_events(
    run_id, team_id, event_type, idempotency_key, payload
  ) values (
    p_run_id,
    v_share.team_id,
    'RECAP_SHARE_REVOKED',
    p_idempotency_key,
    jsonb_build_object('share_id', v_share.id)
  );

  return jsonb_build_object(
    'duplicate', false,
    'shareId', v_share.id,
    'revokedAt', v_share.revoked_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- AI route generation drafts (SCALE-02) — draft-only by construction
-- ---------------------------------------------------------------------------

create table if not exists public.route_generation_drafts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null
    references public.organizer_tenants(id) on delete cascade,
  template_id uuid references public.game_templates(id) on delete set null,
  requested_by text not null,
  request jsonb not null,
  proposed_route jsonb not null,
  provenance jsonb not null,
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  verification_requirements jsonb not null default '[]'::jsonb,
  status text not null default 'draft'
    check (status in ('draft','accepted_for_editing','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  check (proposed_route->>'publicationState' = 'draft')
);

create index if not exists route_generation_drafts_tenant_idx
  on public.route_generation_drafts(tenant_id, created_at desc);
create index if not exists route_generation_drafts_template_idx
  on public.route_generation_drafts(template_id, created_at desc)
  where template_id is not null;

-- ---------------------------------------------------------------------------
-- Maintenance worker observability (SEC-08)
-- ---------------------------------------------------------------------------

create table if not exists public.maintenance_runs (
  id uuid primary key default gen_random_uuid(),
  correlation_id text not null unique,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed')),
  attempt integer not null default 1 check (attempt between 1 and 100),
  stages jsonb not null default '{}'::jsonb,
  error_summary text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists maintenance_runs_status_started_idx
  on public.maintenance_runs(status, started_at desc);

-- ---------------------------------------------------------------------------
-- Product metrics (SEC-10)
-- ---------------------------------------------------------------------------

alter table public.anonymous_run_metrics
  add column if not exists metric_key text,
  add column if not exists completion_rate numeric(6,5),
  add column if not exists checkpoint_funnel jsonb not null default '{}'::jsonb,
  add column if not exists hint_count integer not null default 0,
  add column if not exists failure_count integer not null default 0,
  add column if not exists message_failure_count integer not null default 0;

update public.anonymous_run_metrics
set metric_key = encode(
  extensions.digest(
    concat_ws(':', id::text, template_slug, recorded_at::text),
    'sha256'
  ),
  'hex'
)
where metric_key is null;

alter table public.anonymous_run_metrics
  alter column metric_key set not null;

create unique index if not exists anonymous_run_metrics_metric_key_idx
  on public.anonymous_run_metrics(metric_key);

alter table public.game_runs
  add column if not exists metrics_recorded_at timestamptz;

grant usage on schema private to service_role;

create or replace function private.upsert_anonymous_run_metric(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  v_run public.game_runs%rowtype;
  v_template_slug text;
  v_participant_count integer;
  v_team_count integer;
  v_finisher_count integer;
  v_hint_count integer;
  v_failure_count integer;
  v_message_failure_count integer;
  v_checkpoint_funnel jsonb;
  v_metric_key text;
begin
  select * into v_run
  from public.game_runs
  where id = p_run_id
    and status in ('finished', 'cancelled');
  if not found then return; end if;

  select slug into v_template_slug
  from public.game_templates
  where id = v_run.template_id;

  select count(*) into v_participant_count
  from public.participants
  where run_id = p_run_id;

  select
    count(*),
    count(*) filter (where status = 'finished')
  into v_team_count, v_finisher_count
  from public.teams
  where run_id = p_run_id;

  select
    count(*) filter (where event_type = 'HINT_REQUESTED'),
    count(*) filter (
      where event_type in ('ANSWER_REJECTED', 'PHOTO_REJECTED')
    )
  into v_hint_count, v_failure_count
  from public.game_events
  where run_id = p_run_id;

  select count(*) into v_message_failure_count
  from public.message_outbox
  where run_id = p_run_id
    and status = 'failed';

  select coalesce(
    jsonb_object_agg(
      checkpoint.slug,
      jsonb_build_object(
        'sequence', checkpoint.sequence_no,
        'completedTeams', coalesce(completion.completed_teams, 0),
        'dropOffTeams', coalesce(dropoff.drop_off_teams, 0)
      )
      order by checkpoint.sequence_no
    ),
    '{}'::jsonb
  )
  into v_checkpoint_funnel
  from public.run_checkpoints checkpoint
  left join lateral (
    select count(distinct event.team_id)::integer as completed_teams
    from public.game_events event
    where event.run_id = p_run_id
      and event.event_type = 'ANSWER_ACCEPTED'
      and event.payload ->> 'checkpoint_slug' = checkpoint.slug
  ) completion on true
  left join lateral (
    select count(*)::integer as drop_off_teams
    from public.teams team_row
    where team_row.run_id = p_run_id
      and team_row.status <> 'finished'
      and team_row.current_checkpoint_slug = checkpoint.slug
  ) dropoff on true
  where checkpoint.run_id = p_run_id
    and checkpoint.is_disabled = false;

  v_metric_key := encode(extensions.digest(p_run_id::text, 'sha256'), 'hex');

  insert into public.anonymous_run_metrics(
    metric_key, template_slug, audience, participant_count, team_count,
    finisher_count, completion_rate, duration_seconds, checkpoint_funnel,
    hint_count, failure_count, message_failure_count, recorded_at
  ) values (
    v_metric_key,
    coalesce(v_template_slug, 'unknown'),
    v_run.audience,
    v_participant_count,
    v_team_count,
    v_finisher_count,
    case
      when v_team_count = 0 then 0
      else v_finisher_count::numeric / v_team_count::numeric
    end,
    case
      when v_run.started_at is not null and v_run.finished_at is not null
        then extract(epoch from v_run.finished_at - v_run.started_at)::integer
      else null
    end,
    v_checkpoint_funnel,
    v_hint_count,
    v_failure_count,
    v_message_failure_count,
    now()
  )
  on conflict (metric_key) do update
  set template_slug = excluded.template_slug,
      audience = excluded.audience,
      participant_count = excluded.participant_count,
      team_count = excluded.team_count,
      finisher_count = excluded.finisher_count,
      completion_rate = excluded.completion_rate,
      duration_seconds = excluded.duration_seconds,
      checkpoint_funnel = excluded.checkpoint_funnel,
      hint_count = excluded.hint_count,
      failure_count = excluded.failure_count,
      message_failure_count = excluded.message_failure_count,
      recorded_at = now();

  update public.game_runs
  set metrics_recorded_at = now()
  where id = p_run_id;
end;
$$;

create or replace function public.record_completed_run_metrics(
  batch_size integer default 25
)
returns integer
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  v_run record;
  v_recorded integer := 0;
begin
  for v_run in
    select id
    from public.game_runs
    where status in ('finished', 'cancelled')
      and (
        metrics_recorded_at is null
        or metrics_recorded_at < updated_at
      )
    order by coalesce(finished_at, updated_at)
    limit greatest(1, least(batch_size, 100))
    for update skip locked
  loop
    perform private.upsert_anonymous_run_metric(v_run.id);
    v_recorded := v_recorded + 1;
  end loop;

  return v_recorded;
end;
$$;

-- The pre-#40 body inserted into `anonymous_run_metrics` without `metric_key`,
-- which is now NOT NULL. Rebuilding from `main` alone therefore produced a
-- retention purge that fails on its first expired run.
create or replace function public.purge_expired_run_data()
returns integer
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
declare
  expired_run record;
  deleted_count integer := 0;
begin
  for expired_run in
    select r.id
    from public.game_runs r
    where r.retention_until is not null
      and r.retention_until <= now()
      and r.status in ('finished','cancelled')
    for update of r skip locked
  loop
    perform private.upsert_anonymous_run_metric(expired_run.id);
    delete from public.game_runs where id = expired_run.id;
    deleted_count := deleted_count + 1;
  end loop;
  return deleted_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Rate limit bucket constraint parity
-- ---------------------------------------------------------------------------
--
-- #40 created `rate_limit_buckets` with `check (request_count >= 0)` and
-- reached production first. `20260730170000_rate_limits_and_answer_cooldown`
-- then re-declared the table with `check (request_count > 0)`, but its
-- `create table if not exists` was a no-op against the already-created table.
-- Production therefore runs `>= 0` while a build from this repository alone
-- produced `> 0` — the one remaining constraint difference between the two.
--
-- The divergence is not load-bearing: `consume_rate_limit` is the only writer
-- and it only ever stores 1 or `request_count + 1`, so no row can reach 0
-- under either rule. Production is the source of truth here, so the repository
-- is aligned to it rather than the live table being rewritten.
--
-- The rewrite is guarded so that it is a genuine no-op on production: this is
-- a hot table and an unconditional drop/add would take an ACCESS EXCLUSIVE
-- lock on every deploy for no reason.

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.rate_limit_buckets'::regclass
      and conname = 'rate_limit_buckets_request_count_check'
      and pg_get_constraintdef(oid) <> 'CHECK ((request_count >= 0))'
  ) then
    alter table public.rate_limit_buckets
      drop constraint rate_limit_buckets_request_count_check;
    alter table public.rate_limit_buckets
      add constraint rate_limit_buckets_request_count_check
      check (request_count >= 0);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Marketing leads — the ghost table behind /api/leads
-- ---------------------------------------------------------------------------

create table if not exists public.marketing_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (char_length(name) between 2 and 120),
  email text not null check (char_length(email) <= 254),
  phone text,
  event_type text,
  estimated_participants integer
    check (estimated_participants between 1 and 500),
  preferred_date date,
  message text,
  locale text not null default 'he' check (locale in ('he','en')),
  source text not null default 'website',
  status text not null default 'new'
    check (status in ('new','contacted','qualified','closed'))
);

create index if not exists marketing_leads_created_at_idx
  on public.marketing_leads(created_at desc);
create index if not exists marketing_leads_status_idx
  on public.marketing_leads(status, created_at desc);

-- ---------------------------------------------------------------------------
-- Access posture: deny browser roles by default, service_role only (SEC-01)
-- ---------------------------------------------------------------------------

alter table public.organizer_tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.tenant_usage_events enable row level security;
alter table public.adaptive_difficulty_decisions enable row level security;
alter table public.cross_team_events enable row level security;
alter table public.generated_epilogues enable row level security;
alter table public.translation_suggestions enable row level security;
alter table public.operational_anomalies enable row level security;
alter table public.content_import_batches enable row level security;
alter table public.recap_shares enable row level security;
alter table public.route_generation_drafts enable row level security;
alter table public.maintenance_runs enable row level security;
alter table public.marketing_leads enable row level security;

revoke all on table public.organizer_tenants from public, anon, authenticated;
revoke all on table public.tenant_memberships from public, anon, authenticated;
revoke all on table public.tenant_usage_events from public, anon, authenticated;
revoke all on table public.adaptive_difficulty_decisions from public, anon, authenticated;
revoke all on table public.cross_team_events from public, anon, authenticated;
revoke all on table public.generated_epilogues from public, anon, authenticated;
revoke all on table public.translation_suggestions from public, anon, authenticated;
revoke all on table public.operational_anomalies from public, anon, authenticated;
revoke all on table public.content_import_batches from public, anon, authenticated;
revoke all on table public.recap_shares from public, anon, authenticated;
revoke all on table public.route_generation_drafts from public, anon, authenticated;
revoke all on table public.maintenance_runs from public, anon, authenticated;
revoke all on table public.marketing_leads from public, anon, authenticated;

grant all on table public.organizer_tenants to service_role;
grant all on table public.tenant_memberships to service_role;
grant all on table public.tenant_usage_events to service_role;
grant all on table public.adaptive_difficulty_decisions to service_role;
grant all on table public.cross_team_events to service_role;
grant all on table public.generated_epilogues to service_role;
grant all on table public.translation_suggestions to service_role;
grant all on table public.operational_anomalies to service_role;
grant select, insert, update on table public.content_import_batches to service_role;
grant all on table public.recap_shares to service_role;
grant all on table public.route_generation_drafts to service_role;
grant all on table public.maintenance_runs to service_role;
grant all on table public.marketing_leads to service_role;

grant usage, select on sequence public.tenant_usage_events_id_seq to service_role;

revoke all on function public.content_bulk_import(
  uuid, integer, jsonb, text, text, text, boolean
) from public, anon, authenticated;
revoke all on function public.content_rollback_import(uuid, text)
  from public, anon, authenticated;
revoke all on function public.create_recap_share(
  uuid, uuid, text, text, text, integer
) from public, anon, authenticated;
revoke all on function public.revoke_recap_share(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.create_cross_team_event(
  uuid, uuid[], jsonb, jsonb, integer, timestamptz, text, text, text
) from public, anon, authenticated;
revoke all on function public.resolve_cross_team_event(
  uuid, uuid[], text, text, text
) from public, anon, authenticated;
revoke all on function public.record_completed_run_metrics(integer)
  from public, anon, authenticated;
revoke all on function public.purge_expired_run_data()
  from public, anon, authenticated;
revoke all on function private.upsert_anonymous_run_metric(uuid)
  from public, anon, authenticated;

grant execute on function public.content_bulk_import(
  uuid, integer, jsonb, text, text, text, boolean
) to service_role;
grant execute on function public.content_rollback_import(uuid, text)
  to service_role;
grant execute on function public.create_recap_share(
  uuid, uuid, text, text, text, integer
) to service_role;
grant execute on function public.revoke_recap_share(uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.create_cross_team_event(
  uuid, uuid[], jsonb, jsonb, integer, timestamptz, text, text, text
) to service_role;
grant execute on function public.resolve_cross_team_event(
  uuid, uuid[], text, text, text
) to service_role;
grant execute on function public.record_completed_run_metrics(integer)
  to service_role;
grant execute on function public.purge_expired_run_data()
  to service_role;
grant execute on function private.upsert_anonymous_run_metric(uuid)
  to service_role;

commit;
