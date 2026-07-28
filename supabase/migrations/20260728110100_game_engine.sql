create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger game_templates_touch_updated_at
before update on public.game_templates
for each row execute function private.touch_updated_at();
create trigger game_runs_touch_updated_at
before update on public.game_runs
for each row execute function private.touch_updated_at();
create trigger teams_touch_updated_at
before update on public.teams
for each row execute function private.touch_updated_at();

create or replace function private.sync_leaderboard_entry()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_public_code text;
begin
  select public_code into v_public_code from public.game_runs where id = new.run_id;
  insert into public.leaderboard_entries (
    run_id, run_public_code, team_id, team_name, score, completed_count, status, last_progress_at, updated_at
  ) values (
    new.run_id, v_public_code, new.id, new.public_name, new.score, new.completed_count, new.status, new.last_progress_at, now()
  )
  on conflict (run_id, team_id) do update set
    team_name = excluded.team_name,
    score = excluded.score,
    completed_count = excluded.completed_count,
    status = excluded.status,
    last_progress_at = excluded.last_progress_at,
    updated_at = now();
  return new;
end;
$$;

create trigger teams_sync_leaderboard
after insert or update of public_name, score, completed_count, status, last_progress_at
on public.teams
for each row execute function private.sync_leaderboard_entry();

create or replace function public.claim_outbox_batch(batch_size integer default 20)
returns setof public.message_outbox
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  return query
  with claimed as (
    select id
    from public.message_outbox
    where status in ('pending','failed')
      and send_after <= now()
      and attempts < 5
      and (locked_at is null or locked_at < now() - interval '5 minutes')
    order by created_at
    for update skip locked
    limit greatest(1, least(batch_size, 100))
  )
  update public.message_outbox o
  set status = 'processing', locked_at = now(), attempts = attempts + 1
  from claimed
  where o.id = claimed.id
  returning o.*;
end;
$$;

create or replace function public.purge_expired_run_data()
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  expired_run record;
  deleted_count integer := 0;
begin
  for expired_run in
    select r.id, r.audience, r.started_at, r.finished_at, t.slug as template_slug
    from public.game_runs r
    join public.game_templates t on t.id = r.template_id
    where r.retention_until is not null
      and r.retention_until <= now()
      and r.status in ('finished','cancelled')
    for update of r skip locked
  loop
    insert into public.anonymous_run_metrics (
      template_slug, audience, participant_count, team_count, finisher_count, duration_seconds
    )
    select
      expired_run.template_slug,
      expired_run.audience,
      (select count(*) from public.participants p where p.run_id = expired_run.id),
      (select count(*) from public.teams tm where tm.run_id = expired_run.id),
      (select count(*) from public.teams tm where tm.run_id = expired_run.id and tm.status = 'finished'),
      case when expired_run.started_at is not null and expired_run.finished_at is not null
        then extract(epoch from expired_run.finished_at - expired_run.started_at)::integer
        else null
      end;

    delete from public.game_runs where id = expired_run.id;
    deleted_count := deleted_count + 1;
  end loop;
  return deleted_count;
end;
$$;

create or replace function public.start_run(p_run_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_first_slug text;
  v_status public.game_status;
begin
  select status into v_status
  from public.game_runs
  where id = p_run_id
  for update;

  if not found then raise exception 'run_not_found'; end if;
  if v_status not in ('draft','registration_open','ready','paused') then
    raise exception 'run_cannot_start';
  end if;

  select slug into v_first_slug
  from public.run_checkpoints
  where run_id = p_run_id and not is_disabled
  order by sequence_no
  limit 1;

  if v_first_slug is null then raise exception 'run_has_no_checkpoints'; end if;

  update public.game_runs
  set status = 'active', started_at = coalesce(started_at, now())
  where id = p_run_id;

  update public.teams
  set status = 'travelling',
      current_checkpoint_slug = coalesce(current_checkpoint_slug, v_first_slug),
      started_at = coalesce(started_at, now()),
      last_progress_at = now()
  where run_id = p_run_id and status = 'waiting';

  insert into public.game_events(run_id, event_type, idempotency_key, payload)
  values (p_run_id, 'RUN_STARTED', 'run-start:' || p_run_id::text, jsonb_build_object('first_checkpoint', v_first_slug))
  on conflict (idempotency_key) do nothing;

  return jsonb_build_object('status','active','first_checkpoint',v_first_slug);
end;
$$;

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
begin
  select * into v_team from public.teams where id = p_team_id for update;
  if not found then raise exception 'team_not_found'; end if;

  select * into v_checkpoint from public.run_checkpoints where id = p_checkpoint_id;
  if not found or v_checkpoint.run_id <> v_team.run_id then raise exception 'checkpoint_not_found'; end if;

  if exists (select 1 from public.game_events where idempotency_key = p_idempotency_key) then
    return jsonb_build_object(
      'duplicate', true,
      'correct', p_is_correct,
      'score', v_team.score,
      'completed_count', v_team.completed_count,
      'current_checkpoint_slug', v_team.current_checkpoint_slug,
      'status', v_team.status
    );
  end if;

  if v_team.status not in ('travelling','solving') then raise exception 'team_not_active'; end if;
  if v_team.current_checkpoint_slug is distinct from v_checkpoint.slug then raise exception 'checkpoint_locked'; end if;

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
        current_checkpoint_slug = case when p_is_final then null else p_next_checkpoint_slug end,
        status = case when p_is_final then 'finished'::public.team_status else 'travelling'::public.team_status end,
        last_progress_at = now(),
        finished_at = case when p_is_final then now() else finished_at end
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
    run_id, team_id, participant_id, event_type, idempotency_key, payload
  ) values (
    v_team.run_id,
    p_team_id,
    p_participant_id,
    case when p_is_correct then 'ANSWER_ACCEPTED' else 'ANSWER_REJECTED' end,
    p_idempotency_key,
    jsonb_build_object('submission_id', v_submission_id, 'checkpoint_slug', v_checkpoint.slug, 'score_delta', p_score_delta)
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

create or replace function public.request_hint(
  p_team_id uuid,
  p_participant_id uuid,
  p_checkpoint_id uuid,
  p_hint_index integer,
  p_penalty integer,
  p_hint_text text,
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
begin
  select * into v_team from public.teams where id = p_team_id for update;
  if not found then raise exception 'team_not_found'; end if;

  select * into v_checkpoint from public.run_checkpoints where id = p_checkpoint_id;
  if not found or v_checkpoint.run_id <> v_team.run_id then raise exception 'checkpoint_not_found'; end if;

  if exists (select 1 from public.game_events where idempotency_key = p_idempotency_key) then
    return jsonb_build_object('duplicate',true,'score',v_team.score,'hints_used',v_team.hints_used);
  end if;

  if v_team.current_checkpoint_slug is distinct from v_checkpoint.slug then raise exception 'checkpoint_locked'; end if;

  update public.teams
  set score = greatest(0, score - greatest(0, p_penalty)),
      hints_used = hints_used + 1,
      status = 'solving'
  where id = p_team_id
  returning * into v_team;

  insert into public.game_events(
    run_id, team_id, participant_id, event_type, idempotency_key, payload
  ) values (
    v_team.run_id,
    p_team_id,
    p_participant_id,
    'HINT_REQUESTED',
    p_idempotency_key,
    jsonb_build_object('checkpoint_slug', v_checkpoint.slug, 'hint_index', p_hint_index, 'penalty', p_penalty, 'hint_text', p_hint_text)
  );

  return jsonb_build_object('duplicate',false,'score',v_team.score,'hints_used',v_team.hints_used);
end;
$$;

create or replace function private.maybe_finish_run()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.status = 'finished' and old.status is distinct from new.status then
    if not exists (
      select 1 from public.teams
      where run_id = new.run_id and status not in ('finished','disqualified')
    ) then
      update public.game_runs
      set status = 'finished',
          finished_at = coalesce(finished_at, now()),
          retention_until = coalesce(retention_until, now() + interval '72 hours')
      where id = new.run_id and status = 'active';
    end if;
  end if;
  return new;
end;
$$;

create trigger teams_maybe_finish_run
after update of status on public.teams
for each row execute function private.maybe_finish_run();

revoke execute on function public.claim_outbox_batch(integer) from public, anon, authenticated;
revoke execute on function public.purge_expired_run_data() from public, anon, authenticated;
revoke execute on function public.start_run(uuid) from public, anon, authenticated;
revoke execute on function public.apply_submission(uuid,uuid,uuid,text,text,jsonb,boolean,integer,text,text,text,boolean) from public, anon, authenticated;
revoke execute on function public.request_hint(uuid,uuid,uuid,integer,integer,text,text) from public, anon, authenticated;

grant execute on function public.claim_outbox_batch(integer) to service_role;
grant execute on function public.purge_expired_run_data() to service_role;
grant execute on function public.start_run(uuid) to service_role;
grant execute on function public.apply_submission(uuid,uuid,uuid,text,text,jsonb,boolean,integer,text,text,text,boolean) to service_role;
grant execute on function public.request_hint(uuid,uuid,uuid,integer,integer,text,text) to service_role;
