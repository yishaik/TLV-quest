begin;

create or replace function public.content_add_route_stop(
  p_template_id uuid,
  p_version integer,
  p_station_id uuid,
  p_riddle_id uuid,
  p_actor text,
  p_after_stop_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stop_id uuid;
  v_station_slug text;
  v_riddle_slug text;
  v_slug text;
  v_sequence integer;
  v_after_sequence integer;
  v_suffix integer := 2;
begin
  perform public.content_assert_editable_version(p_template_id, p_version);

  select station.slug, riddle.slug
    into v_station_slug, v_riddle_slug
  from public.content_stations station
  join public.content_riddles riddle on riddle.station_id = station.id
  where station.id = p_station_id and riddle.id = p_riddle_id;

  if v_station_slug is null then
    raise exception 'The selected riddle does not belong to the selected station';
  end if;

  v_slug := left(public.content_normalize_slug(v_station_slug || '-' || v_riddle_slug), 80);
  while exists (
    select 1 from public.content_route_stops
    where template_id = p_template_id and version = p_version and slug = v_slug
  ) loop
    v_slug := left(public.content_normalize_slug(v_station_slug || '-' || v_riddle_slug || '-' || v_suffix::text), 80);
    v_suffix := v_suffix + 1;
  end loop;

  if p_after_stop_id is not null then
    select sequence_no into v_after_sequence
    from public.content_route_stops
    where id = p_after_stop_id and template_id = p_template_id and version = p_version;
  end if;

  if v_after_sequence is null then
    select coalesce(max(sequence_no),0) + 1 into v_sequence
    from public.content_route_stops
    where template_id = p_template_id and version = p_version;
  else
    v_sequence := v_after_sequence + 1;

    update public.content_route_stops
    set sequence_no = sequence_no + 1000000
    where template_id = p_template_id
      and version = p_version
      and sequence_no >= v_sequence;

    update public.content_route_stops
    set sequence_no = sequence_no - 999999
    where template_id = p_template_id
      and version = p_version
      and sequence_no >= 1000000 + v_sequence;
  end if;

  insert into public.content_route_stops (
    template_id, version, station_id, riddle_id, slug, sequence_no, created_by, updated_by
  ) values (
    p_template_id, p_version, p_station_id, p_riddle_id, v_slug, v_sequence, p_actor, p_actor
  ) returning id into v_stop_id;

  perform public.content_compile_route_version(p_template_id, p_version, p_actor);

  insert into public.content_audit_log(template_id, version, actor_email, action, payload)
  values (
    p_template_id,
    p_version,
    p_actor,
    'ROUTE_STOP_ADDED',
    jsonb_build_object('routeStopId', v_stop_id, 'stationId', p_station_id, 'riddleId', p_riddle_id)
  );

  return v_stop_id;
end;
$$;

create or replace function public.content_remove_route_stop(
  p_stop_id uuid,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stop public.content_route_stops%rowtype;
begin
  select * into v_stop from public.content_route_stops where id = p_stop_id for update;
  if v_stop.id is null then raise exception 'Route stop was not found'; end if;
  perform public.content_assert_editable_version(v_stop.template_id, v_stop.version);

  delete from public.content_route_stops where id = p_stop_id;

  update public.content_route_stops
  set sequence_no = sequence_no + 1000000
  where template_id = v_stop.template_id and version = v_stop.version;

  with ordered as (
    select id, row_number() over(order by sequence_no)::integer sequence_no
    from public.content_route_stops
    where template_id = v_stop.template_id and version = v_stop.version
  )
  update public.content_route_stops stop
  set sequence_no = ordered.sequence_no,
      updated_at = now(),
      updated_by = p_actor
  from ordered
  where stop.id = ordered.id;

  perform public.content_compile_route_version(v_stop.template_id, v_stop.version, p_actor);

  return jsonb_build_object('routeStopId', p_stop_id);
end;
$$;

create or replace function public.content_reorder_route_stops(
  p_template_id uuid,
  p_version integer,
  p_stop_ids uuid[],
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
  select count(*) into v_count
  from public.content_route_stops
  where template_id = p_template_id and version = p_version;
  select count(distinct id) into v_unique_count
  from unnest(coalesce(p_stop_ids,'{}'::uuid[])) ids(id);

  if coalesce(array_length(p_stop_ids,1),0) <> v_count
    or v_unique_count <> v_count
    or exists (
      select 1
      from unnest(coalesce(p_stop_ids,'{}'::uuid[])) ids(id)
      left join public.content_route_stops stop
        on stop.id = ids.id and stop.template_id = p_template_id and stop.version = p_version
      where stop.id is null
    ) then
    raise exception 'Route order must include every stop exactly once';
  end if;

  update public.content_route_stops
  set sequence_no = sequence_no + 1000000
  where template_id = p_template_id and version = p_version;

  with ordered as (
    select id, ordinality::integer sequence_no
    from unnest(p_stop_ids) with ordinality ids(id, ordinality)
  )
  update public.content_route_stops stop
  set sequence_no = ordered.sequence_no,
      updated_at = now(),
      updated_by = p_actor
  from ordered
  where stop.id = ordered.id;

  perform public.content_compile_route_version(p_template_id, p_version, p_actor);
  return jsonb_build_object('routeStopIds', to_jsonb(p_stop_ids));
end;
$$;

commit;
