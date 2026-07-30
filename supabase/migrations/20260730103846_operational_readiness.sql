begin;

alter table public.anonymous_run_metrics
  add column if not exists metric_key text,
  add column if not exists completion_rate numeric(6,5),
  add column if not exists checkpoint_funnel jsonb not null default '{}'::jsonb,
  add column if not exists hint_count integer not null default 0,
  add column if not exists failure_count integer not null default 0,
  add column if not exists message_failure_count integer not null default 0;

update public.anonymous_run_metrics
set metric_key = encode(
  digest(
    concat_ws(
      ':',
      id::text,
      template_slug,
      recorded_at::text
    ),
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

create table public.maintenance_runs (
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

create index maintenance_runs_status_started_idx
  on public.maintenance_runs(status, started_at desc);

alter table public.maintenance_runs enable row level security;
revoke all on table public.maintenance_runs from public, anon, authenticated;
grant all on table public.maintenance_runs to service_role;

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
    metric_key,
    template_slug,
    audience,
    participant_count,
    team_count,
    finisher_count,
    completion_rate,
    duration_seconds,
    checkpoint_funnel,
    hint_count,
    failure_count,
    message_failure_count,
    recorded_at
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

revoke all on function private.upsert_anonymous_run_metric(uuid)
  from public, anon, authenticated;
grant execute on function private.upsert_anonymous_run_metric(uuid)
  to service_role;

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

revoke all on function public.record_completed_run_metrics(integer)
  from public, anon, authenticated;
grant execute on function public.record_completed_run_metrics(integer)
  to service_role;

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

revoke all on function public.purge_expired_run_data()
  from public, anon, authenticated;
grant execute on function public.purge_expired_run_data()
  to service_role;

commit;
