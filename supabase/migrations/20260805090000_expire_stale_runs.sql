-- Automatic expiry for stale runs.
--
-- Two leaks surfaced once self-service booking opened. A run that is created
-- and never started stays `registration_open` forever — `retention_until` is
-- only stamped on finish — so abandoned free bookings accumulate against the
-- tenant's active-run quota until every new booking in the system is refused.
-- And a run that is started but never finished holds its teams and outbox
-- forever, with the same quota effect.
--
-- The rule is a single ceiling: seven hours after creation, a run that is not
-- already closed gets closed. Seven hours is generous — the route is ninety
-- minutes — so the ceiling only ever catches runs nobody is coming back to.
--
-- Runs that never started are `cancelled`; runs that started are `finished`,
-- so their teams keep their scores and the recap and metrics paths treat them
-- like any other completed game. Both stampings mirror `maybe_finish_run`:
-- `finished_at` and a 72-hour `retention_until`, after which the existing
-- purge removes them.

begin;

create or replace function public.expire_stale_runs(
  p_max_age interval default interval '7 hours',
  p_batch_size integer default 50
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cancelled integer := 0;
  v_finished integer := 0;
begin
  with stale as (
    select id from public.game_runs
    where status in ('draft','registration_open','ready')
      and created_at < now() - p_max_age
    order by created_at
    limit greatest(1, least(p_batch_size, 500))
    for update skip locked
  )
  update public.game_runs run
  set status = 'cancelled',
      retention_until = coalesce(run.retention_until, now() + interval '72 hours')
  from stale
  where run.id = stale.id;
  get diagnostics v_cancelled = row_count;

  with stale as (
    select id from public.game_runs
    where status in ('active','paused')
      and created_at < now() - p_max_age
    order by created_at
    limit greatest(1, least(p_batch_size, 500))
    for update skip locked
  )
  update public.game_runs run
  set status = 'finished',
      finished_at = coalesce(run.finished_at, now()),
      retention_until = coalesce(run.retention_until, now() + interval '72 hours')
  from stale
  where run.id = stale.id;
  get diagnostics v_finished = row_count;

  return jsonb_build_object(
    'cancelled', v_cancelled,
    'finished', v_finished
  );
end;
$$;

revoke all on function public.expire_stale_runs(interval, integer)
  from public, anon, authenticated;
grant execute on function public.expire_stale_runs(interval, integer)
  to service_role;

commit;
