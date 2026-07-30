create extension if not exists pg_net with schema extensions;

alter table public.message_outbox
  add column if not exists lease_token uuid,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists provider_status text,
  add column if not exists provider_error_code text,
  add column if not exists delivered_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists expires_at timestamptz;

update public.message_outbox
set expires_at = created_at + interval '1 hour'
where expires_at is null;

alter table public.message_outbox
  alter column expires_at set default (clock_timestamp() + interval '1 hour'),
  alter column expires_at set not null;

update public.message_outbox
set status = 'cancelled',
    locked_at = null,
    lease_token = null,
    last_error = 'message_expired_before_worker'
where status in ('pending', 'processing', 'failed')
  and expires_at <= clock_timestamp();

create index if not exists message_outbox_pending_dispatch_idx
  on public.message_outbox (send_after, created_at)
  where status in ('pending', 'failed');

create index if not exists message_outbox_processing_lease_idx
  on public.message_outbox (locked_at)
  where status = 'processing';

create unique index if not exists message_outbox_provider_message_idx
  on public.message_outbox (provider_message_id)
  where provider_message_id is not null;

drop function if exists public.claim_outbox_batch(integer);
drop function if exists public.claim_outbox_batch(integer, uuid[]);

create function public.claim_outbox_batch(
  batch_size integer default 20,
  outbox_ids uuid[] default null
)
returns setof public.message_outbox
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.message_outbox
  set status = 'cancelled',
      locked_at = null,
      lease_token = null,
      last_error = 'message_expired'
  where status in ('pending', 'processing', 'failed')
    and expires_at <= clock_timestamp();

  update public.message_outbox
  set status = 'failed',
      locked_at = null,
      lease_token = null,
      failed_at = coalesce(failed_at, clock_timestamp()),
      last_error = coalesce(last_error, 'worker_lease_expired')
  where status = 'processing'
    and attempts >= 5
    and locked_at < clock_timestamp() - interval '5 minutes';

  return query
  with claimed as (
    select id
    from public.message_outbox
    where attempts < 5
      and expires_at > clock_timestamp()
      and (
        (
          status in ('pending', 'failed')
          and send_after <= clock_timestamp()
        )
        or (
          status = 'processing'
          and locked_at < clock_timestamp() - interval '5 minutes'
        )
      )
      and (outbox_ids is null or id = any(outbox_ids))
    order by created_at
    for update skip locked
    limit greatest(1, least(coalesce(batch_size, 20), 100))
  )
  update public.message_outbox as outbox
  set status = 'processing',
      locked_at = clock_timestamp(),
      lease_token = gen_random_uuid(),
      last_attempt_at = clock_timestamp(),
      attempts = outbox.attempts + 1
  from claimed
  where outbox.id = claimed.id
  returning outbox.*;
end;
$$;

create or replace function public.complete_outbox_attempt(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_provider_message_id text,
  p_provider_status text
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.message_outbox
  set status = 'sent',
      provider_message_id = p_provider_message_id,
      provider_status = left(p_provider_status, 40),
      provider_error_code = null,
      sent_at = coalesce(sent_at, clock_timestamp()),
      failed_at = null,
      locked_at = null,
      lease_token = null,
      last_error = null
  where id = p_outbox_id
    and lease_token = p_lease_token
    and status = 'processing';

  return found;
end;
$$;

create or replace function public.fail_outbox_attempt(
  p_outbox_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_retry_at timestamptz,
  p_terminal boolean
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.message_outbox
  set status = case when p_terminal then 'failed'::public.outbox_status
                    else 'pending'::public.outbox_status end,
      send_after = p_retry_at,
      locked_at = null,
      lease_token = null,
      last_error = left(coalesce(p_error_code, 'delivery_error'), 80),
      provider_error_code = left(coalesce(p_error_code, 'delivery_error'), 80),
      failed_at = case when p_terminal then clock_timestamp() else null end
  where id = p_outbox_id
    and lease_token = p_lease_token
    and status = 'processing';

  return found;
end;
$$;

create or replace function public.apply_outbox_provider_status(
  p_outbox_id uuid,
  p_provider_message_id text,
  p_provider_status text,
  p_error_code text default null
)
returns table (
  outbox_id uuid,
  run_id uuid,
  outbox_status text,
  attempts integer
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  return query
  update public.message_outbox as outbox
  set provider_message_id = coalesce(outbox.provider_message_id, p_provider_message_id),
      provider_status = case
        when outbox.provider_status in ('delivered', 'read')
          then outbox.provider_status
        else left(lower(p_provider_status), 40)
      end,
      provider_error_code = case
        when lower(p_provider_status) in ('failed', 'undelivered', 'canceled')
          then left(coalesce(p_error_code, 'provider_delivery_failed'), 80)
        else null
      end,
      status = case
        when outbox.provider_status in ('delivered', 'read')
          then outbox.status
        when lower(p_provider_status) in ('delivered', 'read')
          then 'sent'::public.outbox_status
        when lower(p_provider_status) in ('failed', 'undelivered', 'canceled')
          then 'failed'::public.outbox_status
        when lower(p_provider_status) in (
          'accepted', 'scheduled', 'queued', 'sending', 'sent'
        ) and outbox.status in ('pending', 'processing')
          then 'sent'::public.outbox_status
        else outbox.status
      end,
      sent_at = case
        when lower(p_provider_status) in (
          'accepted', 'scheduled', 'queued', 'sending', 'sent', 'delivered', 'read'
        ) then coalesce(outbox.sent_at, clock_timestamp())
        else outbox.sent_at
      end,
      delivered_at = case
        when lower(p_provider_status) in ('delivered', 'read')
          then coalesce(outbox.delivered_at, clock_timestamp())
        else outbox.delivered_at
      end,
      failed_at = case
        when lower(p_provider_status) in ('failed', 'undelivered', 'canceled')
          then coalesce(outbox.failed_at, clock_timestamp())
        else outbox.failed_at
      end,
      last_error = case
        when lower(p_provider_status) in ('failed', 'undelivered', 'canceled')
          then left(coalesce(p_error_code, 'provider_delivery_failed'), 80)
        when lower(p_provider_status) in (
          'accepted', 'scheduled', 'queued', 'sending', 'sent', 'delivered', 'read'
        ) then null
        else outbox.last_error
      end,
      locked_at = case
        when lower(p_provider_status) in (
          'accepted', 'scheduled', 'queued', 'sending', 'sent',
          'delivered', 'read', 'failed', 'undelivered', 'canceled'
        ) then null
        else outbox.locked_at
      end,
      lease_token = case
        when lower(p_provider_status) in (
          'accepted', 'scheduled', 'queued', 'sending', 'sent',
          'delivered', 'read', 'failed', 'undelivered', 'canceled'
        ) then null
        else outbox.lease_token
      end
  where outbox.id = p_outbox_id
    and (
      outbox.provider_message_id is null
      or outbox.provider_message_id = p_provider_message_id
    )
  returning outbox.id, outbox.run_id, outbox.status::text, outbox.attempts;
end;
$$;

create or replace function public.get_outbox_status_counts(p_run_id uuid)
returns table (
  queued bigint,
  processing bigint,
  sent bigint,
  delivered bigint,
  failed bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    count(*) filter (where status = 'pending') as queued,
    count(*) filter (where status = 'processing') as processing,
    count(*) filter (
      where status = 'sent'
        and coalesce(provider_status, '') not in ('delivered', 'read')
    ) as sent,
    count(*) filter (
      where status = 'sent'
        and provider_status in ('delivered', 'read')
    ) as delivered,
    count(*) filter (where status = 'failed') as failed
  from public.message_outbox
  where run_id = p_run_id;
$$;

create table if not exists private.outbox_worker_tokens (
  token_hash bytea primary key,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.outbox_worker_tokens
  from public, anon, authenticated, service_role;

create or replace function public.consume_outbox_worker_token(p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  update private.outbox_worker_tokens
  set consumed_at = clock_timestamp()
  where token_hash = extensions.digest(p_token, 'sha256')
    and consumed_at is null
    and expires_at > clock_timestamp();

  return found;
end;
$$;

create or replace function private.invoke_outbox_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  worker_token text;
begin
  delete from private.outbox_worker_tokens
  where expires_at < clock_timestamp() - interval '1 hour';

  worker_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.outbox_worker_tokens (token_hash, expires_at)
  values (
    extensions.digest(worker_token, 'sha256'),
    clock_timestamp() + interval '5 minutes'
  );

  perform net.http_post(
    url := 'https://play.yishaik.com/api/internal/outbox',
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || worker_token,
      'content-type', 'application/json'
    ),
    body := jsonb_build_object('source', 'supabase-cron'),
    timeout_milliseconds := 50000
  );
end;
$$;

revoke execute on function public.claim_outbox_batch(integer, uuid[])
  from public, anon, authenticated;
revoke execute on function public.complete_outbox_attempt(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.fail_outbox_attempt(uuid, uuid, text, timestamptz, boolean)
  from public, anon, authenticated;
revoke execute on function public.apply_outbox_provider_status(uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.get_outbox_status_counts(uuid)
  from public, anon, authenticated;
revoke execute on function public.consume_outbox_worker_token(text)
  from public, anon, authenticated;
revoke execute on function private.invoke_outbox_worker()
  from public, anon, authenticated, service_role;

grant execute on function public.claim_outbox_batch(integer, uuid[])
  to service_role;
grant execute on function public.complete_outbox_attempt(uuid, uuid, text, text)
  to service_role;
grant execute on function public.fail_outbox_attempt(uuid, uuid, text, timestamptz, boolean)
  to service_role;
grant execute on function public.apply_outbox_provider_status(uuid, text, text, text)
  to service_role;
grant execute on function public.get_outbox_status_counts(uuid)
  to service_role;
grant execute on function public.consume_outbox_worker_token(text)
  to service_role;
grant execute on function private.invoke_outbox_worker()
  to postgres;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'outbox-worker-every-minute'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'outbox-worker-every-minute',
  '* * * * *',
  $command$select private.invoke_outbox_worker();$command$
);
