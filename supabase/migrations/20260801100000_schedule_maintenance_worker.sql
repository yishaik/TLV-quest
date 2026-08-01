-- Schedule the maintenance worker from pg_cron.
--
-- SEC-07 shipped a Sentry monitor (`tlv-quest-maintenance`) that expects
-- `/api/internal/worker` to check in every five minutes, but nothing actually
-- invoked it. Retention purge, expired photo cleanup, rate-limit bucket
-- cleanup, due-run starts, due hints and run metrics therefore never ran on a
-- schedule — only when someone called the endpoint by hand.
--
-- The gap was previously written up as "needs Vercel Pro or an external
-- scheduler". It does not: Vercel's Hobby plan caps cron at once per day, but
-- pg_cron already drives the outbox worker every minute from this same
-- database, and it is not plan-limited. This reuses that mechanism.
--
-- Security note: the worker is invoked with a single-use token minted here and
-- consumed by `public.consume_outbox_worker_token`, exactly as the outbox
-- worker does. `WORKER_SECRET` is deliberately not stored in the database.
--
-- See docs/scheduled-workers.md.

begin;

create or replace function private.invoke_maintenance_worker()
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
    url := 'https://play.yishaik.com/api/internal/worker',
    headers := jsonb_build_object(
      'authorization', 'Bearer ' || worker_token,
      'content-type', 'application/json'
    ),
    body := jsonb_build_object('source', 'supabase-cron'),
    timeout_milliseconds := 50000
  );
end;
$$;

revoke execute on function private.invoke_maintenance_worker()
  from public, anon, authenticated, service_role;
grant execute on function private.invoke_maintenance_worker()
  to postgres;

do $$
declare
  existing_job record;
begin
  for existing_job in
    select jobid from cron.job
    where jobname = 'maintenance-worker-every-five-minutes'
  loop
    perform cron.unschedule(existing_job.jobid);
  end loop;
end;
$$;

select cron.schedule(
  'maintenance-worker-every-five-minutes',
  '*/5 * * * *',
  $command$select private.invoke_maintenance_worker();$command$
);

commit;
