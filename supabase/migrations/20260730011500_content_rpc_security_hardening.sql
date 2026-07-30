-- Restrict all content-authoring functions to the trusted server client.
-- Content Studio authenticates admins in Next.js and calls Supabase with service_role.

alter function public.content_normalize_slug(text)
  set search_path = public, pg_temp;

alter function public.content_default_checkpoint_config(text)
  set search_path = public, pg_temp;

create index if not exists content_audit_log_checkpoint_id_idx
  on public.content_audit_log(checkpoint_id);

create index if not exists template_checkpoints_source_station_id_idx
  on public.template_checkpoints(source_station_id);

create index if not exists template_checkpoints_source_riddle_id_idx
  on public.template_checkpoints(source_riddle_id);

create index if not exists template_checkpoints_source_route_stop_id_idx
  on public.template_checkpoints(source_route_stop_id);

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'content\_%' escape '\'
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      fn.signature
    );
    execute format(
      'grant execute on function %s to service_role',
      fn.signature
    );
  end loop;
end;
$$;
