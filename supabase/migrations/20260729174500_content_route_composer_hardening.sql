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
    jsonb_build_object('status', v_status)
  );

  return jsonb_build_object('version', p_version, 'status', v_status);
end;
$$;

create or replace function public.content_publish_version(
  p_template_id uuid,
  p_version integer,
  p_actor text,
  p_allow_unverified boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_checkpoint_count integer;
  v_missing_content integer;
  v_missing_answers integer;
  v_missing_photo_criteria integer;
  v_invalid_choices integer;
  v_finale_count integer;
  v_finale_not_last integer;
  v_location_missing integer;
  v_unverified integer;
  v_errors jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_report jsonb;
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

  if v_status not in ('draft', 'review') then
    raise exception 'Only a draft or review version can be published';
  end if;

  select count(*)
    into v_checkpoint_count
  from public.template_checkpoints
  where template_id = p_template_id
    and version = p_version
    and is_active = true;

  select count(*)
    into v_missing_content
  from public.template_checkpoints
  where template_id = p_template_id
    and version = p_version
    and is_active = true
    and (
      coalesce(config #>> '{content,he,title}', '') = ''
      or coalesce(config #>> '{content,en,title}', '') = ''
      or coalesce(config #>> '{content,he,prompt}', '') = ''
      or coalesce(config #>> '{content,en,prompt}', '') = ''
    );

  select count(*)
    into v_missing_answers
  from public.template_checkpoints
  where template_id = p_template_id
    and version = p_version
    and is_active = true
    and kind in (
      'text'::public.checkpoint_kind,
      'location'::public.checkpoint_kind,
      'hybrid'::public.checkpoint_kind,
      'finale'::public.checkpoint_kind
    )
    and case
      when jsonb_typeof(config #> '{validation,accepted}') = 'array'
        then jsonb_array_length(config #> '{validation,accepted}') = 0
      else true
    end;

  select count(*)
    into v_missing_photo_criteria
  from public.template_checkpoints
  where template_id = p_template_id
    and version = p_version
    and is_active = true
    and kind = 'photo'::public.checkpoint_kind
    and coalesce(config #>> '{validation,criteria}', '') = '';

  select count(*)
    into v_invalid_choices
  from public.template_checkpoints
  where template_id = p_template_id
    and version = p_version
    and is_active = true
    and kind = 'choice'::public.checkpoint_kind
    and (
      case
        when jsonb_typeof(config #> '{validation,options}') = 'array'
          then jsonb_array_length(config #> '{validation,options}') < 2
        else true
      end
      or coalesce(config #>> '{validation,acceptedOption}', '') = ''
      or not coalesce(
        (config #> '{validation,options}') @>
          jsonb_build_array(config #>> '{validation,acceptedOption}'),
        false
      )
    );

  select count(*)
    into v_finale_count
  from public.template_checkpoints
  where template_id = p_template_id
    and version = p_version
    and is_active = true
    and kind = 'finale'::public.checkpoint_kind;

  select count(*)
    into v_finale_not_last
  from public.template_checkpoints checkpoint
  where checkpoint.template_id = p_template_id
    and checkpoint.version = p_version
    and checkpoint.is_active = true
    and checkpoint.kind = 'finale'::public.checkpoint_kind
    and checkpoint.sequence_no <> (
      select max(sequence_no)
      from public.template_checkpoints
      where template_id = p_template_id
        and version = p_version
        and is_active = true
    );

  select count(*)
    into v_location_missing
  from public.template_checkpoints
  where template_id = p_template_id
    and version = p_version
    and is_active = true
    and (
      kind in (
        'location'::public.checkpoint_kind,
        'finale'::public.checkpoint_kind
      )
      or coalesce((config ->> 'field_verification_required')::boolean, false)
      or coalesce((accessibility ->> 'field_verification_required')::boolean, false)
    )
    and (
      latitude is null
      or longitude is null
      or radius_meters is null
      or radius_meters <= 0
    );

  select count(*)
    into v_unverified
  from public.template_checkpoints checkpoint
  left join public.checkpoint_health health
    on health.checkpoint_id = checkpoint.id
  where checkpoint.template_id = p_template_id
    and checkpoint.version = p_version
    and checkpoint.is_active = true
    and (
      coalesce((checkpoint.config ->> 'field_verification_required')::boolean, false)
      or coalesce((checkpoint.accessibility ->> 'field_verification_required')::boolean, false)
    )
    and coalesce(health.status, 'pending') <> 'verified';

  if v_checkpoint_count = 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'no_checkpoints',
      'message', 'The route must contain at least one active checkpoint.'
    ));
  end if;

  if v_missing_content > 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'missing_bilingual_content',
      'message', v_missing_content::text || ' checkpoint(s) are missing Hebrew or English title/prompt.'
    ));
  end if;

  if v_missing_answers > 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'missing_accepted_answers',
      'message', v_missing_answers::text || ' text-based checkpoint(s) have no accepted answers.'
    ));
  end if;

  if v_missing_photo_criteria > 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'missing_photo_criteria',
      'message', v_missing_photo_criteria::text || ' photo checkpoint(s) have no validation criteria.'
    ));
  end if;

  if v_invalid_choices > 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'invalid_choice_validation',
      'message', v_invalid_choices::text || ' choice checkpoint(s) have invalid options or accepted option.'
    ));
  end if;

  if v_finale_count <> 1 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'invalid_finale_count',
      'message', 'The route must contain exactly one finale.'
    ));
  end if;

  if v_finale_not_last > 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'finale_not_last',
      'message', 'The finale must be the last active checkpoint.'
    ));
  end if;

  if v_location_missing > 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code', 'missing_location',
      'message', v_location_missing::text || ' location-sensitive checkpoint(s) are missing coordinates or radius.'
    ));
  end if;

  if v_unverified > 0 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'field_verification_required',
      'message', v_unverified::text || ' checkpoint(s) still require field verification.'
    ));
  end if;

  v_report := jsonb_build_object(
    'ok', jsonb_array_length(v_errors) = 0 and (p_allow_unverified or v_unverified = 0),
    'errors', v_errors,
    'warnings', v_warnings,
    'checkpointCount', v_checkpoint_count,
    'unverifiedCount', v_unverified,
    'generatedAt', now()
  );

  update public.template_versions
  set validation_report = v_report,
      updated_at = now(),
      updated_by = p_actor
  where template_id = p_template_id
    and version = p_version;

  if jsonb_array_length(v_errors) > 0
    or (v_unverified > 0 and not p_allow_unverified) then
    return v_report;
  end if;

  update public.template_versions
  set status = 'superseded',
      updated_at = now(),
      updated_by = p_actor
  where template_id = p_template_id
    and status = 'published'
    and version <> p_version;

  update public.template_versions
  set status = 'published',
      published_at = now(),
      published_by = p_actor,
      updated_at = now(),
      updated_by = p_actor
  where template_id = p_template_id
    and version = p_version;

  update public.game_templates
  set active_version = p_version,
      is_active = true,
      updated_at = now()
  where id = p_template_id;

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
    'VERSION_PUBLISHED',
    jsonb_build_object('allowUnverified', p_allow_unverified, 'report', v_report)
  );

  return v_report;
end;
$$;

revoke all on function public.content_delete_version(uuid, integer, text)
  from public, anon, authenticated;
revoke all on function public.content_publish_version(uuid, integer, text, boolean)
  from public, anon, authenticated;
grant execute on function public.content_delete_version(uuid, integer, text)
  to service_role;
grant execute on function public.content_publish_version(uuid, integer, text, boolean)
  to service_role;
