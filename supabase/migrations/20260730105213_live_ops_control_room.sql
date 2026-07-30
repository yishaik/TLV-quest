begin;

alter table public.message_outbox
  add column if not exists idempotency_key text,
  add column if not exists target_scope text;

update public.message_outbox
set idempotency_key = 'legacy-outbox:' || id::text
where idempotency_key is null;

alter table public.message_outbox
  alter column idempotency_key
    set default ('outbox:' || gen_random_uuid()::text),
  alter column idempotency_key set not null;

create unique index if not exists message_outbox_idempotency_key_idx
  on public.message_outbox(idempotency_key);

create table public.in_app_banners (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.game_runs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  body jsonb not null,
  idempotency_key text not null unique,
  active_until timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(body) = 'object')
);

create index in_app_banners_active_idx
  on public.in_app_banners(run_id, team_id, active_until desc)
  where revoked_at is null;

alter table public.in_app_banners enable row level security;
revoke all on table public.in_app_banners from public, anon, authenticated;
grant all on table public.in_app_banners to service_role;

create table public.organizer_audit_log (
  id bigint generated always as identity primary key,
  run_id uuid,
  action text not null,
  actor text not null,
  reason text not null,
  idempotency_key text not null unique,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index organizer_audit_log_run_created_idx
  on public.organizer_audit_log(run_id, created_at desc);

alter table public.organizer_audit_log enable row level security;
revoke all on table public.organizer_audit_log
  from public, anon, authenticated;
grant select, insert on table public.organizer_audit_log to service_role;
grant usage, select on sequence public.organizer_audit_log_id_seq
  to service_role;

create or replace function public.apply_organizer_override(
  p_run_id uuid,
  p_action text,
  p_reason text,
  p_actor text,
  p_idempotency_key text,
  p_team_id uuid default null,
  p_participant_id uuid default null,
  p_target_team_id uuid default null,
  p_checkpoint_slug text default null,
  p_score_delta integer default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_run public.game_runs%rowtype;
  v_team public.teams%rowtype;
  v_checkpoint public.run_checkpoints%rowtype;
  v_next public.run_checkpoints%rowtype;
  v_participant public.participants%rowtype;
  v_hint jsonb;
  v_hint_index integer;
  v_hint_penalty integer;
  v_hint_text text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
begin
  if char_length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'override_reason_required';
  end if;
  if char_length(trim(coalesce(p_actor, ''))) < 3 then
    raise exception 'override_actor_required';
  end if;

  select * into v_run
  from public.game_runs
  where id = p_run_id
  for update;
  if not found then raise exception 'run_not_found'; end if;

  if exists (
    select 1
    from public.game_events
    where idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('duplicate', true, 'action', p_action);
  end if;

  if p_action in ('pause', 'resume', 'end') then
    v_before := jsonb_build_object('runStatus', v_run.status);

    if p_action = 'pause' then
      if v_run.status <> 'active' then raise exception 'run_cannot_pause'; end if;
      update public.game_runs set status = 'paused' where id = p_run_id
      returning * into v_run;
    elsif p_action = 'resume' then
      if v_run.status <> 'paused' then raise exception 'run_cannot_resume'; end if;
      update public.game_runs set status = 'active' where id = p_run_id
      returning * into v_run;
    else
      update public.game_runs
      set status = 'finished',
          finished_at = coalesce(finished_at, now()),
          retention_until = coalesce(retention_until, now() + interval '72 hours')
      where id = p_run_id
      returning * into v_run;

      update public.teams
      set status = case
            when status = 'disqualified' then status
            else 'finished'::public.team_status
          end,
          finished_at = case
            when status = 'disqualified' then finished_at
            else coalesce(finished_at, now())
          end
      where run_id = p_run_id;
    end if;

    v_after := jsonb_build_object('runStatus', v_run.status);

  elsif p_action in ('score', 'force_complete', 'grant_hint') then
    select * into v_team
    from public.teams
    where id = p_team_id
      and run_id = p_run_id
    for update;
    if not found then raise exception 'team_not_found'; end if;

    v_before := jsonb_build_object(
      'teamId', v_team.id,
      'status', v_team.status,
      'score', v_team.score,
      'completedCount', v_team.completed_count,
      'checkpoint', v_team.current_checkpoint_slug,
      'hintsUsed', v_team.hints_used
    );

    if p_action = 'score' then
      if p_score_delta is null or abs(p_score_delta) > 1000 then
        raise exception 'invalid_score_delta';
      end if;
      update public.teams
      set score = greatest(0, score + p_score_delta)
      where id = v_team.id
      returning * into v_team;

    elsif p_action = 'force_complete' then
      if v_team.current_checkpoint_slug is null then
        raise exception 'team_has_no_checkpoint';
      end if;
      select * into v_checkpoint
      from public.run_checkpoints
      where run_id = p_run_id
        and slug = v_team.current_checkpoint_slug;

      select * into v_next
      from public.run_checkpoints
      where run_id = p_run_id
        and is_disabled = false
        and sequence_no > v_checkpoint.sequence_no
      order by sequence_no
      limit 1;

      update public.teams
      set completed_count = completed_count + 1,
          current_checkpoint_slug = v_next.slug,
          status = case
            when v_next.id is null then 'finished'::public.team_status
            else 'travelling'::public.team_status
          end,
          wrong_attempts = 0,
          hints_used = 0,
          last_progress_at = now(),
          finished_at = case
            when v_next.id is null then now()
            else finished_at
          end
      where id = v_team.id
      returning * into v_team;

    else
      if v_team.current_checkpoint_slug is null then
        raise exception 'team_has_no_checkpoint';
      end if;
      select * into v_checkpoint
      from public.run_checkpoints
      where run_id = p_run_id
        and slug = v_team.current_checkpoint_slug;

      select count(*)::integer into v_hint_index
      from public.game_events
      where team_id = v_team.id
        and event_type = 'HINT_REQUESTED'
        and payload ->> 'checkpoint_slug' = v_checkpoint.slug;

      v_hint := v_checkpoint.hints -> v_hint_index;
      if v_hint is null or jsonb_typeof(v_hint) <> 'object' then
        raise exception 'no_more_hints';
      end if;
      v_hint_penalty := greatest(
        0,
        coalesce((v_hint ->> 'penalty')::integer, 10)
      );
      v_hint_text := coalesce(v_hint ->> 'he', v_hint ->> 'en', '');

      update public.teams
      set score = greatest(0, score - v_hint_penalty),
          hints_used = hints_used + 1,
          status = 'solving'
      where id = v_team.id
      returning * into v_team;

      select * into v_participant
      from public.participants
      where team_id = v_team.id
      order by joined_at
      limit 1;

      insert into public.game_events(
        run_id,
        team_id,
        participant_id,
        event_type,
        idempotency_key,
        payload
      ) values (
        p_run_id,
        v_team.id,
        v_participant.id,
        'HINT_REQUESTED',
        p_idempotency_key || ':hint',
        jsonb_build_object(
          'checkpoint_slug', v_checkpoint.slug,
          'hint_index', v_hint_index,
          'penalty', v_hint_penalty,
          'hint_text', v_hint_text,
          'source', 'organizer'
        )
      );

      insert into public.message_outbox(
        run_id,
        participant_id,
        channel,
        recipient_ciphertext,
        payload,
        idempotency_key,
        target_scope
      )
      select
        p_run_id,
        participant.id,
        'whatsapp',
        participant.phone_ciphertext,
        jsonb_build_object(
          'body',
          case
            when participant.language = 'en'
              then 'Organizer hint: ' || coalesce(v_hint ->> 'en', v_hint_text)
            else 'רמז מהמארגן: ' || coalesce(v_hint ->> 'he', v_hint_text)
          end
        ),
        p_idempotency_key || ':outbox:' || participant.id::text,
        'team:' || v_team.id::text
      from public.participants participant
      where participant.team_id = v_team.id
        and participant.phone_ciphertext is not null
      on conflict (idempotency_key) do nothing;
    end if;

    v_after := jsonb_build_object(
      'teamId', v_team.id,
      'status', v_team.status,
      'score', v_team.score,
      'completedCount', v_team.completed_count,
      'checkpoint', v_team.current_checkpoint_slug,
      'hintsUsed', v_team.hints_used,
      'hint', v_hint_text
    );

  elsif p_action = 'move_participant' then
    select * into v_participant
    from public.participants
    where id = p_participant_id
      and run_id = p_run_id
    for update;
    if not found then raise exception 'participant_not_found'; end if;
    if not exists (
      select 1 from public.teams
      where id = p_target_team_id and run_id = p_run_id
    ) then
      raise exception 'target_team_not_found';
    end if;

    v_before := jsonb_build_object(
      'participantId', v_participant.id,
      'teamId', v_participant.team_id
    );
    update public.participants
    set team_id = p_target_team_id
    where id = v_participant.id
    returning * into v_participant;
    update public.realtime_participant_authorizations
    set team_id = p_target_team_id,
        updated_at = now()
    where participant_id = v_participant.id;
    update public.quest_presence
    set team_id = p_target_team_id,
        online_at = now()
    where participant_id = v_participant.id;
    v_after := jsonb_build_object(
      'participantId', v_participant.id,
      'teamId', v_participant.team_id
    );

  elsif p_action = 'disable_checkpoint' then
    select * into v_checkpoint
    from public.run_checkpoints
    where run_id = p_run_id
      and slug = p_checkpoint_slug
    for update;
    if not found then raise exception 'checkpoint_not_found'; end if;

    select * into v_next
    from public.run_checkpoints
    where run_id = p_run_id
      and is_disabled = false
      and sequence_no > v_checkpoint.sequence_no
    order by sequence_no
    limit 1;

    v_before := jsonb_build_object(
      'checkpoint', v_checkpoint.slug,
      'disabled', v_checkpoint.is_disabled
    );
    update public.run_checkpoints
    set is_disabled = true
    where id = v_checkpoint.id;
    update public.teams
    set completed_count = completed_count + 1,
        current_checkpoint_slug = v_next.slug,
        status = case
          when v_next.id is null then 'finished'::public.team_status
          else 'travelling'::public.team_status
        end,
        wrong_attempts = 0,
        hints_used = 0,
        last_progress_at = now(),
        finished_at = case
          when v_next.id is null then now()
          else finished_at
        end
    where run_id = p_run_id
      and current_checkpoint_slug = v_checkpoint.slug
      and status in ('travelling', 'solving');
    v_after := jsonb_build_object(
      'checkpoint', v_checkpoint.slug,
      'disabled', true,
      'nextCheckpoint', v_next.slug
    );
  else
    raise exception 'unsupported_organizer_action';
  end if;

  insert into public.organizer_audit_log(
    run_id,
    action,
    actor,
    reason,
    idempotency_key,
    before_state,
    after_state
  ) values (
    p_run_id,
    p_action,
    left(p_actor, 120),
    left(trim(p_reason), 500),
    p_idempotency_key,
    v_before,
    v_after
  );

  insert into public.game_events(
    run_id,
    team_id,
    participant_id,
    event_type,
    idempotency_key,
    payload
  ) values (
    p_run_id,
    p_team_id,
    p_participant_id,
    'ORGANIZER_OVERRIDE',
    p_idempotency_key,
    jsonb_build_object(
      'action', p_action,
      'actor', left(p_actor, 120),
      'reason', left(trim(p_reason), 500),
      'before', v_before,
      'after', v_after
    )
  );

  return jsonb_build_object(
    'duplicate', false,
    'action', p_action,
    'before', v_before,
    'after', v_after
  );
end;
$$;

revoke all on function public.apply_organizer_override(
  uuid, text, text, text, text, uuid, uuid, uuid, text, integer
) from public, anon, authenticated;
grant execute on function public.apply_organizer_override(
  uuid, text, text, text, text, uuid, uuid, uuid, text, integer
) to service_role;

create or replace function public.queue_organizer_broadcast(
  p_run_id uuid,
  p_team_id uuid,
  p_body_he text,
  p_body_en text,
  p_reason text,
  p_actor text,
  p_idempotency_key text,
  p_active_minutes integer default 60
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_banner_id uuid;
  v_queued integer := 0;
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
  if char_length(trim(coalesce(p_body_he, ''))) not between 1 and 800
     or char_length(trim(coalesce(p_body_en, ''))) not between 1 and 800 then
    raise exception 'broadcast_body_required';
  end if;

  if exists (
    select 1 from public.game_events
    where idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('duplicate', true, 'queued', 0);
  end if;

  insert into public.in_app_banners(
    run_id,
    team_id,
    body,
    idempotency_key,
    active_until
  ) values (
    p_run_id,
    p_team_id,
    jsonb_build_object('he', trim(p_body_he), 'en', trim(p_body_en)),
    p_idempotency_key,
    now() + make_interval(mins => greatest(1, least(p_active_minutes, 1440)))
  )
  returning id into v_banner_id;

  insert into public.message_outbox(
    run_id,
    participant_id,
    channel,
    recipient_ciphertext,
    payload,
    idempotency_key,
    target_scope
  )
  select
    p_run_id,
    participant.id,
    'whatsapp',
    participant.phone_ciphertext,
    jsonb_build_object(
      'body',
      case
        when participant.language = 'en' then trim(p_body_en)
        else trim(p_body_he)
      end
    ),
    p_idempotency_key || ':outbox:' || participant.id::text,
    case
      when p_team_id is null then 'run:' || p_run_id::text
      else 'team:' || p_team_id::text
    end
  from public.participants participant
  where participant.run_id = p_run_id
    and (p_team_id is null or participant.team_id = p_team_id)
    and participant.phone_ciphertext is not null
  on conflict (idempotency_key) do nothing;
  get diagnostics v_queued = row_count;

  insert into public.organizer_audit_log(
    run_id,
    action,
    actor,
    reason,
    idempotency_key,
    before_state,
    after_state
  ) values (
    p_run_id,
    'broadcast',
    left(p_actor, 120),
    left(trim(p_reason), 500),
    p_idempotency_key,
    '{}'::jsonb,
    jsonb_build_object(
      'bannerId', v_banner_id,
      'teamId', p_team_id,
      'queued', v_queued
    )
  );

  insert into public.game_events(
    run_id,
    team_id,
    event_type,
    idempotency_key,
    payload
  ) values (
    p_run_id,
    p_team_id,
    'ORGANIZER_BROADCAST',
    p_idempotency_key,
    jsonb_build_object(
      'actor', left(p_actor, 120),
      'reason', left(trim(p_reason), 500),
      'banner_id', v_banner_id,
      'queued', v_queued
    )
  );

  return jsonb_build_object(
    'duplicate', false,
    'bannerId', v_banner_id,
    'queued', v_queued
  );
end;
$$;

revoke all on function public.queue_organizer_broadcast(
  uuid, uuid, text, text, text, text, text, integer
) from public, anon, authenticated;
grant execute on function public.queue_organizer_broadcast(
  uuid, uuid, text, text, text, text, text, integer
) to service_role;

create or replace function public.retry_outbox_message(
  p_run_id uuid,
  p_message_id uuid,
  p_reason text,
  p_actor text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_before public.message_outbox%rowtype;
  v_after public.message_outbox%rowtype;
begin
  if char_length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'override_reason_required';
  end if;
  if exists (
    select 1 from public.game_events
    where idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('duplicate', true);
  end if;

  select * into v_before
  from public.message_outbox
  where id = p_message_id
    and run_id = p_run_id
  for update;
  if not found then raise exception 'message_not_found'; end if;
  if v_before.status not in ('failed', 'cancelled') then
    raise exception 'message_not_retryable';
  end if;

  update public.message_outbox
  set status = 'pending',
      attempts = 0,
      send_after = now(),
      locked_at = null,
      last_error = null
  where id = p_message_id
  returning * into v_after;

  insert into public.organizer_audit_log(
    run_id,
    action,
    actor,
    reason,
    idempotency_key,
    before_state,
    after_state
  ) values (
    p_run_id,
    'retry_message',
    left(p_actor, 120),
    left(trim(p_reason), 500),
    p_idempotency_key,
    jsonb_build_object(
      'messageId', v_before.id,
      'status', v_before.status,
      'attempts', v_before.attempts
    ),
    jsonb_build_object(
      'messageId', v_after.id,
      'status', v_after.status,
      'attempts', v_after.attempts
    )
  );

  insert into public.game_events(
    run_id,
    event_type,
    idempotency_key,
    payload
  ) values (
    p_run_id,
    'ORGANIZER_OVERRIDE',
    p_idempotency_key,
    jsonb_build_object(
      'action', 'retry_message',
      'actor', left(p_actor, 120),
      'reason', left(trim(p_reason), 500),
      'message_id', p_message_id
    )
  );

  return jsonb_build_object('duplicate', false, 'status', v_after.status);
end;
$$;

revoke all on function public.retry_outbox_message(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.retry_outbox_message(
  uuid, uuid, text, text, text
) to service_role;

commit;
