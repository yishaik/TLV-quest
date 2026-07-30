-- Resolve every WhatsApp registration for a phone hash in one database
-- snapshot. Selection and user-facing status copy are intentionally handled
-- in application code so the precedence matrix remains unit-testable.

create or replace function public.get_whatsapp_game_contexts(
  p_phone_hash text
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with candidate_rows as (
    select
      participant.id as participant_id,
      participant.language,
      participant.joined_at,
      run.id as run_id,
      run.public_code,
      run.status as run_status,
      run.scheduled_at,
      run.started_at as run_started_at,
      run.finished_at as run_finished_at,
      run.retention_until,
      team.id as team_id,
      team.status as team_status,
      team.current_checkpoint_slug,
      team.score,
      team.completed_count,
      team.wrong_attempts,
      team.hints_used,
      team.started_at as team_started_at,
      team.finished_at as team_finished_at,
      team.last_progress_at,
      checkpoint.id as checkpoint_id,
      checkpoint.slug as checkpoint_slug,
      checkpoint.sequence_no,
      checkpoint.kind,
      checkpoint.content,
      checkpoint.validation,
      checkpoint.hints,
      checkpoint.scoring,
      checkpoint.fallback_checkpoint,
      checkpoint.latitude,
      checkpoint.longitude,
      checkpoint.radius_meters,
      (
        select count(*)::integer
        from public.run_checkpoints run_checkpoint
        where run_checkpoint.run_id = run.id
          and run_checkpoint.is_disabled = false
      ) as checkpoint_count
    from public.participants participant
    join public.game_runs run
      on run.id = participant.run_id
    left join public.teams team
      on team.id = participant.team_id
     and team.run_id = participant.run_id
    left join public.run_checkpoints checkpoint
      on checkpoint.run_id = participant.run_id
     and checkpoint.slug = team.current_checkpoint_slug
     and checkpoint.is_disabled = false
    where participant.phone_hash = p_phone_hash
    order by participant.joined_at desc
    limit 50
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'joined_at', candidate.joined_at,
        'participant', jsonb_build_object(
          'id', candidate.participant_id,
          'language', candidate.language
        ),
        'run', jsonb_build_object(
          'id', candidate.run_id,
          'public_code', candidate.public_code,
          'status', candidate.run_status,
          'scheduled_at', candidate.scheduled_at,
          'started_at', candidate.run_started_at,
          'finished_at', candidate.run_finished_at,
          'retention_until', candidate.retention_until
        ),
        'team', case
          when candidate.team_id is null then null
          else jsonb_build_object(
            'id', candidate.team_id,
            'status', candidate.team_status,
            'current_checkpoint_slug', candidate.current_checkpoint_slug,
            'score', candidate.score,
            'completed_count', candidate.completed_count,
            'wrong_attempts', candidate.wrong_attempts,
            'hints_used', candidate.hints_used,
            'started_at', candidate.team_started_at,
            'finished_at', candidate.team_finished_at,
            'last_progress_at', candidate.last_progress_at
          )
        end,
        'checkpoint_count', candidate.checkpoint_count,
        'checkpoint', case
          when candidate.checkpoint_id is null then null
          else jsonb_build_object(
            'id', candidate.checkpoint_id,
            'slug', candidate.checkpoint_slug,
            'sequence_no', candidate.sequence_no,
            'kind', candidate.kind,
            'content', candidate.content,
            'validation', candidate.validation,
            'hints', candidate.hints,
            'scoring', candidate.scoring,
            'fallback_checkpoint', candidate.fallback_checkpoint,
            'latitude', candidate.latitude,
            'longitude', candidate.longitude,
            'radius_meters', candidate.radius_meters
          )
        end
      )
      order by candidate.joined_at desc
    ),
    '[]'::jsonb
  )
  from candidate_rows candidate;
$$;

revoke all on function public.get_whatsapp_game_contexts(text)
from public, anon, authenticated;
grant execute on function public.get_whatsapp_game_contexts(text)
to service_role;
