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

revoke execute on function public.apply_submission(uuid,uuid,uuid,text,text,jsonb,boolean,integer,text,text,text,boolean) from public, anon, authenticated;
grant execute on function public.apply_submission(uuid,uuid,uuid,text,text,jsonb,boolean,integer,text,text,text,boolean) to service_role;
