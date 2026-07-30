begin;

create table public.organizer_tenants (
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

insert into public.organizer_tenants (
  id,
  slug,
  name,
  plan,
  monthly_run_quota,
  active_run_quota,
  participant_quota,
  storage_mb_quota,
  branding
)
values (
  '00000000-0000-4000-8000-000000000001',
  'tlv-quest',
  'TLV Quest',
  'growth',
  100,
  20,
  30,
  5120,
  jsonb_build_object(
    'productName', 'TLV Quest',
    'primaryColor', '#f6c35b',
    'surfaceColor', '#08131f',
    'logoUrl', '/visuals/quest-mark.svg'
  )
)
on conflict (id) do nothing;

create table public.tenant_memberships (
  tenant_id uuid not null references public.organizer_tenants(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null default 'organizer'
    check (role in ('owner','admin','organizer','viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, email)
);

insert into public.tenant_memberships (tenant_id, email, role)
select
  '00000000-0000-4000-8000-000000000001',
  email,
  'owner'
from public.admin_allowlist
on conflict do nothing;

alter table public.game_templates
  add column tenant_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.organizer_tenants(id);

alter table public.game_runs
  add column tenant_id uuid not null
    default '00000000-0000-4000-8000-000000000001'
    references public.organizer_tenants(id);

create index game_templates_tenant_idx
  on public.game_templates(tenant_id, updated_at desc);
create index game_runs_tenant_created_idx
  on public.game_runs(tenant_id, created_at desc);

create table public.tenant_usage_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.organizer_tenants(id) on delete cascade,
  run_id uuid references public.game_runs(id) on delete set null,
  kind text not null
    check (kind in ('run_created','participant_joined','storage_bytes','ai_request')),
  quantity bigint not null default 1 check (quantity >= 0),
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index tenant_usage_events_summary_idx
  on public.tenant_usage_events(tenant_id, occurred_at desc, kind);

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

create trigger enforce_tenant_run_quota
before insert on public.game_runs
for each row execute function private.enforce_tenant_run_quota();

create or replace function private.record_run_usage()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.tenant_usage_events (
    tenant_id,
    run_id,
    kind,
    idempotency_key
  )
  values (
    new.tenant_id,
    new.id,
    'run_created',
    'run-created:' || new.id::text
  )
  on conflict (idempotency_key) do nothing;
  return new;
end;
$$;

create trigger record_run_usage
after insert on public.game_runs
for each row execute function private.record_run_usage();

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
    tenant_id,
    run_id,
    kind,
    idempotency_key
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

create trigger record_participant_usage
after insert on public.participants
for each row execute function private.record_participant_usage();

create table public.adaptive_difficulty_decisions (
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

create index adaptive_difficulty_run_idx
  on public.adaptive_difficulty_decisions(run_id, created_at desc);

create table public.cross_team_events (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.game_runs(id) on delete cascade,
  title jsonb not null,
  instructions jsonb not null default '{}'::jsonb,
  team_ids uuid[] not null,
  bonus_points integer not null default 25 check (bonus_points between 0 and 10000),
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

create index cross_team_events_run_idx
  on public.cross_team_events(run_id, status, created_at desc);

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
    run_id,
    title,
    instructions,
    team_ids,
    bonus_points,
    expires_at,
    created_by,
    idempotency_key
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
    run_id,
    team_id,
    body,
    active_until,
    idempotency_key
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
    run_id,
    event_type,
    idempotency_key,
    payload
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
    run_id,
    action,
    actor,
    reason,
    before_state,
    after_state,
    idempotency_key
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
      run_id,
      team_id,
      event_type,
      idempotency_key,
      payload
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
    run_id,
    action,
    actor,
    reason,
    before_state,
    after_state,
    idempotency_key
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

create table public.generated_epilogues (
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

create index generated_epilogues_run_idx
  on public.generated_epilogues(run_id, team_id, created_at desc);

create table public.translation_suggestions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizer_tenants(id) on delete cascade,
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

create index translation_suggestions_tenant_idx
  on public.translation_suggestions(tenant_id, created_at desc);

create table public.operational_anomalies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.organizer_tenants(id) on delete cascade,
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

create index operational_anomalies_open_idx
  on public.operational_anomalies(tenant_id, status, severity, last_detected_at desc);

alter table public.organizer_tenants enable row level security;
alter table public.tenant_memberships enable row level security;
alter table public.tenant_usage_events enable row level security;
alter table public.adaptive_difficulty_decisions enable row level security;
alter table public.cross_team_events enable row level security;
alter table public.generated_epilogues enable row level security;
alter table public.translation_suggestions enable row level security;
alter table public.operational_anomalies enable row level security;

revoke all on public.organizer_tenants from anon, authenticated;
revoke all on public.tenant_memberships from anon, authenticated;
revoke all on public.tenant_usage_events from anon, authenticated;
revoke all on public.adaptive_difficulty_decisions from anon, authenticated;
revoke all on public.cross_team_events from anon, authenticated;
revoke all on public.generated_epilogues from anon, authenticated;
revoke all on public.translation_suggestions from anon, authenticated;
revoke all on public.operational_anomalies from anon, authenticated;

grant all on public.organizer_tenants to service_role;
grant all on public.tenant_memberships to service_role;
grant all on public.tenant_usage_events to service_role;
grant all on public.adaptive_difficulty_decisions to service_role;
grant all on public.cross_team_events to service_role;
grant all on public.generated_epilogues to service_role;
grant all on public.translation_suggestions to service_role;
grant all on public.operational_anomalies to service_role;
grant usage, select on sequence public.tenant_usage_events_id_seq to service_role;

revoke all on function public.create_cross_team_event(
  uuid, uuid[], jsonb, jsonb, integer, timestamptz, text, text, text
) from public, anon, authenticated;
revoke all on function public.resolve_cross_team_event(
  uuid, uuid[], text, text, text
) from public, anon, authenticated;
grant execute on function public.create_cross_team_event(
  uuid, uuid[], jsonb, jsonb, integer, timestamptz, text, text, text
) to service_role;
grant execute on function public.resolve_cross_team_event(
  uuid, uuid[], text, text, text
) to service_role;

commit;
