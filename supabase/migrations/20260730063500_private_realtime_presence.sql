begin;

create table if not exists public.realtime_participant_authorizations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  participant_id uuid not null unique references public.participants(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  run_id uuid not null references public.game_runs(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.realtime_participant_authorizations is
  'Server-managed bindings between short-lived Supabase Auth users and quest participants.';

create index if not exists realtime_participant_authorizations_team_idx
  on public.realtime_participant_authorizations(team_id);
create index if not exists realtime_participant_authorizations_run_idx
  on public.realtime_participant_authorizations(run_id);
create index if not exists realtime_participant_authorizations_expires_idx
  on public.realtime_participant_authorizations(expires_at);

alter table public.realtime_participant_authorizations enable row level security;
revoke all on table public.realtime_participant_authorizations
  from public, anon, authenticated;
grant all on table public.realtime_participant_authorizations to service_role;

create or replace function public.quest_realtime_topic_allowed(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public, auth, realtime, pg_temp
as $$
  select exists (
    select 1
    from public.realtime_participant_authorizations authorization
    join public.teams team
      on team.id = authorization.team_id
     and team.run_id = authorization.run_id
    join public.game_runs run
      on run.id = authorization.run_id
    where authorization.user_id = auth.uid()
      and authorization.expires_at > now()
      and run.status <> 'cancelled'::public.game_status
      and p_topic in (
        'team:' || team.realtime_topic,
        'run:' || run.realtime_topic
      )
  );
$$;

revoke all on function public.quest_realtime_topic_allowed(text)
  from public, anon;
grant execute on function public.quest_realtime_topic_allowed(text)
  to authenticated;

alter table realtime.messages enable row level security;

drop policy if exists quest_participant_receive_realtime on realtime.messages;
create policy quest_participant_receive_realtime
on realtime.messages
for select
to authenticated
using (
  realtime.messages.extension in ('broadcast', 'presence')
  and public.quest_realtime_topic_allowed((select realtime.topic()))
);

drop policy if exists quest_participant_publish_presence on realtime.messages;
create policy quest_participant_publish_presence
on realtime.messages
for insert
to authenticated
with check (
  realtime.messages.extension = 'presence'
  and public.quest_realtime_topic_allowed((select realtime.topic()))
);

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
    true
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
      true
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
    true
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

drop trigger if exists quest_realtime_event_state on public.game_events;
create trigger quest_realtime_event_state
after insert or update or delete on public.game_events
for each row execute function public.quest_broadcast_related_team_state();

commit;
