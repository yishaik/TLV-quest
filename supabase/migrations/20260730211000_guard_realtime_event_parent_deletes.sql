begin;

-- Cascading deletes run AFTER DELETE triggers after the referenced row has
-- become invisible. Treat those notifications as ephemeral instead of
-- allowing their audit projection to abort retention and operator cleanup.
create or replace function public.quest_emit_realtime_event(
  p_run_id uuid,
  p_team_id uuid,
  p_source text,
  p_operation text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
  v_team_id uuid := p_team_id;
begin
  if not exists (
    select 1
    from public.game_runs run
    where run.id = p_run_id
  ) then
    return;
  end if;

  if v_team_id is not null
     and not exists (
       select 1
       from public.teams team
       where team.id = v_team_id
         and team.run_id = p_run_id
     ) then
    -- A standalone team deletion can still wake run-level listeners without
    -- retaining a foreign key to the deleted team.
    v_team_id := null;
  end if;

  insert into public.quest_realtime_events(
    run_id,
    team_id,
    source,
    operation
  ) values (
    p_run_id,
    v_team_id,
    left(coalesce(p_source, 'unknown'), 80),
    left(coalesce(p_operation, 'UNKNOWN'), 20)
  ) returning id into v_id;

  if mod(v_id, 100) = 0 then
    delete from public.quest_realtime_events
    where created_at < now() - interval '3 days';
  end if;
end;
$$;

revoke all on function public.quest_emit_realtime_event(uuid, uuid, text, text)
  from public, anon, authenticated;

commit;
