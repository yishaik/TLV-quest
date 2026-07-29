create or replace function public.content_delete_version(
  p_template_id uuid,
  p_version integer,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_active_version integer;
  v_template_active boolean;
  v_run_count integer;
  v_version_count integer;
  v_replacement_version integer;
begin
  select status
    into v_status
  from public.template_versions
  where template_id = p_template_id
    and version = p_version
  for update;

  if v_status is null then
    raise exception 'Template version was not found';
  end if;

  select active_version, is_active
    into v_active_version, v_template_active
  from public.game_templates
  where id = p_template_id
  for update;

  if v_status = 'published' or (v_template_active and v_active_version = p_version) then
    raise exception 'The active published version cannot be deleted';
  end if;

  select count(*)
    into v_run_count
  from public.game_runs
  where template_id = p_template_id
    and template_version = p_version;

  if v_run_count > 0 then
    raise exception 'This version is referenced by game runs and cannot be deleted';
  end if;

  select count(*)
    into v_version_count
  from public.template_versions
  where template_id = p_template_id;

  if v_version_count <= 1 then
    raise exception 'The last version cannot be deleted. Delete the unpublished route instead.';
  end if;

  if not v_template_active and v_active_version = p_version then
    select max(version)
      into v_replacement_version
    from public.template_versions
    where template_id = p_template_id
      and version <> p_version;

    update public.game_templates
    set active_version = v_replacement_version,
        updated_at = now()
    where id = p_template_id;
  end if;

  delete from public.template_checkpoints
  where template_id = p_template_id
    and version = p_version;

  delete from public.template_versions
  where template_id = p_template_id
    and version = p_version;

  insert into public.content_audit_log(
    template_id,
    version,
    actor_email,
    action,
    payload
  ) values (
    p_template_id,
    p_version,
    p_actor,
    'VERSION_DELETED',
    jsonb_build_object(
      'status', v_status,
      'replacementVersion', v_replacement_version
    )
  );

  return jsonb_build_object(
    'version', p_version,
    'status', v_status,
    'replacementVersion', v_replacement_version
  );
end;
$$;

revoke all on function public.content_delete_version(uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.content_delete_version(uuid, integer, text)
  to service_role;
