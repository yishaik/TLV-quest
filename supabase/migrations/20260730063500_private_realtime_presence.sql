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

create table if not exists public.quest_realtime_events (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.game_runs(id) on delete cascade,
  team_id uuid references public.teams(id) on delete cascade,
  event_type text not null default 'state_changed',
  source text not null,
  operation text not null,
  created_at timestamptz not null default now()
);

create index if not exists quest_realtime_events_run_id_id_idx
  on public.quest_realtime_events(run_id, id desc);
create index if not exists quest_realtime_events_team_id_id_idx
  on public.quest_realtime_events(team_id, id desc);
create index if not exists quest_realtime_events_created_at_idx
  on public.quest_realtime_events(created_at);

alter table public.quest_realtime_events enable row level security;
revoke all on table public.quest_realtime_events from public, anon, authenticated;
grant select on table public.quest_realtime_events to authenticated;
grant all on table public.quest_realtime_events to service_role;

create table if not exists public.quest_presence (
  participant_id uuid not null references public.participants(id) on delete cascade,
  device_id uuid not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  run_id uuid not null references public.game_runs(id) on delete cascade,
  visible boolean not null default true,
  online_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (participant_id, device_id)
);

create index if not exists quest_presence_team_expires_idx
  on public.quest_presence(team_id, expires_at desc);
create index if not exists quest_presence_run_expires_idx
  on public.quest_presence(run_id, expires_at desc);

alter table public.quest_presence enable row level security;
revoke all on table public.quest_presence from public, anon, authenticated;
grant select, insert, update, delete on table public.quest_presence to authenticated;
grant all on table public.quest_presence to service_role;

create or replace function public.quest_realtime_binding_allowed(
  p_run_id uuid,
  p_team_id uuid default null,
  p_participant_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select exists (
    select 1
    from public.realtime_participant_authorizations binding
    where binding.user_id = auth.uid()
      and binding.expires_at > now()
      and binding.run_id = p_run_id
      and (p_team_id is null or binding.team_id = p_team_id)
      and (p_participant_id is null or binding.participant_id = p_participant_id)
  );
$$;

revoke all on function public.quest_realtime_binding_allowed(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.quest_realtime_binding_allowed(uuid, uuid, uuid)
  to authenticated;

create policy quest_realtime_events_participant_read
on public.quest_realtime_events
for select
to authenticated
using (
  public.quest_realtime_binding_allowed(run_id, team_id, null)
);

create policy quest_presence_team_read
on public.quest_presence
for select
to authenticated
using (
  public.quest_realtime_binding_allowed(run_id, team_id, null)
);

create policy quest_presence_own_insert
on public.quest_presence
for insert
to authenticated
with check (
  public.quest_realtime_binding_allowed(run_id, team_id, participant_id)
  and expires_at <= now() + interval '2 minutes'
);

create policy quest_presence_own_update
on public.quest_presence
for update
to authenticated
using (
  public.quest_realtime_binding_allowed(run_id, team_id, participant_id)
)
with check (
  public.quest_realtime_binding_allowed(run_id, team_id, participant_id)
  and expires_at <= now() + interval '2 minutes'
);

create policy quest_presence_own_delete
on public.quest_presence
for delete
to authenticated
using (
  public.quest_realtime_binding_allowed(run_id, team_id, participant_id)
);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'quest_realtime_events'
  ) then
    alter publication supabase_realtime add table public.quest_realtime_events;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'quest_presence'
  ) then
    alter publication supabase_realtime add table public.quest_presence;
  end if;
end;
$$;

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
begin
  insert into public.quest_realtime_events(
    run_id,
    team_id,
    source,
    operation
  ) values (
    p_run_id,
    p_team_id,
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

create or replace function public.quest_broadcast_team_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run_id uuid;
  v_team_id uuid;
begin
  v_run_id := case when tg_op = 'DELETE' then old.run_id else new.run_id end;
  v_team_id := case when tg_op = 'DELETE' then old.id else new.id end;
  perform public.quest_emit_realtime_event(v_run_id, v_team_id, tg_table_name, tg_op);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.quest_broadcast_related_team_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_team_id uuid;
  v_new_team_id uuid;
  v_team_id uuid;
  v_run_id uuid;
begin
  if tg_op <> 'INSERT' then
    v_old_team_id := nullif(to_jsonb(old) ->> 'team_id', '')::uuid;
  end if;
  if tg_op <> 'DELETE' then
    v_new_team_id := nullif(to_jsonb(new) ->> 'team_id', '')::uuid;
  end if;

  for v_team_id in
    select distinct candidate
    from unnest(array[v_old_team_id, v_new_team_id]) candidate
    where candidate is not null
  loop
    select team.run_id into v_run_id
    from public.teams team
    where team.id = v_team_id;

    if v_run_id is not null then
      perform public.quest_emit_realtime_event(
        v_run_id,
        v_team_id,
        tg_table_name,
        tg_op
      );
    end if;
  end loop;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.quest_broadcast_run_state()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run_id uuid;
begin
  v_run_id := case when tg_op = 'DELETE' then old.id else new.id end;
  perform public.quest_emit_realtime_event(v_run_id, null, tg_table_name, tg_op);
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
