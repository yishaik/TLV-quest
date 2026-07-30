begin;

-- Player devices use random public Broadcast topics as wake-up signals only.
-- No private row or PII is included in a broadcast payload; clients still reload
-- authoritative state through the token-protected Next.js API.
alter table public.teams
  add column if not exists realtime_topic text;

update public.teams
set realtime_topic = replace(gen_random_uuid()::text, '-', '')
where realtime_topic is null;

alter table public.teams
  alter column realtime_topic set default replace(gen_random_uuid()::text, '-', ''),
  alter column realtime_topic set not null;

create unique index if not exists teams_realtime_topic_idx
  on public.teams(realtime_topic);

alter table public.game_runs
  add column if not exists realtime_topic text;

update public.game_runs
set realtime_topic = replace(gen_random_uuid()::text, '-', '')
where realtime_topic is null;

alter table public.game_runs
  alter column realtime_topic set default replace(gen_random_uuid()::text, '-', ''),
  alter column realtime_topic set not null;

create unique index if not exists game_runs_realtime_topic_idx
  on public.game_runs(realtime_topic);

create or replace function public.quest_broadcast_team_state()
returns trigger
language plpgsql
security definer
set search_path = public, realtime, pg_temp
as $$
declare
  v_topic text;
begin
  v_topic := case when tg_op = 'DELETE' then old.realtime_topic else new.realtime_topic end;

  perform realtime.send(
    jsonb_build_object(
      'source', tg_table_name,
      'operation', tg_op,
      'at', clock_timestamp()
    ),
    'state_changed',
    'team:' || v_topic,
    false
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.quest_broadcast_related_team_state()
returns trigger
language plpgsql
security definer
set search_path = public, realtime, pg_temp
as $$
declare
  v_old_team_id uuid;
  v_new_team_id uuid;
  v_topic text;
begin
  if tg_op <> 'INSERT' then
    v_old_team_id := nullif(to_jsonb(old) ->> 'team_id', '')::uuid;
  end if;
  if tg_op <> 'DELETE' then
    v_new_team_id := nullif(to_jsonb(new) ->> 'team_id', '')::uuid;
  end if;

  for v_topic in
    select distinct team.realtime_topic
    from public.teams team
    where team.id in (v_old_team_id, v_new_team_id)
  loop
    perform realtime.send(
      jsonb_build_object(
        'source', tg_table_name,
        'operation', tg_op,
        'at', clock_timestamp()
      ),
      'state_changed',
      'team:' || v_topic,
      false
    );
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.quest_broadcast_run_state()
returns trigger
language plpgsql
security definer
set search_path = public, realtime, pg_temp
as $$
declare
  v_topic text;
begin
  v_topic := case when tg_op = 'DELETE' then old.realtime_topic else new.realtime_topic end;

  perform realtime.send(
    jsonb_build_object(
      'source', tg_table_name,
      'operation', tg_op,
      'at', clock_timestamp()
    ),
    'state_changed',
    'run:' || v_topic,
    false
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.quest_broadcast_team_state()
  from public, anon, authenticated;
revoke all on function public.quest_broadcast_related_team_state()
  from public, anon, authenticated;
revoke all on function public.quest_broadcast_run_state()
  from public, anon, authenticated;

drop trigger if exists quest_realtime_team_state on public.teams;
create trigger quest_realtime_team_state
after insert or update or delete on public.teams
for each row execute function public.quest_broadcast_team_state();

drop trigger if exists quest_realtime_run_state on public.game_runs;
create trigger quest_realtime_run_state
after insert or update or delete on public.game_runs
for each row execute function public.quest_broadcast_run_state();

drop trigger if exists quest_realtime_participant_state on public.participants;
create trigger quest_realtime_participant_state
after insert or update or delete on public.participants
for each row execute function public.quest_broadcast_related_team_state();

drop trigger if exists quest_realtime_media_state on public.media_assets;
create trigger quest_realtime_media_state
after insert or update or delete on public.media_assets
for each row execute function public.quest_broadcast_related_team_state();

drop trigger if exists quest_realtime_submission_state on public.submissions;
create trigger quest_realtime_submission_state
after insert or update or delete on public.submissions
for each row execute function public.quest_broadcast_related_team_state();

-- leaderboard_entries remains the only private-schema-independent Postgres Changes
-- feed. Private gameplay tables stay outside the publication and behind RLS.
commit;
