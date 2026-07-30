begin;

create table public.content_import_batches (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  version integer not null,
  idempotency_key text not null unique,
  payload_hash text not null,
  actor text not null,
  format text not null check (format in ('csv', 'json')),
  status text not null default 'applied'
    check (status in ('applied', 'rolled_back')),
  row_count integer not null check (row_count > 0),
  prior_route_stops jsonb not null default '[]'::jsonb,
  created_station_ids uuid[] not null default '{}',
  created_riddle_ids uuid[] not null default '{}',
  created_stop_ids uuid[] not null default '{}',
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  rolled_back_at timestamptz,
  rolled_back_by text,
  foreign key (template_id, version)
    references public.template_versions(template_id, version)
);

create index content_import_batches_version_idx
  on public.content_import_batches(template_id, version, created_at desc);

alter table public.content_import_batches enable row level security;
revoke all on table public.content_import_batches
  from public, anon, authenticated;
grant select, insert, update on table public.content_import_batches
  to service_role;

create or replace function public.content_bulk_import(
  p_template_id uuid,
  p_version integer,
  p_rows jsonb,
  p_actor text,
  p_idempotency_key text,
  p_format text,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_batch public.content_import_batches%rowtype;
  v_item jsonb;
  v_ordinal bigint;
  v_count integer;
  v_payload_hash text;
  v_errors jsonb := '[]'::jsonb;
  v_prior_stops jsonb;
  v_station_id uuid;
  v_riddle_id uuid;
  v_stop_id uuid;
  v_station_ids uuid[] := '{}';
  v_riddle_ids uuid[] := '{}';
  v_stop_ids uuid[] := '{}';
  v_summary jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'import_rows_must_be_array';
  end if;
  v_count := jsonb_array_length(p_rows);
  if v_count < 1 or v_count > 500 then
    raise exception 'import_row_count_invalid';
  end if;
  if p_format not in ('csv', 'json') then
    raise exception 'import_format_invalid';
  end if;
  if char_length(trim(coalesce(p_actor, ''))) < 3 then
    raise exception 'import_actor_required';
  end if;
  if char_length(trim(coalesce(p_idempotency_key, ''))) < 8 then
    raise exception 'import_idempotency_key_required';
  end if;

  perform public.content_assert_editable_version(p_template_id, p_version);
  v_payload_hash := encode(
    extensions.digest(convert_to(p_rows::text, 'UTF8'), 'sha256'),
    'hex'
  );

  if not p_dry_run then
    select * into v_batch
    from public.content_import_batches
    where idempotency_key = p_idempotency_key;
    if found then
      if v_batch.payload_hash <> v_payload_hash then
        raise exception 'import_idempotency_payload_mismatch';
      end if;
      return v_batch.summary || jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'batchId', v_batch.id,
        'status', v_batch.status
      );
    end if;
  end if;

  for v_item, v_ordinal in
    select value, ordinality
    from jsonb_array_elements(p_rows) with ordinality
  loop
    if exists (
      select 1
      from public.content_stations
      where slug = v_item -> 'station' ->> 'slug'
    ) then
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'row', v_ordinal,
        'field', 'station.slug',
        'code', 'station_slug_exists',
        'message', 'A station with this slug already exists.'
      ));
    end if;
  end loop;

  if (
    select count(*) <> count(distinct value -> 'station' ->> 'slug')
    from jsonb_array_elements(p_rows)
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'row', null,
      'field', 'station.slug',
      'code', 'duplicate_station_slug',
      'message', 'Station slugs must be unique within one import.'
    ));
  end if;
  if (
    select count(*) <> count(distinct value -> 'stop' ->> 'slug')
    from jsonb_array_elements(p_rows)
  ) then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'row', null,
      'field', 'stop.slug',
      'code', 'duplicate_stop_slug',
      'message', 'Route stop slugs must be unique within one import.'
    ));
  end if;

  if jsonb_array_length(v_errors) > 0 then
    return jsonb_build_object(
      'ok', false,
      'dryRun', p_dry_run,
      'rowCount', v_count,
      'errors', v_errors
    );
  end if;

  v_summary := jsonb_build_object(
    'ok', true,
    'dryRun', p_dry_run,
    'duplicate', false,
    'rowCount', v_count,
    'stationsCreated', v_count,
    'riddlesCreated', v_count,
    'stopsCreated', v_count,
    'errors', '[]'::jsonb
  );
  if p_dry_run then
    return v_summary;
  end if;

  select coalesce(jsonb_agg(to_jsonb(stop) order by stop.sequence_no), '[]'::jsonb)
    into v_prior_stops
  from public.content_route_stops stop
  where stop.template_id = p_template_id
    and stop.version = p_version;

  delete from public.content_route_stops
  where template_id = p_template_id
    and version = p_version;

  for v_item, v_ordinal in
    select value, ordinality
    from jsonb_array_elements(p_rows) with ordinality
  loop
    insert into public.content_stations(
      slug,
      brand_key,
      title,
      description,
      address,
      latitude,
      longitude,
      radius_meters,
      tags,
      accessibility,
      field_verification_required,
      health_status,
      status,
      created_by,
      updated_by
    ) values (
      v_item -> 'station' ->> 'slug',
      coalesce(v_item -> 'station' ->> 'brandKey', 'tlv-quest'),
      coalesce(v_item -> 'station' -> 'title', '{"he":"","en":""}'::jsonb),
      coalesce(v_item -> 'station' -> 'description', '{"he":"","en":""}'::jsonb),
      coalesce(v_item -> 'station' -> 'address', '{}'::jsonb),
      nullif(v_item -> 'station' ->> 'latitude', '')::double precision,
      nullif(v_item -> 'station' ->> 'longitude', '')::double precision,
      nullif(v_item -> 'station' ->> 'radiusMeters', '')::integer,
      array(
        select jsonb_array_elements_text(
          coalesce(v_item -> 'station' -> 'tags', '[]'::jsonb)
        )
      ),
      coalesce(v_item -> 'station' -> 'accessibility', '{}'::jsonb),
      coalesce(
        (v_item -> 'station' ->> 'fieldVerificationRequired')::boolean,
        false
      ),
      case
        when coalesce(
          (v_item -> 'station' ->> 'fieldVerificationRequired')::boolean,
          false
        ) then 'pending'
        else 'not_required'
      end,
      coalesce(v_item -> 'station' ->> 'status', 'draft'),
      p_actor,
      p_actor
    )
    returning id into v_station_id;
    v_station_ids := array_append(v_station_ids, v_station_id);

    insert into public.content_riddles(
      station_id,
      slug,
      title,
      kind,
      content,
      validation,
      hints,
      scoring,
      fallback,
      interaction,
      tags,
      status,
      created_by,
      updated_by
    ) values (
      v_station_id,
      v_item -> 'riddle' ->> 'slug',
      coalesce(v_item -> 'riddle' -> 'title', '{"he":"","en":""}'::jsonb),
      (v_item -> 'riddle' ->> 'kind')::public.checkpoint_kind,
      coalesce(v_item -> 'riddle' -> 'content', '{"he":{},"en":{}}'::jsonb),
      coalesce(v_item -> 'riddle' -> 'validation', '{}'::jsonb),
      coalesce(v_item -> 'riddle' -> 'hints', '[]'::jsonb),
      coalesce(v_item -> 'riddle' -> 'scoring', '{}'::jsonb),
      nullif(v_item -> 'riddle' -> 'fallback', 'null'::jsonb),
      coalesce(v_item -> 'riddle' -> 'interaction', '{}'::jsonb),
      array(
        select jsonb_array_elements_text(
          coalesce(v_item -> 'riddle' -> 'tags', '[]'::jsonb)
        )
      ),
      coalesce(v_item -> 'riddle' ->> 'status', 'draft'),
      p_actor,
      p_actor
    )
    returning id into v_riddle_id;
    v_riddle_ids := array_append(v_riddle_ids, v_riddle_id);

    insert into public.content_route_stops(
      template_id,
      version,
      station_id,
      riddle_id,
      slug,
      sequence_no,
      is_optional,
      is_active,
      overrides,
      created_by,
      updated_by
    ) values (
      p_template_id,
      p_version,
      v_station_id,
      v_riddle_id,
      v_item -> 'stop' ->> 'slug',
      v_ordinal::integer,
      coalesce((v_item -> 'stop' ->> 'isOptional')::boolean, false),
      coalesce((v_item -> 'stop' ->> 'isActive')::boolean, true),
      coalesce(v_item -> 'stop' -> 'overrides', '{}'::jsonb),
      p_actor,
      p_actor
    )
    returning id into v_stop_id;
    v_stop_ids := array_append(v_stop_ids, v_stop_id);
  end loop;

  perform public.content_compile_route_version(
    p_template_id,
    p_version,
    p_actor
  );

  insert into public.content_import_batches(
    template_id,
    version,
    idempotency_key,
    payload_hash,
    actor,
    format,
    row_count,
    prior_route_stops,
    created_station_ids,
    created_riddle_ids,
    created_stop_ids,
    summary
  ) values (
    p_template_id,
    p_version,
    p_idempotency_key,
    v_payload_hash,
    p_actor,
    p_format,
    v_count,
    v_prior_stops,
    v_station_ids,
    v_riddle_ids,
    v_stop_ids,
    v_summary
  )
  returning * into v_batch;

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
    'BULK_IMPORT_APPLIED',
    jsonb_build_object(
      'batchId', v_batch.id,
      'format', p_format,
      'rowCount', v_count
    )
  );

  return v_summary || jsonb_build_object(
    'batchId', v_batch.id,
    'status', v_batch.status
  );
end;
$$;

revoke all on function public.content_bulk_import(
  uuid, integer, jsonb, text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.content_bulk_import(
  uuid, integer, jsonb, text, text, text, boolean
) to service_role;

create or replace function public.content_rollback_import(
  p_batch_id uuid,
  p_actor text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_batch public.content_import_batches%rowtype;
  v_current_count integer;
begin
  select * into v_batch
  from public.content_import_batches
  where id = p_batch_id
  for update;
  if not found then raise exception 'import_batch_not_found'; end if;
  if v_batch.status = 'rolled_back' then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'batchId', v_batch.id,
      'status', v_batch.status
    );
  end if;

  perform public.content_assert_editable_version(
    v_batch.template_id,
    v_batch.version
  );
  select count(*) into v_current_count
  from public.content_route_stops
  where template_id = v_batch.template_id
    and version = v_batch.version
    and id = any(v_batch.created_stop_ids);
  if v_current_count <> cardinality(v_batch.created_stop_ids)
     or exists (
       select 1
       from public.content_route_stops
       where template_id = v_batch.template_id
         and version = v_batch.version
         and not (id = any(v_batch.created_stop_ids))
     ) then
    raise exception 'import_has_later_route_changes';
  end if;

  delete from public.content_route_stops
  where template_id = v_batch.template_id
    and version = v_batch.version;

  insert into public.content_route_stops
  select *
  from jsonb_populate_recordset(
    null::public.content_route_stops,
    v_batch.prior_route_stops
  );

  delete from public.content_riddles
  where id = any(v_batch.created_riddle_ids);
  delete from public.content_stations
  where id = any(v_batch.created_station_ids);

  perform public.content_compile_route_version(
    v_batch.template_id,
    v_batch.version,
    p_actor
  );

  update public.content_import_batches
  set status = 'rolled_back',
      rolled_back_at = now(),
      rolled_back_by = left(p_actor, 320)
  where id = v_batch.id;

  insert into public.content_audit_log(
    template_id,
    version,
    actor_email,
    action,
    payload
  ) values (
    v_batch.template_id,
    v_batch.version,
    p_actor,
    'BULK_IMPORT_ROLLED_BACK',
    jsonb_build_object('batchId', v_batch.id)
  );

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'batchId', v_batch.id,
    'status', 'rolled_back',
    'restoredStopCount', jsonb_array_length(v_batch.prior_route_stops)
  );
end;
$$;

revoke all on function public.content_rollback_import(uuid, text)
  from public, anon, authenticated;
grant execute on function public.content_rollback_import(uuid, text)
  to service_role;

commit;
