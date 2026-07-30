begin;

-- A run-level DELETE cannot emit a child realtime event after the parent row
-- has been removed: quest_realtime_events.run_id intentionally references
-- game_runs. Child-row delete triggers already publish their final changes
-- while the run still exists, so a second run-level tombstone is neither
-- durable nor useful.
create or replace function public.quest_broadcast_run_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  perform public.quest_emit_realtime_event(
    new.id,
    null,
    tg_table_name,
    tg_op
  );
  return new;
end;
$$;

revoke all on function public.quest_broadcast_run_state()
  from public, anon, authenticated;

drop trigger if exists quest_realtime_run_state on public.game_runs;
create trigger quest_realtime_run_state
after insert or update on public.game_runs
for each row execute function public.quest_broadcast_run_state();

commit;
