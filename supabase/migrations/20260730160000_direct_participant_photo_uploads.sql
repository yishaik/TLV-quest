create table if not exists public.photo_uploads (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.game_runs(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  checkpoint_id uuid not null references public.run_checkpoints(id) on delete cascade,
  storage_path text not null unique,
  expected_mime_type text not null
    check (expected_mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  expected_size bigint not null
    check (expected_size > 0 and expected_size <= 10485760),
  idempotency_key text not null unique,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'invalid', 'cleaning')),
  processing_started_at timestamptz,
  finalized_at timestamptz,
  expires_at timestamptz not null,
  result jsonb,
  error_code text,
  created_at timestamptz not null default now()
);

alter table public.photo_uploads enable row level security;

revoke all on public.photo_uploads from public, anon, authenticated;
grant select, insert, update, delete on public.photo_uploads to service_role;

create index if not exists photo_uploads_participant_idx
on public.photo_uploads(participant_id, created_at desc);

create index if not exists photo_uploads_expiry_idx
on public.photo_uploads(expires_at, created_at)
where status in ('pending', 'processing', 'invalid', 'cleaning');

create or replace function public.claim_expired_photo_uploads(
  p_batch_size integer default 50
)
returns table(id uuid, storage_path text)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.photo_uploads p
  where (
      (p.status = 'completed' and p.finalized_at < now() - interval '1 day')
      or p.expires_at <= now()
    )
    and exists (
      select 1
      from public.media_assets m
      where m.storage_path = p.storage_path
    );

  return query
  with candidates as (
    select p.id
    from public.photo_uploads p
    where p.expires_at < now() - interval '15 minutes'
      and (
        p.status in ('pending', 'invalid')
        or (
          p.status in ('processing', 'cleaning')
          and p.processing_started_at < now() - interval '15 minutes'
        )
      )
      and not exists (
        select 1
        from public.media_assets m
        where m.storage_path = p.storage_path
      )
    order by p.expires_at, p.created_at
    for update of p skip locked
    limit greatest(1, least(coalesce(p_batch_size, 50), 100))
  )
  update public.photo_uploads p
  set status = 'cleaning',
      processing_started_at = now()
  from candidates
  where p.id = candidates.id
  returning p.id, p.storage_path;
end;
$$;

revoke execute on function public.claim_expired_photo_uploads(integer)
from public, anon, authenticated;
grant execute on function public.claim_expired_photo_uploads(integer)
to service_role;
