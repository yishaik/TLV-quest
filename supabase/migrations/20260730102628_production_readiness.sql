begin;

-- Reassert the exposed-schema posture. Only the public leaderboard and the
-- participant-scoped realtime surfaces are reachable without the service role.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select on table public.leaderboard_entries to anon, authenticated;
grant select on table public.quest_realtime_events to authenticated;
grant select, insert, update, delete on table public.quest_presence to authenticated;

-- Keep the SECURITY DEFINER realtime authorization helper outside every
-- PostgREST-exposed schema. Authenticated users receive only the minimum
-- schema/function privileges needed by the RLS policies below.
drop policy if exists quest_realtime_events_participant_read
  on public.quest_realtime_events;
drop policy if exists quest_presence_team_read on public.quest_presence;
drop policy if exists quest_presence_own_insert on public.quest_presence;
drop policy if exists quest_presence_own_update on public.quest_presence;
drop policy if exists quest_presence_own_delete on public.quest_presence;

drop function if exists public.quest_realtime_binding_allowed(uuid, uuid, uuid);

create or replace function private.quest_realtime_binding_allowed(
  p_run_id uuid,
  p_team_id uuid default null,
  p_participant_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from public.realtime_participant_authorizations binding
    where binding.user_id = auth.uid()
      and binding.expires_at > now()
      and binding.run_id = p_run_id
      and (p_team_id is null or binding.team_id = p_team_id)
      and (
        p_participant_id is null
        or binding.participant_id = p_participant_id
      )
  );
$$;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke all on function private.quest_realtime_binding_allowed(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.quest_realtime_binding_allowed(uuid, uuid, uuid)
  to authenticated;

create policy quest_realtime_events_participant_read
on public.quest_realtime_events
for select
to authenticated
using (
  private.quest_realtime_binding_allowed(run_id, team_id, null)
);

create policy quest_presence_team_read
on public.quest_presence
for select
to authenticated
using (
  private.quest_realtime_binding_allowed(run_id, team_id, null)
);

create policy quest_presence_own_insert
on public.quest_presence
for insert
to authenticated
with check (
  private.quest_realtime_binding_allowed(run_id, team_id, participant_id)
  and expires_at <= now() + interval '2 minutes'
);

create policy quest_presence_own_update
on public.quest_presence
for update
to authenticated
using (
  private.quest_realtime_binding_allowed(run_id, team_id, participant_id)
)
with check (
  private.quest_realtime_binding_allowed(run_id, team_id, participant_id)
  and expires_at <= now() + interval '2 minutes'
);

create policy quest_presence_own_delete
on public.quest_presence
for delete
to authenticated
using (
  private.quest_realtime_binding_allowed(run_id, team_id, participant_id)
);

-- Shared, database-backed fixed-window limits work across every Vercel
-- instance. Bucket identifiers are HMACs; raw IPs and participant tokens are
-- never persisted.
create table public.rate_limit_buckets (
  bucket_key text primary key check (char_length(bucket_key) between 32 and 128),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now()
);

create index rate_limit_buckets_window_idx
  on public.rate_limit_buckets(window_started_at);

alter table public.rate_limit_buckets enable row level security;
revoke all on table public.rate_limit_buckets from public, anon, authenticated;
grant all on table public.rate_limit_buckets to service_role;

create or replace function public.consume_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (
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

revoke all on function public.consume_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer)
  to service_role;

-- The sixth incorrect answer within a rolling minute is held until the burst
-- cools down. A completed checkpoint resets per-checkpoint penalties.
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
  v_recent_failures integer;
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
    select 1
    from public.game_events
    where idempotency_key = p_idempotency_key
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

  if not p_is_correct then
    select count(*) into v_recent_failures
    from public.game_events
    where team_id = p_team_id
      and event_type = 'ANSWER_REJECTED'
      and payload ->> 'checkpoint_slug' = v_checkpoint.slug
      and created_at > now() - interval '1 minute';

    if v_recent_failures >= 5 then
      raise exception 'answer_cooldown_active:60';
    end if;
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
    p_submission_type,
    p_normalized_answer,
    coalesce(p_payload, '{}'::jsonb),
    p_is_correct,
    p_score_delta,
    p_validation_reason
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
        hints_used = 0,
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
        status = 'solving',
        last_progress_at = coalesce(last_progress_at, now())
    where id = p_team_id
    returning * into v_team;
  end if;

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

revoke all on function public.apply_submission(
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  boolean,
  integer,
  text,
  text,
  text,
  boolean
) from public, anon, authenticated;
grant execute on function public.apply_submission(
  uuid,
  uuid,
  uuid,
  text,
  text,
  jsonb,
  boolean,
  integer,
  text,
  text,
  text,
  boolean
) to service_role;

commit;
