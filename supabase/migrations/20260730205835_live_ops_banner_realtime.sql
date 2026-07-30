-- Applied to production as migration 20260730205835.
begin;

create or replace function public.quest_broadcast_banner_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run_id uuid;
  v_team_id uuid;
begin
  v_run_id := case
    when tg_op = 'DELETE' then old.run_id
    else new.run_id
  end;
  v_team_id := case
    when tg_op = 'DELETE' then old.team_id
    else new.team_id
  end;

  perform public.quest_emit_realtime_event(
    v_run_id,
    v_team_id,
    tg_table_name,
    tg_op
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.quest_broadcast_banner_state()
  from public, anon, authenticated;

drop trigger if exists quest_realtime_banner_state
  on public.in_app_banners;
create trigger quest_realtime_banner_state
after insert or update or delete on public.in_app_banners
for each row execute function public.quest_broadcast_banner_state();

commit;
