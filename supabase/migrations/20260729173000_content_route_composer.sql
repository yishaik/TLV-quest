drop index if exists public.template_versions_one_open_draft_idx;

create or replace function public.content_assert_editable_version(
  p_template_id uuid,
  p_version integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  select status
    into v_status
  from public.template_versions
  where template_id = p_template_id
    and version = p_version;

  if v_status is null then
    raise exception 'Template version was not found';
  end if;

  if v_status not in ('draft', 'review') then
    raise exception 'Published content is immutable. Create a draft first.';
  end if;
end;
$$;

create or replace function public.content_normalize_slug(p_value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(trim(coalesce(p_value, ''))), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.content_default_checkpoint_config(p_kind text)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'content', jsonb_build_object(
      'he', jsonb_build_object(
        'title', 'תחנה חדשה',
        'story', '',
        'prompt', '',
        'locationHint', '',
        'success', ''
      ),
      'en', jsonb_build_object(
        'title', 'New checkpoint',
        'story', '',
        'prompt', '',
        'locationHint', '',
        'success', ''
      )
    ),
    'interaction', jsonb_build_object(
      'primary', case
        when p_kind = 'photo' then 'photo'
        when p_kind = 'scan' then 'scan'
        when p_kind = 'location' then 'location'
        else 'web'
      end,
      'webFallback', true
    ),
    'validation', case
      when p_kind = 'photo' then jsonb_build_object(
        'type', 'photo',
        'criteria', '',
        'confidenceThreshold', 0.86
      )
      when p_kind = 'choice' then jsonb_build_object(
        'type', 'choice',
        'acceptedOption', '',
        'options', '[]'::jsonb
      )
      when p_kind = 'scan' then jsonb_build_object('type', 'scan')
      when p_kind = 'location' then jsonb_build_object('type', 'location')
      else jsonb_build_object(
        'type', 'text',
        'accepted', '[]'::jsonb,
        'fuzzyThreshold', 0.94
      )
    end,
    'hints', '[]'::jsonb,
    'scoring', jsonb_build_object(
      'basePoints', 100,
      'wrongPenalty', 5,
      'hintPenalty', 10,
      'speedBonusMax', 20,
      'speedBonusWindowSeconds', 420
    ),
    'field_verification_required', false,
    'finale', p_kind = 'finale'
  );
$$;

create or replace function public.content_create_template(
  p_slug text,
  p_title_he text,
  p_title_en text,
  p_description_he text,
  p_description_en text,
  p_actor text,
  p_brand_key text default 'tlv-quest'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template_id uuid;
  v_slug text;
begin
  v_slug := public.content_normalize_slug(p_slug);
  if v_slug = '' then
    raise exception 'Route slug is required and must use Latin letters or numbers';
  end if;

  if coalesce(trim(p_title_he), '') = '' and coalesce(trim(p_title_en), '') = '' then
    raise exception 'At least one route title is required';
  end if;

  insert into public.game_templates(
    slug,
    brand_key,
    title,
    description,
    active_version,
    is_active
  ) values (
    v_slug,
    coalesce(nullif(trim(p_brand_key), ''), 'tlv-quest'),
    jsonb_build_object(
      'he', coalesce(trim(p_title_he), ''),
      'en', coalesce(trim(p_title_en), '')
    ),
    jsonb_build_object(
      'he', coalesce(trim(p_description_he), ''),
      'en', coalesce(trim(p_description_en), '')
    ),
    1,
    false
  )
  returning id into v_template_id;

  insert into public.template_versions(
    template_id,
    version,
    status,
    release_name,
    release_notes,
    created_by,
    updated_by
  ) values (
    v_template_id,
    1,
    'draft',
    'Initial draft',
    'New route created in Content Studio.',
    p_actor,
    p_actor
  );

  insert into public.content_audit_log(
    template_id,
    version,
    actor_email,
    action,
    payload
  ) values (
    v_template_id,
    1,
    p_actor,
    'TEMPLATE_CREATED',
    jsonb_build_object('slug', v_slug)
  );

  return jsonb_build_object(
    'templateId', v_template_id,
    'version', 1,
    'slug', v_slug
  );
end;
$$;

create or replace function public.content_clone_version(
  p_template_id uuid,
  p_source_version integer,
  p_actor text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_version integer;
  v_source_status text;
begin
  select status
    into v_source_status
  from public.template_versions
  where template_id = p_template_id
    and version = p_source_version;

  if v_source_status is null then
    raise exception 'Source version was not found';
  end if;

  select greatest(
    coalesce((select max(version) from public.template_versions where template_id = p_template_id), 0),
    coalesce((select max(version) from public.template_checkpoints where template_id = p_template_id), 0)
  ) + 1
  into v_new_version;

  insert into public.template_versions(
    template_id,
    version,
    status,
    release_name,
    release_notes,
    theme,
    route_config,
    created_by,
    updated_by
  )
  select
    template_id,
    v_new_version,
    'draft',
    'Draft ' || v_new_version::text,
    'Cloned from version ' || p_source_version::text || '.',
    theme,
    route_config,
    p_actor,
    p_actor
  from public.template_versions
  where template_id = p_template_id
    and version = p_source_version;

  insert into public.template_checkpoints(
    template_id,
    version,
    slug,
    sequence_no,
    kind,
    latitude,
    longitude,
    radius_meters,
    accessibility,
    config,
    is_optional,
    is_active
  )
  select
    template_id,
    v_new_version,
    slug,
    sequence_no,
    kind,
    latitude,
    longitude,
    radius_meters,
    accessibility,
    config,
    is_optional,
    is_active
  from public.template_checkpoints
  where template_id = p_template_id
    and version = p_source_version
  order by sequence_no;

  insert into public.checkpoint_health(
    checkpoint_id,
    template_id,
    version,
    status,
    checklist,
    notes,
    updated_by
  )
  select
    checkpoint.id,
    checkpoint.template_id,
    checkpoint.version,
    case
      when coalesce((checkpoint.config ->> 'field_verification_required')::boolean, false)
        or coalesce((checkpoint.accessibility ->> 'field_verification_required')::boolean, false)
        then 'pending'
      else 'not_required'
    end,
    '{}'::jsonb,
    case
      when coalesce((checkpoint.config ->> 'field_verification_required')::boolean, false)
        or coalesce((checkpoint.accessibility ->> 'field_verification_required')::boolean, false)
        then 'Reverify after cloning version ' || p_source_version::text || '.'
      else null
    end,
    p_actor
  from public.template_checkpoints checkpoint
  where checkpoint.template_id = p_template_id
    and checkpoint.version = v_new_version;

  insert into public.content_audit_log(
    template_id,
    version,
    actor_email,
    action,
    payload
  ) values (
    p_template_id,
    v_new_version,
    p_actor,
    'VERSION_CLONED',
    jsonb_build_object('sourceVersion', p_source_version)
  );

  return v_new_version;
end;
$$;

create or replace function public.content_create_draft(
  p_template_id uuid,
  p_actor text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_version integer;
begin
  select active_version
    into v_source_version
  from public.game_templates
  where id = p_template_id;

  if v_source_version is null then
    raise exception 'Template was not found';
  end if;

  return public.content_clone_version(p_template_id, v_source_version, p_actor);
end;
$$;

create or replace function public.content_create_checkpoint(
  p_template_id uuid,
  p_version integer,
  p_slug text,
  p_kind text,
  p_actor text,
  p_after_checkpoint_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkpoint_id uuid;
  v_slug text;
  v_sequence integer;
  v_after_sequence integer;
begin
  perform public.content_assert_editable_version(p_template_id, p_version);

  if p_kind not in ('text', 'choice', 'scan', 'location', 'photo', 'hybrid', 'finale') then
    raise exception 'Unsupported checkpoint kind';
  end if;

  v_slug := public.content_normalize_slug(p_slug);
  if v_slug = '' then
    raise exception 'Checkpoint slug is required and must use Latin letters or numbers';
  end if;

  if exists (
    select 1
    from public.template_checkpoints
    where template_id = p_template_id
      and version = p_version
      and slug = v_slug
  ) then
    raise exception 'Checkpoint slug already exists in this version';
  end if;

  if p_after_checkpoint_id is not null then
    select sequence_no
      into v_after_sequence
    from public.template_checkpoints
    where id = p_after_checkpoint_id
      and template_id = p_template_id
      and version = p_version;
  end if;

  if v_after_sequence is null then
    select coalesce(max(sequence_no), 0) + 1
      into v_sequence
    from public.template_checkpoints
    where template_id = p_template_id
      and version = p_version;
  else
    v_sequence := v_after_sequence + 1;

    update public.template_checkpoints
    set sequence_no = -sequence_no - 1000000
    where template_id = p_template_id
      and version = p_version
      and sequence_no >= v_sequence;

    update public.template_checkpoints
    set sequence_no = -sequence_no - 999999
    where template_id = p_template_id
      and version = p_version
      and sequence_no < -1000000;
  end if;

  insert into public.template_checkpoints(
    template_id,
    version,
    slug,
    sequence_no,
    kind,
    latitude,
    longitude,
    radius_meters,
    accessibility,
    config,
    is_optional,
    is_active
  ) values (
    p_template_id,
    p_version,
    v_slug,
    v_sequence,
    p_kind::public.checkpoint_kind,
    null,
    null,
    case when p_kind in ('location', 'finale') then 100 else null end,
    jsonb_build_object(
      'wheelchair', true,
      'stroller', true,
      'field_verification_required', false
    ),
    public.content_default_checkpoint_config(p_kind),
    false,
    true
  )
  returning id into v_checkpoint_id;

  insert into public.checkpoint_health(
    checkpoint_id,
    template_id,
    version,
    status,
    checklist,
    updated_by
  ) values (
    v_checkpoint_id,
    p_template_id,
    p_version,
    'not_required',
    '{}'::jsonb,
    p_actor
  );

  update public.template_versions
  set updated_at = now(), updated_by = p_actor
  where template_id = p_template_id and version = p_version;

  insert into public.content_audit_log(
    template_id,
    version,
    checkpoint_id,
    actor_email,
    action,
    payload
  ) values (
    p_template_id,
    p_version,
    v_checkpoint_id,
    p_actor,
    'CHECKPOINT_CREATED',
    jsonb_build_object('slug', v_slug, 'kind', p_kind, 'sequenceNo', v_sequence)
  );

  return v_checkpoint_id;
end;
$$;

create or replace function public.content_duplicate_checkpoint(
  p_checkpoint_id uuid,
  p_actor text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.template_checkpoints%rowtype;
  v_checkpoint_id uuid;
  v_slug text;
  v_suffix integer := 2;
begin
  select *
    into v_source
  from public.template_checkpoints
  where id = p_checkpoint_id;

  if v_source.id is null then
    raise exception 'Checkpoint was not found';
  end if;

  perform public.content_assert_editable_version(v_source.template_id, v_source.version);

  v_slug := v_source.slug || '-copy';
  while exists (
    select 1
    from public.template_checkpoints
    where template_id = v_source.template_id
      and version = v_source.version
      and slug = v_slug
  ) loop
    v_slug := v_source.slug || '-copy-' || v_suffix::text;
    v_suffix := v_suffix + 1;
  end loop;

  update public.template_checkpoints
  set sequence_no = -sequence_no - 1000000
  where template_id = v_source.template_id
    and version = v_source.version
    and sequence_no > v_source.sequence_no;

  update public.template_checkpoints
  set sequence_no = -sequence_no - 999999
  where template_id = v_source.template_id
    and version = v_source.version
    and sequence_no < -1000000;

  insert into public.template_checkpoints(
    template_id,
    version,
    slug,
    sequence_no,
    kind,
    latitude,
    longitude,
    radius_meters,
    accessibility,
    config,
    is_optional,
    is_active
  ) values (
    v_source.template_id,
    v_source.version,
    v_slug,
    v_source.sequence_no + 1,
    v_source.kind,
    v_source.latitude,
    v_source.longitude,
    v_source.radius_meters,
    v_source.accessibility,
    v_source.config,
    v_source.is_optional,
    v_source.is_active
  )
  returning id into v_checkpoint_id;

  insert into public.checkpoint_health(
    checkpoint_id,
    template_id,
    version,
    status,
    checklist,
    notes,
    updated_by
  ) values (
    v_checkpoint_id,
    v_source.template_id,
    v_source.version,
    case
      when coalesce((v_source.config ->> 'field_verification_required')::boolean, false)
        or coalesce((v_source.accessibility ->> 'field_verification_required')::boolean, false)
        then 'pending'
      else 'not_required'
    end,
    '{}'::jsonb,
    'Duplicated from ' || v_source.slug || '; field verification was reset.',
    p_actor
  );

  update public.template_versions
  set updated_at = now(), updated_by = p_actor
  where template_id = v_source.template_id and version = v_source.version;

  insert into public.content_audit_log(
    template_id,
    version,
    checkpoint_id,
    actor_email,
    action,
    payload
  ) values (
    v_source.template_id,
    v_source.version,
    v_checkpoint_id,
    p_actor,
    'CHECKPOINT_DUPLICATED',
    jsonb_build_object('sourceCheckpointId', p_checkpoint_id, 'slug', v_slug)
  );

  return v_checkpoint_id;
end;
$$;

create or replace function public.content_reorder_checkpoints(
  p_template_id uuid,
  p_version integer,
  p_checkpoint_ids uuid[],
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_unique_count integer;
begin
  perform public.content_assert_editable_version(p_template_id, p_version);

  select count(*)
    into v_count
  from public.template_checkpoints
  where template_id = p_template_id
    and version = p_version;

  select count(distinct id)
    into v_unique_count
  from unnest(coalesce(p_checkpoint_ids, '{}'::uuid[])) as ids(id);

  if coalesce(array_length(p_checkpoint_ids, 1), 0) <> v_count
    or v_unique_count <> v_count
    or exists (
      select 1
      from unnest(coalesce(p_checkpoint_ids, '{}'::uuid[])) as ids(id)
      left join public.template_checkpoints checkpoint
        on checkpoint.id = ids.id
       and checkpoint.template_id = p_template_id
       and checkpoint.version = p_version
      where checkpoint.id is null
    ) then
    raise exception 'Checkpoint order must include every checkpoint exactly once';
  end if;

  update public.template_checkpoints
  set sequence_no = -sequence_no - 1000000
  where template_id = p_template_id
    and version = p_version;

  with ordered as (
    select id, ordinality::integer as sequence_no
    from unnest(p_checkpoint_ids) with ordinality as ids(id, ordinality)
  )
  update public.template_checkpoints checkpoint
  set sequence_no = ordered.sequence_no
  from ordered
  where checkpoint.id = ordered.id
    and checkpoint.template_id = p_template_id
    and checkpoint.version = p_version;

  update public.template_versions
  set updated_at = now(), updated_by = p_actor
  where template_id = p_template_id and version = p_version;

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
    'CHECKPOINTS_REORDERED',
    jsonb_build_object('checkpointIds', to_jsonb(p_checkpoint_ids))
  );

  return jsonb_build_object('checkpointIds', to_jsonb(p_checkpoint_ids));
end;
$$;

create or replace function public.content_delete_checkpoint(
  p_checkpoint_id uuid,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.template_checkpoints%rowtype;
begin
  select *
    into v_source
  from public.template_checkpoints
  where id = p_checkpoint_id;

  if v_source.id is null then
    raise exception 'Checkpoint was not found';
  end if;

  perform public.content_assert_editable_version(v_source.template_id, v_source.version);

  delete from public.template_checkpoints where id = p_checkpoint_id;

  update public.template_checkpoints
  set sequence_no = -sequence_no - 1000000
  where template_id = v_source.template_id
    and version = v_source.version;

  with ordered as (
    select id, row_number() over (order by sequence_no desc)::integer as sequence_no
    from public.template_checkpoints
    where template_id = v_source.template_id
      and version = v_source.version
  )
  update public.template_checkpoints checkpoint
  set sequence_no = ordered.sequence_no
  from ordered
  where checkpoint.id = ordered.id;

  update public.template_versions
  set updated_at = now(), updated_by = p_actor
  where template_id = v_source.template_id and version = v_source.version;

  insert into public.content_audit_log(
    template_id,
    version,
    actor_email,
    action,
    payload
  ) values (
    v_source.template_id,
    v_source.version,
    p_actor,
    'CHECKPOINT_DELETED',
    jsonb_build_object(
      'checkpointId', p_checkpoint_id,
      'slug', v_source.slug,
      'sequenceNo', v_source.sequence_no
    )
  );

  return jsonb_build_object('checkpointId', p_checkpoint_id, 'slug', v_source.slug);
end;
$$;

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

  select active_version
    into v_active_version
  from public.game_templates
  where id = p_template_id;

  if v_status = 'published' or v_active_version = p_version then
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

create or replace function public.content_delete_template(
  p_template_id uuid,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
  v_run_count integer;
  v_published_count integer;
begin
  select slug
    into v_slug
  from public.game_templates
  where id = p_template_id
  for update;

  if v_slug is null then
    raise exception 'Route was not found';
  end if;

  select count(*) into v_run_count
  from public.game_runs
  where template_id = p_template_id;

  if v_run_count > 0 then
    raise exception 'A route referenced by game runs cannot be deleted';
  end if;

  select count(*) into v_published_count
  from public.template_versions
  where template_id = p_template_id
    and status in ('published', 'superseded');

  if v_published_count > 0 then
    raise exception 'A route that has been published cannot be deleted';
  end if;

  delete from public.game_templates where id = p_template_id;

  return jsonb_build_object('templateId', p_template_id, 'slug', v_slug, 'actor', p_actor);
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
      kind in ('location'::public.checkpoint_kind, 'finale'::public.checkpoint_kind)
      or coalesce((config ->> 'field_verification_required')::boolean, false)
    )
    and (latitude is null or longitude is null or radius_meters is null or radius_meters <= 0);

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

  if jsonb_array_length(v_errors) > 0 or (v_unverified > 0 and not p_allow_unverified) then
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

revoke all on function public.content_assert_editable_version(uuid, integer) from public, anon, authenticated;
revoke all on function public.content_create_template(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.content_clone_version(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.content_create_draft(uuid, text) from public, anon, authenticated;
revoke all on function public.content_create_checkpoint(uuid, integer, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.content_duplicate_checkpoint(uuid, text) from public, anon, authenticated;
revoke all on function public.content_reorder_checkpoints(uuid, integer, uuid[], text) from public, anon, authenticated;
revoke all on function public.content_delete_checkpoint(uuid, text) from public, anon, authenticated;
revoke all on function public.content_delete_version(uuid, integer, text) from public, anon, authenticated;
revoke all on function public.content_delete_template(uuid, text) from public, anon, authenticated;
revoke all on function public.content_publish_version(uuid, integer, text, boolean) from public, anon, authenticated;

grant execute on function public.content_create_template(text, text, text, text, text, text, text) to service_role;
grant execute on function public.content_clone_version(uuid, integer, text) to service_role;
grant execute on function public.content_create_draft(uuid, text) to service_role;
grant execute on function public.content_create_checkpoint(uuid, integer, text, text, text, uuid) to service_role;
grant execute on function public.content_duplicate_checkpoint(uuid, text) to service_role;
grant execute on function public.content_reorder_checkpoints(uuid, integer, uuid[], text) to service_role;
grant execute on function public.content_delete_checkpoint(uuid, text) to service_role;
grant execute on function public.content_delete_version(uuid, integer, text) to service_role;
grant execute on function public.content_delete_template(uuid, text) to service_role;
grant execute on function public.content_publish_version(uuid, integer, text, boolean) to service_role;
