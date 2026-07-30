begin;

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

revoke all on function public.create_cross_team_event(
  uuid, uuid[], jsonb, jsonb, integer, timestamptz, text, text, text
) from public, anon, authenticated;
grant execute on function public.create_cross_team_event(
  uuid, uuid[], jsonb, jsonb, integer, timestamptz, text, text, text
) to service_role;

commit;
