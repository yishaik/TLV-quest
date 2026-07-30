begin;

-- Browser clients are intentionally limited to the public leaderboard and
-- participant-bound Realtime surfaces. Everything else is service-role only.
create schema if not exists private;

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables
  from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated;

revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke execute on all functions in schema public
  from public, anon, authenticated;
revoke execute on all functions in schema private
  from public, anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant select on table public.leaderboard_entries to anon, authenticated;
grant select on table public.quest_realtime_events to authenticated;
grant select, insert, update, delete on table public.quest_presence
  to authenticated;

alter table public.leaderboard_entries enable row level security;
alter table public.quest_realtime_events enable row level security;
alter table public.quest_presence enable row level security;

drop policy if exists leaderboard_public_read
  on public.leaderboard_entries;
create policy leaderboard_public_read
on public.leaderboard_entries
for select
to anon, authenticated
using (true);

-- Keep the SECURITY DEFINER predicate out of the PostgREST-exposed public
-- schema. Authenticated users can invoke only this private helper, and only
-- because the participant-bound RLS policies need it.
drop policy if exists quest_realtime_events_participant_read
  on public.quest_realtime_events;
drop policy if exists quest_presence_team_read on public.quest_presence;
drop policy if exists quest_presence_own_insert on public.quest_presence;
drop policy if exists quest_presence_own_update on public.quest_presence;
drop policy if exists quest_presence_own_delete on public.quest_presence;

drop function if exists public.quest_realtime_binding_allowed(
  uuid,
  uuid,
  uuid
);

create or replace function private.quest_realtime_binding_allowed(
  p_run_id uuid,
  p_team_id uuid default null,
  p_participant_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from public.realtime_participant_authorizations binding
    where binding.user_id = auth.uid()
      and binding.expires_at > now()
      and binding.run_id = p_run_id
      and (p_team_id is null or binding.team_id = p_team_id)
      and (
        p_participant_id is null
        or binding.participant_id = p_participant_id
      )
  );
$$;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;
revoke all on function private.quest_realtime_binding_allowed(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated;
grant execute on function private.quest_realtime_binding_allowed(
  uuid,
  uuid,
  uuid
) to authenticated;

create policy quest_realtime_events_participant_read
on public.quest_realtime_events
for select
to authenticated
using (
  private.quest_realtime_binding_allowed(run_id, team_id, null)
);

create policy quest_presence_team_read
on public.quest_presence
for select
to authenticated
using (
  private.quest_realtime_binding_allowed(run_id, team_id, null)
);

create policy quest_presence_own_insert
on public.quest_presence
for insert
to authenticated
with check (
  private.quest_realtime_binding_allowed(run_id, team_id, participant_id)
  and expires_at <= now() + interval '2 minutes'
);

create policy quest_presence_own_update
on public.quest_presence
for update
to authenticated
using (
  private.quest_realtime_binding_allowed(run_id, team_id, participant_id)
)
with check (
  private.quest_realtime_binding_allowed(run_id, team_id, participant_id)
  and expires_at <= now() + interval '2 minutes'
);

create policy quest_presence_own_delete
on public.quest_presence
for delete
to authenticated
using (
  private.quest_realtime_binding_allowed(run_id, team_id, participant_id)
);

-- Fail the migration if the effective ACL or RLS posture differs from the
-- documented allowlist. has_*_privilege also accounts for PUBLIC grants.
do $audit$
declare
  violation text;
begin
  select string_agg(format('public.%I', relation.relname), ', ')
  into violation
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'public'
    and relation.relkind in ('r', 'p')
    and not relation.relrowsecurity;

  if violation is not null then
    raise exception 'RLS is disabled on: %', violation;
  end if;

  select string_agg(
    format('%s:%I', browser_role.role_name, relation.relname),
    ', '
  )
  into violation
  from pg_class relation
  join pg_namespace namespace on namespace.oid = relation.relnamespace
  cross join (
    values ('anon'::text), ('authenticated'::text)
  ) as browser_role(role_name)
  where namespace.nspname = 'public'
    and relation.relkind in ('r', 'p', 'v', 'm', 'f')
    and (
      has_table_privilege(
        browser_role.role_name,
        relation.oid,
        'SELECT'
      ) is distinct from (
        relation.relname = 'leaderboard_entries'
        or (
          browser_role.role_name = 'authenticated'
          and relation.relname in (
            'quest_realtime_events',
            'quest_presence'
          )
        )
      )
      or has_table_privilege(
        browser_role.role_name,
        relation.oid,
        'INSERT'
      ) is distinct from (
        browser_role.role_name = 'authenticated'
        and relation.relname = 'quest_presence'
      )
      or has_table_privilege(
        browser_role.role_name,
        relation.oid,
        'UPDATE'
      ) is distinct from (
        browser_role.role_name = 'authenticated'
        and relation.relname = 'quest_presence'
      )
      or has_table_privilege(
        browser_role.role_name,
        relation.oid,
        'DELETE'
      ) is distinct from (
        browser_role.role_name = 'authenticated'
        and relation.relname = 'quest_presence'
      )
    );

  if violation is not null then
    raise exception 'Unexpected browser table privileges: %', violation;
  end if;

  select string_agg(
    format('%s:%I', browser_role.role_name, sequence.relname),
    ', '
  )
  into violation
  from pg_class sequence
  join pg_namespace namespace on namespace.oid = sequence.relnamespace
  cross join (
    values ('anon'::text), ('authenticated'::text)
  ) as browser_role(role_name)
  where namespace.nspname = 'public'
    and sequence.relkind = 'S'
    and (
      has_sequence_privilege(
        browser_role.role_name,
        sequence.oid,
        'USAGE'
      )
      or has_sequence_privilege(
        browser_role.role_name,
        sequence.oid,
        'SELECT'
      )
    );

  if violation is not null then
    raise exception 'Unexpected browser sequence privileges: %', violation;
  end if;

  select string_agg(
    format(
      '%s:%I.%I(%s)',
      browser_role.role_name,
      namespace.nspname,
      routine.proname,
      pg_get_function_identity_arguments(routine.oid)
    ),
    ', '
  )
  into violation
  from pg_proc routine
  join pg_namespace namespace on namespace.oid = routine.pronamespace
  cross join (
    values ('anon'::text), ('authenticated'::text)
  ) as browser_role(role_name)
  where namespace.nspname in ('public', 'private')
    and has_function_privilege(
      browser_role.role_name,
      routine.oid,
      'EXECUTE'
    ) is distinct from (
      browser_role.role_name = 'authenticated'
      and namespace.nspname = 'private'
      and routine.proname = 'quest_realtime_binding_allowed'
      and pg_get_function_identity_arguments(routine.oid) =
        'p_run_id uuid, p_team_id uuid, p_participant_id uuid'
    );

  if violation is not null then
    raise exception 'Unexpected browser function privileges: %', violation;
  end if;
end;
$audit$;

commit;
