-- Abuse prevention for public runtime endpoints.
-- Transport limits use HMAC-derived subjects only; no raw IP or participant
-- token is persisted. Answer cooldown is enforced while holding the team row.

create table if not exists public.rate_limit_buckets (
  bucket_key text primary key
    check (char_length(bucket_key) between 32 and 128),
  window_started_at timestamptz not null,
  request_count integer not null
    check (request_count > 0),
  updated_at timestamptz not null default now()
);

alter table public.rate_limit_buckets enable row level security;

revoke all on public.rate_limit_buckets from public, anon, authenticated;
grant select, insert, update, delete on public.rate_limit_buckets to service_role;

create index if not exists rate_limit_buckets_window_idx
on public.rate_limit_buckets(window_started_at);

create index if not exists rate_limit_buckets_updated_idx
on public.rate_limit_buckets(updated_at);

create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table(
  allowed boolean,
  remaining integer,
  retry_after_seconds integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_bucket public.rate_limit_buckets%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if char_length(p_bucket_key) not between 32 and 128
     or p_limit not between 1 and 10000
     or p_window_seconds not between 1 and 86400 then
    raise exception 'invalid_rate_limit_configuration';
  end if;

  insert into public.rate_limit_buckets(
    bucket_key,
    window_started_at,
    request_count,
    updated_at
  ) values (
    p_bucket_key,
    v_now,
    1,
    v_now
  )
  on conflict (bucket_key) do update
  set window_started_at = case
        when public.rate_limit_buckets.window_started_at
             <= v_now - make_interval(secs => p_window_seconds)
          then v_now
        else public.rate_limit_buckets.window_started_at
      end,
      request_count = case
        when public.rate_limit_buckets.window_started_at
             <= v_now - make_interval(secs => p_window_seconds)
          then 1
        else least(public.rate_limit_buckets.request_count + 1, p_limit + 1)
      end,
      updated_at = v_now
  returning * into v_bucket;

  allowed := v_bucket.request_count <= p_limit;
  remaining := greatest(0, p_limit - v_bucket.request_count);
  retry_after_seconds := case
    when allowed then 0
    else greatest(
      1,
      ceil(
        extract(
          epoch from (
            v_bucket.window_started_at
            + make_interval(secs => p_window_seconds)
            - v_now
          )
        )
      )::integer
    )
  end;
  return next;
end;
$$;

revoke execute on function public.consume_rate_limit(text,integer,integer)
from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer)
to service_role;

create or replace function public.cleanup_rate_limit_buckets(
  p_batch_size integer default 1000
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  with expired as (
    select bucket_key
    from public.rate_limit_buckets
    where updated_at < clock_timestamp() - interval '2 days'
    order by updated_at
    for update skip locked
    limit greatest(1, least(coalesce(p_batch_size, 1000), 5000))
  ),
  deleted as (
    delete from public.rate_limit_buckets bucket
    using expired
    where bucket.bucket_key = expired.bucket_key
    returning 1
  )
  select count(*)::integer into v_deleted from deleted;

  return coalesce(v_deleted, 0);
end;
$$;

revoke execute on function public.cleanup_rate_limit_buckets(integer)
from public, anon, authenticated;
grant execute on function public.cleanup_rate_limit_buckets(integer)
to service_role;

alter table public.teams
add column if not exists last_wrong_attempt_at timestamptz;

-- wrong_attempts previously accumulated across checkpoints. Reset the legacy
-- values once so the column starts its new per-checkpoint semantics cleanly.
update public.teams
set wrong_attempts = 0,
    last_wrong_attempt_at = null
where wrong_attempts <> 0
   or last_wrong_attempt_at is not null;

create or replace function public.skip_optional_checkpoint(
  p_team_id uuid,
  p_participant_id uuid,
  p_checkpoint_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_team public.teams%rowtype;
  v_checkpoint public.run_checkpoints%rowtype;
  v_next_checkpoint public.run_checkpoints%rowtype;
  v_submission_id uuid;
  v_run_status public.game_status;
begin
  select * into v_team
  from public.teams
  where id = p_team_id
  for update;

  if not found then raise exception 'team_not_found'; end if;

  select status into v_run_status
  from public.game_runs
  where id = v_team.run_id;

  if v_run_status is distinct from 'active'::public.game_status then
    raise exception 'game_not_active';
  end if;

  if not exists (
    select 1
    from public.participants
    where id = p_participant_id
      and team_id = p_team_id
      and run_id = v_team.run_id
  ) then
    raise exception 'participant_not_in_team';
  end if;

  select * into v_checkpoint
  from public.run_checkpoints
  where id = p_checkpoint_id;

  if not found or v_checkpoint.run_id <> v_team.run_id then
    raise exception 'checkpoint_not_found';
  end if;

  if exists (
    select 1 from public.game_events where idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object(
      'duplicate', true,
      'score', v_team.score,
      'completed_count', v_team.completed_count,
      'current_checkpoint_slug', v_team.current_checkpoint_slug,
      'status', v_team.status
    );
  end if;

  if v_team.status not in ('travelling','solving') then
    raise exception 'team_not_active';
  end if;

  if v_team.current_checkpoint_slug is distinct from v_checkpoint.slug then
    raise exception 'checkpoint_locked';
  end if;

  if not v_checkpoint.is_optional then
    raise exception 'checkpoint_not_optional';
  end if;

  select * into v_next_checkpoint
  from public.run_checkpoints
  where run_id = v_team.run_id
    and is_disabled = false
    and sequence_no > v_checkpoint.sequence_no
  order by sequence_no
  limit 1;

  insert into public.submissions(
    run_id,
    team_id,
    participant_id,
    checkpoint_id,
    submission_type,
    normalized_answer,
    payload,
    is_correct,
    score_delta,
    validation_reason
  ) values (
    v_team.run_id,
    p_team_id,
    p_participant_id,
    p_checkpoint_id,
    'skip',
    null,
    jsonb_build_object('reason', 'optional_checkpoint_skipped'),
    true,
    0,
    'optional_checkpoint_skipped'
  ) returning id into v_submission_id;

  update public.teams
  set completed_count = completed_count + 1,
      current_checkpoint_slug = v_next_checkpoint.slug,
      status = case
        when v_next_checkpoint.id is null then 'finished'::public.team_status
        else 'travelling'::public.team_status
      end,
      wrong_attempts = 0,
      last_wrong_attempt_at = null,
      last_progress_at = now(),
      finished_at = case
        when v_next_checkpoint.id is null then now()
        else finished_at
      end
  where id = p_team_id
  returning * into v_team;

  insert into public.game_events(
    run_id,
    team_id,
    participant_id,
    event_type,
    idempotency_key,
    payload
  ) values (
    v_team.run_id,
    p_team_id,
    p_participant_id,
    'OPTIONAL_CHECKPOINT_SKIPPED',
    p_idempotency_key,
    jsonb_build_object(
      'submission_id', v_submission_id,
      'checkpoint_slug', v_checkpoint.slug,
      'next_checkpoint_slug', v_next_checkpoint.slug
    )
  );

  return jsonb_build_object(
    'duplicate', false,
    'score', v_team.score,
    'completed_count', v_team.completed_count,
    'current_checkpoint_slug', v_team.current_checkpoint_slug,
    'status', v_team.status
  );
end;
$$;

revoke all on function public.skip_optional_checkpoint(uuid,uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.skip_optional_checkpoint(uuid,uuid,uuid,text)
to service_role;

create or replace function public.apply_submission(
  p_team_id uuid,
  p_participant_id uuid,
  p_checkpoint_id uuid,
  p_submission_type text,
  p_normalized_answer text,
  p_payload jsonb,
  p_is_correct boolean,
  p_score_delta integer,
  p_validation_reason text,
  p_idempotency_key text,
  p_next_checkpoint_slug text,
  p_is_final boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_team public.teams%rowtype;
  v_checkpoint public.run_checkpoints%rowtype;
  v_submission_id uuid;
  v_retry_after integer;
begin
  select * into v_team
  from public.teams
  where id = p_team_id
  for update;
  if not found then raise exception 'team_not_found'; end if;

  select * into v_checkpoint
  from public.run_checkpoints
  where id = p_checkpoint_id;
  if not found or v_checkpoint.run_id <> v_team.run_id then
    raise exception 'checkpoint_not_found';
  end if;

  if exists (
    select 1 from public.game_events where idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object(
      'duplicate', true,
      'correct', p_is_correct,
      'score', v_team.score,
      'completed_count', v_team.completed_count,
      'current_checkpoint_slug', v_team.current_checkpoint_slug,
      'status', v_team.status
    );
  end if;

  if v_team.status not in ('travelling','solving') then
    raise exception 'team_not_active';
  end if;
  if v_team.current_checkpoint_slug is distinct from v_checkpoint.slug then
    raise exception 'checkpoint_locked';
  end if;

  -- Five consecutive wrong answers are allowed. Afterwards the whole team
  -- gets one new attempt every 30 seconds until it answers correctly or moves
  -- to another checkpoint. The team row lock makes this concurrency-safe.
  if v_team.wrong_attempts >= 5
     and v_team.last_wrong_attempt_at is not null
     and v_team.last_wrong_attempt_at + interval '30 seconds' > clock_timestamp()
  then
    v_retry_after := greatest(
      1,
      ceil(
        extract(
          epoch from (
            v_team.last_wrong_attempt_at
            + interval '30 seconds'
            - clock_timestamp()
          )
        )
      )::integer
    );
    raise exception 'answer_cooldown_active:%', v_retry_after;
  end if;

  if p_is_correct
     and v_checkpoint.latitude is not null
     and v_checkpoint.longitude is not null
     and v_checkpoint.radius_meters is not null
     and not exists (
       select 1
       from public.game_events
       where team_id = p_team_id
         and event_type = 'LOCATION_VERIFIED'
         and payload ->> 'checkpoint_slug' = v_checkpoint.slug
         and coalesce((payload ->> 'verified')::boolean, false)
     ) then
    raise exception 'location_verification_required';
  end if;

  if p_is_correct
     and v_checkpoint.kind = 'hybrid'
     and not exists (
       select 1
       from public.game_events
       where team_id = p_team_id
         and event_type = 'STATION_SCANNED'
         and payload ->> 'checkpoint_slug' = v_checkpoint.slug
     ) then
    raise exception 'scan_verification_required';
  end if;

  insert into public.submissions(
    run_id, team_id, participant_id, checkpoint_id, submission_type,
    normalized_answer, payload, is_correct, score_delta, validation_reason
  ) values (
    v_team.run_id, p_team_id, p_participant_id, p_checkpoint_id, p_submission_type,
    p_normalized_answer, coalesce(p_payload,'{}'::jsonb), p_is_correct, p_score_delta, p_validation_reason
  ) returning id into v_submission_id;

  if p_is_correct then
    update public.teams
    set score = greatest(0, score + p_score_delta),
        completed_count = completed_count + 1,
        current_checkpoint_slug = case
          when p_is_final then null
          else p_next_checkpoint_slug
        end,
        status = case
          when p_is_final then 'finished'::public.team_status
          else 'travelling'::public.team_status
        end,
        wrong_attempts = 0,
        last_wrong_attempt_at = null,
        last_progress_at = now(),
        finished_at = case
          when p_is_final then now()
          else finished_at
        end
    where id = p_team_id
    returning * into v_team;
  else
    update public.teams
    set score = greatest(0, score + least(0, p_score_delta)),
        wrong_attempts = wrong_attempts + 1,
        last_wrong_attempt_at = clock_timestamp(),
        status = 'solving',
        last_progress_at = coalesce(last_progress_at, now())
    where id = p_team_id
    returning * into v_team;
  end if;

  insert into public.game_events(
    run_id, team_id, participant_id, event_type, idempotency_key, payload
  ) values (
    v_team.run_id,
    p_team_id,
    p_participant_id,
    case
      when p_is_correct then 'ANSWER_ACCEPTED'
      else 'ANSWER_REJECTED'
    end,
    p_idempotency_key,
    jsonb_build_object(
      'submission_id', v_submission_id,
      'checkpoint_slug', v_checkpoint.slug,
      'score_delta', p_score_delta
    )
  );

  return jsonb_build_object(
    'duplicate', false,
    'correct', p_is_correct,
    'score', v_team.score,
    'completed_count', v_team.completed_count,
    'current_checkpoint_slug', v_team.current_checkpoint_slug,
    'status', v_team.status
  );
end;
$$;

revoke execute on function public.apply_submission(
  uuid,uuid,uuid,text,text,jsonb,boolean,integer,text,text,text,boolean
)
from public, anon, authenticated;
grant execute on function public.apply_submission(
  uuid,uuid,uuid,text,text,jsonb,boolean,integer,text,text,text,boolean
)
to service_role;
