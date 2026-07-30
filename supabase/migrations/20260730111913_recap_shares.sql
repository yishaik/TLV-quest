begin;

create table public.recap_shares (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.game_runs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  token_hash text not null unique,
  idempotency_key text not null unique,
  active_until timestamptz not null,
  revoked_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index recap_shares_run_created_idx
  on public.recap_shares(run_id, created_at desc);
create index recap_shares_active_idx
  on public.recap_shares(token_hash, active_until)
  where revoked_at is null;

alter table public.recap_shares enable row level security;
revoke all on table public.recap_shares from public, anon, authenticated;
grant all on table public.recap_shares to service_role;

create or replace function public.create_recap_share(
  p_run_id uuid,
  p_team_id uuid,
  p_actor text,
  p_reason text,
  p_idempotency_key text,
  p_active_hours integer default 72
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_share public.recap_shares%rowtype;
  v_active_until timestamptz;
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

  select * into v_share
  from public.recap_shares
  where idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'duplicate', true,
      'shareId', v_share.id,
      'teamId', v_share.team_id,
      'activeUntil', v_share.active_until
    );
  end if;

  v_active_until := least(
    now() + make_interval(hours => greatest(1, least(p_active_hours, 168))),
    coalesce(
      (select retention_until from public.game_runs where id = p_run_id),
      now() + interval '72 hours'
    )
  );
  if v_active_until <= now() then
    raise exception 'recap_retention_expired';
  end if;

  insert into public.recap_shares(
    run_id,
    team_id,
    token_hash,
    idempotency_key,
    active_until,
    created_by
  ) values (
    p_run_id,
    p_team_id,
    encode(
      extensions.digest(convert_to(p_idempotency_key, 'UTF8'), 'sha256'),
      'hex'
    ),
    p_idempotency_key,
    v_active_until,
    left(p_actor, 120)
  )
  returning * into v_share;

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
    'create_recap_share',
    left(p_actor, 120),
    left(trim(p_reason), 500),
    p_idempotency_key,
    '{}'::jsonb,
    jsonb_build_object(
      'shareId', v_share.id,
      'teamId', v_share.team_id,
      'activeUntil', v_share.active_until
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
    'RECAP_SHARE_CREATED',
    p_idempotency_key,
    jsonb_build_object(
      'share_id', v_share.id,
      'active_until', v_share.active_until
    )
  );

  return jsonb_build_object(
    'duplicate', false,
    'shareId', v_share.id,
    'teamId', v_share.team_id,
    'activeUntil', v_share.active_until
  );
end;
$$;

revoke all on function public.create_recap_share(
  uuid, uuid, text, text, text, integer
) from public, anon, authenticated;
grant execute on function public.create_recap_share(
  uuid, uuid, text, text, text, integer
) to service_role;

create or replace function public.revoke_recap_share(
  p_run_id uuid,
  p_share_id uuid,
  p_actor text,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_share public.recap_shares%rowtype;
begin
  if char_length(trim(coalesce(p_reason, ''))) < 5 then
    raise exception 'override_reason_required';
  end if;
  if exists (
    select 1 from public.organizer_audit_log
    where idempotency_key = p_idempotency_key
  ) then
    return jsonb_build_object('duplicate', true, 'shareId', p_share_id);
  end if;

  select * into v_share
  from public.recap_shares
  where id = p_share_id and run_id = p_run_id
  for update;
  if not found then raise exception 'recap_share_not_found'; end if;

  update public.recap_shares
  set revoked_at = coalesce(revoked_at, now())
  where id = v_share.id
  returning * into v_share;

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
    'revoke_recap_share',
    left(p_actor, 120),
    left(trim(p_reason), 500),
    p_idempotency_key,
    jsonb_build_object('shareId', v_share.id, 'revoked', false),
    jsonb_build_object(
      'shareId', v_share.id,
      'revoked', true,
      'revokedAt', v_share.revoked_at
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
    v_share.team_id,
    'RECAP_SHARE_REVOKED',
    p_idempotency_key,
    jsonb_build_object('share_id', v_share.id)
  );

  return jsonb_build_object(
    'duplicate', false,
    'shareId', v_share.id,
    'revokedAt', v_share.revoked_at
  );
end;
$$;

revoke all on function public.revoke_recap_share(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.revoke_recap_share(
  uuid, uuid, text, text, text
) to service_role;

commit;
