-- Transactional checkpoint skipping.
-- Team progression, typed activity, and WhatsApp outbox rows commit together.

create or replace function private.format_checkpoint_skip_message(
  p_content jsonb,
  p_locale text,
  p_sequence_no integer,
  p_finished boolean
)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when p_finished and p_locale = 'en' then
      E'🎉 The checkpoint was skipped and the route is complete.\n\nOpen the web game for results and your recap.'
    when p_finished then
      E'🎉 התחנה דולגה והמסלול הושלם.\n\nפתחו את משחק הרשת לתוצאות ולסיכום.'
    else concat_ws(
      E'\n\n',
      case
        when p_locale = 'en' then '⏭️ The previous checkpoint was skipped.'
        else '⏭️ התחנה הקודמת דולגה.'
      end,
      case
        when p_locale = 'en' then
          '🧭 Checkpoint ' || p_sequence_no::text ||
          case
            when nullif(p_content -> p_locale ->> 'title', '') is not null
              then ' — ' || (p_content -> p_locale ->> 'title')
            else ''
          end
        else
          '🧭 תחנה ' || p_sequence_no::text ||
          case
            when nullif(p_content -> p_locale ->> 'title', '') is not null
              then ' — ' || (p_content -> p_locale ->> 'title')
            else ''
          end
      end,
      nullif(p_content -> p_locale ->> 'story', ''),
      case
        when nullif(p_content -> p_locale ->> 'prompt', '') is null then null
        when p_locale = 'en' then
          E'Your mission:\n' || (p_content -> p_locale ->> 'prompt')
        else
          E'המשימה:\n' || (p_content -> p_locale ->> 'prompt')
      end,
      case
        when nullif(p_content -> p_locale ->> 'locationHint', '') is null then null
        when p_locale = 'en' then
          '📍 Where: ' || (p_content -> p_locale ->> 'locationHint')
        else
          '📍 איפה: ' || (p_content -> p_locale ->> 'locationHint')
      end,
      case
        when p_locale = 'en' then
          'Open the web game for the map, score, and next steps.'
        else
          'פתחו את משחק הרשת למפה, ניקוד והמשך.'
      end
    )
  end;
$$;

revoke all on function private.format_checkpoint_skip_message(
  jsonb,text,integer,boolean
) from public, anon, authenticated;
grant execute on function private.format_checkpoint_skip_message(
  jsonb,text,integer,boolean
) to service_role;

create or replace function public.progress_checkpoint_skip(
  p_team_id uuid,
  p_actor_type text,
  p_actor_participant_id uuid,
  p_reason text,
  p_require_optional boolean,
  p_expected_checkpoint_slug text,
  p_idempotency_key text,
  p_deliveries jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_team public.teams%rowtype;
  v_current public.run_checkpoints%rowtype;
  v_next public.run_checkpoints%rowtype;
  v_run_status public.game_status;
  v_existing_team_id uuid;
  v_existing_payload jsonb;
  v_event_type text;
  v_outcome text;
  v_outbox_ids uuid[] := '{}'::uuid[];
  v_submission_id uuid;
  v_result jsonb;
begin
  if p_actor_type not in ('organizer', 'participant') then
    raise exception 'invalid_skip_actor';
  end if;
  if p_actor_type = 'participant' and p_actor_participant_id is null then
    raise exception 'skip_participant_required';
  end if;
  if p_actor_type = 'organizer' and p_actor_participant_id is not null then
    raise exception 'invalid_skip_actor';
  end if;
  if p_reason is null
     or char_length(p_reason) not between 3 and 80
     or p_reason !~ '^[a-z0-9_-]+$' then
    raise exception 'invalid_skip_reason';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key) not between 12 and 240 then
    raise exception 'invalid_idempotency_key';
  end if;
  if jsonb_typeof(coalesce(p_deliveries, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_deliveries, '[]'::jsonb)) > 100 then
    raise exception 'invalid_skip_deliveries';
  end if;

  select * into v_team
  from public.teams
  where id = p_team_id
  for update;
  if not found then raise exception 'team_not_found'; end if;

  select team_id, payload
  into v_existing_team_id, v_existing_payload
  from public.game_events
  where idempotency_key = p_idempotency_key;

  if found then
    if v_existing_team_id is distinct from p_team_id then
      raise exception 'idempotency_key_conflict';
    end if;
    return jsonb_build_object('duplicate', true)
      || coalesce(v_existing_payload, '{}'::jsonb);
  end if;

  select status into v_run_status
  from public.game_runs
  where id = v_team.run_id;
  if v_run_status is distinct from 'active'::public.game_status then
    raise exception 'game_not_active';
  end if;

  if p_actor_type = 'participant' and not exists (
    select 1
    from public.participants
    where id = p_actor_participant_id
      and team_id = p_team_id
      and run_id = v_team.run_id
  ) then
    raise exception 'participant_not_in_team';
  end if;

  if v_team.status not in ('travelling', 'solving') then
    raise exception 'team_not_active';
  end if;
  if v_team.current_checkpoint_slug is null then
    raise exception 'checkpoint_not_found';
  end if;
  if p_expected_checkpoint_slug is not null
     and v_team.current_checkpoint_slug is distinct from p_expected_checkpoint_slug then
    raise exception 'checkpoint_changed';
  end if;

  select * into v_current
  from public.run_checkpoints
  where run_id = v_team.run_id
    and slug = v_team.current_checkpoint_slug
    and is_disabled = false;
  if not found then raise exception 'checkpoint_not_found'; end if;

  if coalesce(p_require_optional, false) and not v_current.is_optional then
    raise exception 'checkpoint_not_optional';
  end if;

  select * into v_next
  from public.run_checkpoints
  where run_id = v_team.run_id
    and is_disabled = false
    and sequence_no > v_current.sequence_no
  order by sequence_no
  limit 1;

  if p_actor_type = 'participant' then
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
      p_actor_participant_id,
      v_current.id,
      'skip',
      null,
      jsonb_build_object(
        'actorType', p_actor_type,
        'reason', p_reason
      ),
      true,
      0,
      p_reason
    ) returning id into v_submission_id;
  end if;

  update public.teams
  set completed_count = completed_count + 1,
      current_checkpoint_slug = v_next.slug,
      status = case
        when v_next.id is null then 'finished'::public.team_status
        else 'travelling'::public.team_status
      end,
      wrong_attempts = 0,
      last_wrong_attempt_at = null,
      last_progress_at = clock_timestamp(),
      finished_at = case
        when v_next.id is null then clock_timestamp()
        else null
      end
  where id = p_team_id
  returning * into v_team;

  with prepared as (
    select
      delivery.participant_id,
      nullif(left(delivery.body, 4000), '') as body
    from jsonb_to_recordset(coalesce(p_deliveries, '[]'::jsonb))
      as delivery(participant_id uuid, body text)
  ),
  inserted as (
    insert into public.message_outbox(
      run_id,
      participant_id,
      channel,
      recipient_ciphertext,
      template_key,
      payload
    )
    select
      v_team.run_id,
      participant.id,
      'whatsapp',
      participant.phone_ciphertext,
      case
        when v_next.id is null then 'checkpoint_skip_completed'
        else 'checkpoint_skip_transition'
      end,
      jsonb_build_object(
        'body',
        coalesce(
          prepared.body,
          private.format_checkpoint_skip_message(
            coalesce(v_next.content, '{}'::jsonb),
            case when participant.language = 'en' then 'en' else 'he' end,
            coalesce(v_next.sequence_no, v_current.sequence_no),
            v_next.id is null
          )
        ),
        'transition',
        jsonb_build_object(
          'previousCheckpointSlug', v_current.slug,
          'nextCheckpointSlug', v_next.slug,
          'outcome', case when v_next.id is null then 'finished' else 'advanced' end
        )
      )
    from public.participants participant
    left join prepared on prepared.participant_id = participant.id
    where participant.team_id = p_team_id
      and participant.run_id = v_team.run_id
      and participant.phone_ciphertext is not null
      and participant.whatsapp_connected_at is not null
      and (
        p_actor_type <> 'participant'
        or participant.id is distinct from p_actor_participant_id
      )
    returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[])
  into v_outbox_ids
  from inserted;

  v_event_type := case
    when p_actor_type = 'organizer' then 'ORGANIZER_CHECKPOINT_SKIPPED'
    else 'OPTIONAL_CHECKPOINT_SKIPPED'
  end;
  v_outcome := case when v_next.id is null then 'finished' else 'advanced' end;
  v_result := jsonb_build_object(
    'actorType', p_actor_type,
    'reason', p_reason,
    'checkpointSlug', v_current.slug,
    'previousCheckpointSlug', v_current.slug,
    'nextCheckpointSlug', v_next.slug,
    'outcome', v_outcome,
    'queued', cardinality(v_outbox_ids),
    'outboxIds', to_jsonb(v_outbox_ids),
    'submissionId', v_submission_id
  );

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
    p_actor_participant_id,
    v_event_type,
    p_idempotency_key,
    v_result
  );

  return jsonb_build_object('duplicate', false) || v_result;
end;
$$;

revoke all on function public.progress_checkpoint_skip(
  uuid,text,uuid,text,boolean,text,text,jsonb
) from public, anon, authenticated;
grant execute on function public.progress_checkpoint_skip(
  uuid,text,uuid,text,boolean,text,text,jsonb
) to service_role;

-- Keep the existing RPC compatible while routing it through the same
-- transaction. Current application instances can continue using it safely
-- during a rolling deployment.
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
  v_expected_slug text;
begin
  select checkpoint.slug into v_expected_slug
  from public.run_checkpoints checkpoint
  join public.teams team
    on team.run_id = checkpoint.run_id
  where checkpoint.id = p_checkpoint_id
    and team.id = p_team_id;
  if not found then raise exception 'checkpoint_not_found'; end if;

  return public.progress_checkpoint_skip(
    p_team_id,
    'participant',
    p_participant_id,
    'participant_optional_skip',
    true,
    v_expected_slug,
    p_idempotency_key,
    '[]'::jsonb
  );
end;
$$;

revoke all on function public.skip_optional_checkpoint(uuid,uuid,uuid,text)
from public, anon, authenticated;
grant execute on function public.skip_optional_checkpoint(uuid,uuid,uuid,text)
to service_role;
