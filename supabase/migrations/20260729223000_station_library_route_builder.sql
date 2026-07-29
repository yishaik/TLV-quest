begin;

create table if not exists public.content_stations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  brand_key text not null default 'tlv-quest',
  title jsonb not null default '{"he":"","en":""}'::jsonb,
  description jsonb not null default '{"he":"","en":""}'::jsonb,
  address jsonb not null default '{}'::jsonb,
  latitude double precision,
  longitude double precision,
  radius_meters integer,
  hero_image_path text,
  hero_image_url text,
  gallery jsonb not null default '[]'::jsonb,
  tags text[] not null default '{}'::text[],
  accessibility jsonb not null default '{}'::jsonb,
  field_verification_required boolean not null default false,
  health_status text not null default 'not_required'
    check (health_status in ('not_required','pending','verified','needs_attention','blocked')),
  health_checklist jsonb not null default '{}'::jsonb,
  health_notes text,
  last_checked_at timestamptz,
  verified_at timestamptz,
  verified_by text,
  status text not null default 'draft'
    check (status in ('draft','active','archived')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (radius_meters is null or radius_meters > 0)
);

create index if not exists content_stations_status_idx
  on public.content_stations(status, updated_at desc);
create index if not exists content_stations_tags_idx
  on public.content_stations using gin(tags);

create table if not exists public.content_riddles (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.content_stations(id) on delete restrict,
  slug text not null,
  title jsonb not null default '{"he":"","en":""}'::jsonb,
  kind public.checkpoint_kind not null default 'text',
  content jsonb not null default '{"he":{},"en":{}}'::jsonb,
  validation jsonb not null default '{}'::jsonb,
  hints jsonb not null default '[]'::jsonb,
  scoring jsonb not null default '{}'::jsonb,
  fallback jsonb,
  interaction jsonb not null default '{}'::jsonb,
  hero_image_path text,
  hero_image_url text,
  tags text[] not null default '{}'::text[],
  status text not null default 'draft'
    check (status in ('draft','active','archived')),
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(station_id, slug)
);

create index if not exists content_riddles_station_idx
  on public.content_riddles(station_id, status, updated_at desc);
create index if not exists content_riddles_tags_idx
  on public.content_riddles using gin(tags);

create table if not exists public.content_route_stops (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null,
  version integer not null,
  station_id uuid not null references public.content_stations(id) on delete restrict,
  riddle_id uuid not null references public.content_riddles(id) on delete restrict,
  slug text not null,
  sequence_no integer not null,
  is_optional boolean not null default false,
  is_active boolean not null default true,
  overrides jsonb not null default '{}'::jsonb,
  created_by text,
  updated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (template_id, version)
    references public.template_versions(template_id, version) on delete cascade,
  unique(template_id, version, sequence_no),
  unique(template_id, version, slug),
  check (sequence_no > 0)
);

create index if not exists content_route_stops_station_idx
  on public.content_route_stops(station_id);
create index if not exists content_route_stops_riddle_idx
  on public.content_route_stops(riddle_id);

alter table public.template_checkpoints
  add column if not exists source_station_id uuid references public.content_stations(id) on delete set null,
  add column if not exists source_riddle_id uuid references public.content_riddles(id) on delete set null,
  add column if not exists source_route_stop_id uuid references public.content_route_stops(id) on delete set null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'content-media',
  'content-media',
  true,
  8388608,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.content_stations enable row level security;
alter table public.content_riddles enable row level security;
alter table public.content_route_stops enable row level security;

revoke all on public.content_stations from anon, authenticated;
revoke all on public.content_riddles from anon, authenticated;
revoke all on public.content_route_stops from anon, authenticated;
grant all on public.content_stations to service_role;
grant all on public.content_riddles to service_role;
grant all on public.content_route_stops to service_role;

create or replace function public.content_compile_route_version(
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
  v_count integer;
begin
  select status into v_status
  from public.template_versions
  where template_id = p_template_id and version = p_version
  for update;

  if v_status is null then
    raise exception 'Template version was not found';
  end if;
  if v_status not in ('draft','review') then
    raise exception 'Published content is immutable. Create a new draft first.';
  end if;

  if exists (
    select 1
    from public.content_route_stops stop
    join public.content_riddles riddle on riddle.id = stop.riddle_id
    where stop.template_id = p_template_id
      and stop.version = p_version
      and riddle.station_id <> stop.station_id
  ) then
    raise exception 'Every route stop must use a riddle from its selected station';
  end if;

  delete from public.template_checkpoints
  where template_id = p_template_id and version = p_version;

  insert into public.template_checkpoints (
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
    is_active,
    source_station_id,
    source_riddle_id,
    source_route_stop_id
  )
  select
    stop.template_id,
    stop.version,
    stop.slug,
    stop.sequence_no,
    riddle.kind,
    coalesce(nullif(stop.overrides ->> 'latitude','')::double precision, station.latitude),
    coalesce(nullif(stop.overrides ->> 'longitude','')::double precision, station.longitude),
    coalesce(nullif(stop.overrides ->> 'radiusMeters','')::integer, station.radius_meters),
    station.accessibility || coalesce(stop.overrides -> 'accessibility','{}'::jsonb) ||
      jsonb_build_object('field_verification_required', station.field_verification_required),
    jsonb_build_object(
      'content',
        jsonb_set(
          jsonb_set(
            coalesce(riddle.content,'{"he":{},"en":{}}'::jsonb),
            '{he,imageUrl}',
            to_jsonb(coalesce(riddle.hero_image_url, station.hero_image_url, '')),
            true
          ),
          '{en,imageUrl}',
          to_jsonb(coalesce(riddle.hero_image_url, station.hero_image_url, '')),
          true
        ),
      'validation', riddle.validation,
      'hints', riddle.hints,
      'scoring', riddle.scoring,
      'fallback', riddle.fallback,
      'interaction', riddle.interaction,
      'field_verification_required', station.field_verification_required,
      'station', jsonb_build_object(
        'id', station.id,
        'slug', station.slug,
        'title', station.title,
        'description', station.description,
        'address', station.address,
        'imageUrl', station.hero_image_url,
        'tags', station.tags
      ),
      'riddle', jsonb_build_object(
        'id', riddle.id,
        'slug', riddle.slug,
        'title', riddle.title
      )
    ) || coalesce(stop.overrides -> 'config','{}'::jsonb),
    stop.is_optional,
    stop.is_active,
    station.id,
    riddle.id,
    stop.id
  from public.content_route_stops stop
  join public.content_stations station on station.id = stop.station_id
  join public.content_riddles riddle on riddle.id = stop.riddle_id
  where stop.template_id = p_template_id
    and stop.version = p_version
  order by stop.sequence_no;

  insert into public.checkpoint_health (
    checkpoint_id,
    template_id,
    version,
    status,
    checklist,
    notes,
    last_checked_at,
    verified_at,
    verified_by,
    updated_at,
    updated_by
  )
  select
    checkpoint.id,
    checkpoint.template_id,
    checkpoint.version,
    case when station.field_verification_required
      then station.health_status else 'not_required' end,
    case when station.field_verification_required
      then station.health_checklist else '{}'::jsonb end,
    station.health_notes,
    station.last_checked_at,
    station.verified_at,
    station.verified_by,
    now(),
    p_actor
  from public.template_checkpoints checkpoint
  join public.content_stations station on station.id = checkpoint.source_station_id
  where checkpoint.template_id = p_template_id
    and checkpoint.version = p_version;

  select count(*) into v_count
  from public.template_checkpoints
  where template_id = p_template_id and version = p_version;

  update public.template_versions
  set updated_at = now(), updated_by = p_actor
  where template_id = p_template_id and version = p_version;

  insert into public.content_audit_log(template_id, version, actor_email, action, payload)
  values (
    p_template_id,
    p_version,
    p_actor,
    'ROUTE_COMPILED',
    jsonb_build_object('checkpointCount', v_count)
  );

  return jsonb_build_object('checkpointCount', v_count);
end;
$$;

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
    update public.content_route_stops set sequence_no = -sequence_no - 1000000
    where template_id = p_template_id and version = p_version and sequence_no >= v_sequence;
    update public.content_route_stops set sequence_no = -sequence_no - 999999
    where template_id = p_template_id and version = p_version and sequence_no < -1000000;
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

create or replace function public.content_update_route_stop(
  p_stop_id uuid,
  p_riddle_id uuid,
  p_slug text,
  p_is_optional boolean,
  p_is_active boolean,
  p_overrides jsonb,
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_stop public.content_route_stops%rowtype;
  v_slug text;
begin
  select * into v_stop from public.content_route_stops where id = p_stop_id for update;
  if v_stop.id is null then raise exception 'Route stop was not found'; end if;
  perform public.content_assert_editable_version(v_stop.template_id, v_stop.version);

  if not exists (
    select 1 from public.content_riddles
    where id = p_riddle_id and station_id = v_stop.station_id
  ) then
    raise exception 'The selected riddle does not belong to this station';
  end if;

  v_slug := public.content_normalize_slug(p_slug);
  if v_slug = '' then raise exception 'Route stop slug is required'; end if;

  update public.content_route_stops
  set riddle_id = p_riddle_id,
      slug = v_slug,
      is_optional = coalesce(p_is_optional, false),
      is_active = coalesce(p_is_active, true),
      overrides = coalesce(p_overrides, '{}'::jsonb),
      updated_at = now(),
      updated_by = p_actor
  where id = p_stop_id;

  perform public.content_compile_route_version(v_stop.template_id, v_stop.version, p_actor);

  return jsonb_build_object('routeStopId', p_stop_id);
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

  update public.content_route_stops set sequence_no = -sequence_no - 1000000
  where template_id = v_stop.template_id and version = v_stop.version;
  with ordered as (
    select id, row_number() over(order by sequence_no desc)::integer sequence_no
    from public.content_route_stops
    where template_id = v_stop.template_id and version = v_stop.version
  )
  update public.content_route_stops stop
  set sequence_no = ordered.sequence_no
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

  update public.content_route_stops set sequence_no = -sequence_no - 1000000
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

create or replace function public.content_recompile_station_references(
  p_station_id uuid,
  p_actor text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  v_count integer := 0;
begin
  for item in
    select distinct stop.template_id, stop.version
    from public.content_route_stops stop
    join public.template_versions version
      on version.template_id = stop.template_id and version.version = stop.version
    where stop.station_id = p_station_id and version.status in ('draft','review')
  loop
    perform public.content_compile_route_version(item.template_id, item.version, p_actor);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.content_recompile_riddle_references(
  p_riddle_id uuid,
  p_actor text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  item record;
  v_count integer := 0;
begin
  for item in
    select distinct stop.template_id, stop.version
    from public.content_route_stops stop
    join public.template_versions version
      on version.template_id = stop.template_id and version.version = stop.version
    where stop.riddle_id = p_riddle_id and version.status in ('draft','review')
  loop
    perform public.content_compile_route_version(item.template_id, item.version, p_actor);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Backfill a reusable station for every physical checkpoint identity.
insert into public.content_stations (
  slug,
  brand_key,
  title,
  description,
  latitude,
  longitude,
  radius_meters,
  accessibility,
  field_verification_required,
  health_status,
  health_checklist,
  health_notes,
  last_checked_at,
  verified_at,
  verified_by,
  status,
  created_by,
  updated_by
)
select distinct on (checkpoint.template_id, checkpoint.slug)
  left(public.content_normalize_slug(template.slug || '-' || checkpoint.slug), 80),
  template.brand_key,
  jsonb_build_object(
    'he', coalesce(checkpoint.config #>> '{content,he,title}', checkpoint.slug),
    'en', coalesce(checkpoint.config #>> '{content,en,title}', checkpoint.slug)
  ),
  jsonb_build_object(
    'he', coalesce(checkpoint.config #>> '{content,he,story}', ''),
    'en', coalesce(checkpoint.config #>> '{content,en,story}', '')
  ),
  checkpoint.latitude,
  checkpoint.longitude,
  checkpoint.radius_meters,
  checkpoint.accessibility,
  coalesce((checkpoint.config ->> 'field_verification_required')::boolean, false)
    or coalesce((checkpoint.accessibility ->> 'field_verification_required')::boolean, false),
  coalesce(health.status, 'not_required'),
  coalesce(health.checklist, '{}'::jsonb),
  health.notes,
  health.last_checked_at,
  health.verified_at,
  health.verified_by,
  'active',
  'migration',
  'migration'
from public.template_checkpoints checkpoint
join public.game_templates template on template.id = checkpoint.template_id
left join public.checkpoint_health health on health.checkpoint_id = checkpoint.id
order by checkpoint.template_id, checkpoint.slug, checkpoint.version desc
on conflict (slug) do nothing;

-- Preserve every version-specific challenge as a riddle option at the same station.
insert into public.content_riddles (
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
  status,
  created_by,
  updated_by
)
select
  station.id,
  left(public.content_normalize_slug(checkpoint.slug || '-v' || checkpoint.version::text), 80),
  jsonb_build_object(
    'he', coalesce(checkpoint.config #>> '{content,he,title}', checkpoint.slug),
    'en', coalesce(checkpoint.config #>> '{content,en,title}', checkpoint.slug)
  ),
  checkpoint.kind,
  coalesce(checkpoint.config -> 'content', '{"he":{},"en":{}}'::jsonb),
  coalesce(checkpoint.config -> 'validation', '{}'::jsonb),
  coalesce(checkpoint.config -> 'hints', '[]'::jsonb),
  coalesce(checkpoint.config -> 'scoring', '{}'::jsonb),
  checkpoint.config -> 'fallback',
  coalesce(checkpoint.config -> 'interaction', '{}'::jsonb),
  'active',
  'migration',
  'migration'
from public.template_checkpoints checkpoint
join public.game_templates template on template.id = checkpoint.template_id
join public.content_stations station
  on station.slug = left(public.content_normalize_slug(template.slug || '-' || checkpoint.slug), 80)
on conflict (station_id, slug) do nothing;

insert into public.content_route_stops (
  template_id,
  version,
  station_id,
  riddle_id,
  slug,
  sequence_no,
  is_optional,
  is_active,
  created_by,
  updated_by
)
select
  checkpoint.template_id,
  checkpoint.version,
  station.id,
  riddle.id,
  checkpoint.slug,
  checkpoint.sequence_no,
  checkpoint.is_optional,
  checkpoint.is_active,
  'migration',
  'migration'
from public.template_checkpoints checkpoint
join public.game_templates template on template.id = checkpoint.template_id
join public.content_stations station
  on station.slug = left(public.content_normalize_slug(template.slug || '-' || checkpoint.slug), 80)
join public.content_riddles riddle
  on riddle.station_id = station.id
 and riddle.slug = left(public.content_normalize_slug(checkpoint.slug || '-v' || checkpoint.version::text), 80)
on conflict (template_id, version, sequence_no) do nothing;

update public.template_checkpoints checkpoint
set source_station_id = stop.station_id,
    source_riddle_id = stop.riddle_id,
    source_route_stop_id = stop.id
from public.content_route_stops stop
where stop.template_id = checkpoint.template_id
  and stop.version = checkpoint.version
  and stop.sequence_no = checkpoint.sequence_no;

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
  select status into v_source_status
  from public.template_versions
  where template_id = p_template_id and version = p_source_version;
  if v_source_status is null then raise exception 'Source version was not found'; end if;

  select greatest(
    coalesce((select max(version) from public.template_versions where template_id = p_template_id),0),
    coalesce((select max(version) from public.template_checkpoints where template_id = p_template_id),0),
    coalesce((select max(version) from public.content_route_stops where template_id = p_template_id),0)
  ) + 1 into v_new_version;

  insert into public.template_versions(
    template_id, version, status, release_name, release_notes, theme, route_config, created_by, updated_by
  )
  select template_id, v_new_version, 'draft', 'Draft ' || v_new_version::text,
    'Cloned from version ' || p_source_version::text || '.', theme, route_config, p_actor, p_actor
  from public.template_versions
  where template_id = p_template_id and version = p_source_version;

  insert into public.content_route_stops(
    template_id, version, station_id, riddle_id, slug, sequence_no,
    is_optional, is_active, overrides, created_by, updated_by
  )
  select template_id, v_new_version, station_id, riddle_id, slug, sequence_no,
    is_optional, is_active, overrides, p_actor, p_actor
  from public.content_route_stops
  where template_id = p_template_id and version = p_source_version
  order by sequence_no;

  if exists (
    select 1 from public.content_route_stops
    where template_id = p_template_id and version = v_new_version
  ) then
    perform public.content_compile_route_version(p_template_id, v_new_version, p_actor);
  else
    insert into public.template_checkpoints(
      template_id, version, slug, sequence_no, kind, latitude, longitude, radius_meters,
      accessibility, config, is_optional, is_active
    )
    select template_id, v_new_version, slug, sequence_no, kind, latitude, longitude, radius_meters,
      accessibility, config, is_optional, is_active
    from public.template_checkpoints
    where template_id = p_template_id and version = p_source_version
    order by sequence_no;
  end if;

  insert into public.content_audit_log(template_id, version, actor_email, action, payload)
  values (
    p_template_id,
    v_new_version,
    p_actor,
    'VERSION_CLONED',
    jsonb_build_object('sourceVersion', p_source_version)
  );

  return v_new_version;
end;
$$;

-- Compile from the reusable libraries immediately before the existing publish gates run.
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
  select status into v_status
  from public.template_versions
  where template_id = p_template_id and version = p_version
  for update;

  if v_status is null then raise exception 'Template version was not found'; end if;
  if v_status not in ('draft','review') then
    raise exception 'Only a draft or review version can be published';
  end if;

  if exists (
    select 1 from public.content_route_stops
    where template_id = p_template_id and version = p_version
  ) then
    perform public.content_compile_route_version(p_template_id, p_version, p_actor);
  end if;

  select count(*) into v_checkpoint_count
  from public.template_checkpoints
  where template_id = p_template_id and version = p_version and is_active = true;

  select count(*) into v_missing_content
  from public.template_checkpoints
  where template_id = p_template_id and version = p_version and is_active = true
    and (
      coalesce(config #>> '{content,he,title}','') = ''
      or coalesce(config #>> '{content,en,title}','') = ''
      or coalesce(config #>> '{content,he,prompt}','') = ''
      or coalesce(config #>> '{content,en,prompt}','') = ''
    );

  select count(*) into v_missing_answers
  from public.template_checkpoints
  where template_id = p_template_id and version = p_version and is_active = true
    and kind in ('text','location','hybrid','finale')
    and case
      when jsonb_typeof(config #> '{validation,accepted}') = 'array'
        then jsonb_array_length(config #> '{validation,accepted}') = 0
      else true
    end;

  select count(*) into v_missing_photo_criteria
  from public.template_checkpoints
  where template_id = p_template_id and version = p_version and is_active = true
    and kind = 'photo'
    and coalesce(config #>> '{validation,criteria}','') = '';

  select count(*) into v_invalid_choices
  from public.template_checkpoints
  where template_id = p_template_id and version = p_version and is_active = true
    and kind = 'choice'
    and (
      case
        when jsonb_typeof(config #> '{validation,options}') = 'array'
          then jsonb_array_length(config #> '{validation,options}') < 2
        else true
      end
      or coalesce(config #>> '{validation,acceptedOption}','') = ''
      or not coalesce(
        (config #> '{validation,options}') @>
          jsonb_build_array(config #>> '{validation,acceptedOption}'),
        false
      )
    );

  select count(*) into v_finale_count
  from public.template_checkpoints
  where template_id = p_template_id and version = p_version and is_active = true and kind = 'finale';

  select count(*) into v_finale_not_last
  from public.template_checkpoints checkpoint
  where checkpoint.template_id = p_template_id
    and checkpoint.version = p_version
    and checkpoint.is_active = true
    and checkpoint.kind = 'finale'
    and checkpoint.sequence_no <> (
      select max(sequence_no)
      from public.template_checkpoints
      where template_id = p_template_id and version = p_version and is_active = true
    );

  select count(*) into v_location_missing
  from public.template_checkpoints
  where template_id = p_template_id and version = p_version and is_active = true
    and (
      kind in ('location','finale')
      or coalesce((config ->> 'field_verification_required')::boolean,false)
      or coalesce((accessibility ->> 'field_verification_required')::boolean,false)
    )
    and (latitude is null or longitude is null or radius_meters is null or radius_meters <= 0);

  select count(*) into v_unverified
  from public.template_checkpoints checkpoint
  left join public.checkpoint_health health on health.checkpoint_id = checkpoint.id
  where checkpoint.template_id = p_template_id
    and checkpoint.version = p_version
    and checkpoint.is_active = true
    and (
      coalesce((checkpoint.config ->> 'field_verification_required')::boolean,false)
      or coalesce((checkpoint.accessibility ->> 'field_verification_required')::boolean,false)
    )
    and coalesce(health.status,'pending') <> 'verified';

  if v_checkpoint_count = 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code','no_checkpoints','message','The route must contain at least one active checkpoint.'
    ));
  end if;
  if v_missing_content > 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code','missing_bilingual_content',
      'message',v_missing_content::text || ' checkpoint(s) are missing Hebrew or English title/prompt.'
    ));
  end if;
  if v_missing_answers > 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code','missing_accepted_answers',
      'message',v_missing_answers::text || ' text-based checkpoint(s) have no accepted answers.'
    ));
  end if;
  if v_missing_photo_criteria > 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code','missing_photo_criteria',
      'message',v_missing_photo_criteria::text || ' photo checkpoint(s) have no validation criteria.'
    ));
  end if;
  if v_invalid_choices > 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code','invalid_choice_validation',
      'message',v_invalid_choices::text || ' choice checkpoint(s) have invalid options or accepted option.'
    ));
  end if;
  if v_finale_count <> 1 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code','invalid_finale_count','message','The route must contain exactly one finale.'
    ));
  end if;
  if v_finale_not_last > 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code','finale_not_last','message','The finale must be the last active checkpoint.'
    ));
  end if;
  if v_location_missing > 0 then
    v_errors := v_errors || jsonb_build_array(jsonb_build_object(
      'code','missing_location',
      'message',v_location_missing::text || ' location-sensitive checkpoint(s) are missing coordinates or radius.'
    ));
  end if;
  if v_unverified > 0 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code','field_verification_required',
      'message',v_unverified::text || ' checkpoint(s) still require field verification.'
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
  set validation_report = v_report, updated_at = now(), updated_by = p_actor
  where template_id = p_template_id and version = p_version;

  if jsonb_array_length(v_errors) > 0 or (v_unverified > 0 and not p_allow_unverified) then
    return v_report;
  end if;

  update public.template_versions
  set status = 'superseded', updated_at = now(), updated_by = p_actor
  where template_id = p_template_id and status = 'published' and version <> p_version;

  update public.template_versions
  set status = 'published', published_at = now(), published_by = p_actor,
      updated_at = now(), updated_by = p_actor
  where template_id = p_template_id and version = p_version;

  update public.game_templates
  set active_version = p_version, is_active = true, updated_at = now()
  where id = p_template_id;

  insert into public.content_audit_log(template_id, version, actor_email, action, payload)
  values (
    p_template_id,
    p_version,
    p_actor,
    'VERSION_PUBLISHED',
    jsonb_build_object('allowUnverified', p_allow_unverified, 'report', v_report)
  );

  return v_report;
end;
$$;

commit;
