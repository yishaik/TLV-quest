# Scheduled workers

Two background workers run on a schedule. Both are driven by **pg_cron inside
the Supabase project**, not by an external scheduler.

| Job | Cadence | Endpoint | Migration |
|---|---|---|---|
| `outbox-worker-every-minute` | `* * * * *` | `/api/internal/outbox` | `20260730150000` |
| `maintenance-worker-every-five-minutes` | `*/5 * * * *` | `/api/internal/worker` | `20260801100000` |

## Why pg_cron and not Vercel

The maintenance worker was previously documented as blocked on "Vercel Pro or
an approved external scheduler". That framing was wrong in a way worth
recording, because it made a free-tier problem look like a paid one:

- Vercel's Hobby plan does cap cron at **once per day**, so Vercel genuinely
  cannot drive a five-minute job.
- But pg_cron was already running the outbox worker every minute from the same
  database, and pg_cron is **not plan-limited on Supabase**.

The scheduler gap was never a billing problem. Staying on the free tier is the
default; upgrade only when something cannot be built without it.

## What the maintenance worker does

`runMaintenanceWorker()` — starts due runs, sends due hints, drains 30 outbox
messages, cleans up abandoned photo uploads and rate-limit buckets, and runs
the retention purge. Until it was scheduled, none of that happened unless
somebody called the endpoint by hand. Retention in particular is a privacy
commitment, not a nicety.

It also reports a Sentry check-in against the `tlv-quest-maintenance` monitor,
which is configured to expect a run every five minutes with a two-minute
margin. The monitor has existed since SEC-07; this is what finally makes it
report the truth rather than a permanent miss.

## Authentication

Both endpoints accept two credentials, checked by
`authorizeWorkerRequest` in `lib/worker-auth.ts`:

1. **`WORKER_SECRET`** — a constant-time comparison, for manual invocation and
   any external caller.
2. **A single-use token** minted inside Postgres by the cron function,
   hashed into `private.outbox_worker_tokens`, valid for five minutes, and
   consumed on first use by `public.consume_outbox_worker_token`.

The second path is the point: **`WORKER_SECRET` is never stored in the
database.** The invoking functions are `security definer` and granted only to
`postgres`, so no browser role and not even `service_role` can mint a token.

One property worth stating plainly: both workers share the same token table, so
a token minted for one endpoint will authorize the other. They are both
trusted internal workers behind the same secret, so this does not cross a
privilege boundary — but it does mean the two endpoints have one trust level,
not two.

## Verifying

```sql
-- the schedule exists and is active
select jobname, schedule, active from cron.job order by jobname;

-- recent invocations and their outcome
select jobname, status, return_message, start_time
from cron.job_run_details
order by start_time desc
limit 20;
```

Three consecutive healthy maintenance runs is the P0 exit criterion. Check
them here and against the Sentry monitor, which should stop reporting missed
check-ins within ten minutes of the migration being applied.

## Changing the target URL

Both cron functions post to `https://play.yishaik.com`. The URL is hardcoded in
the migration because pg_cron has no access to Vercel's environment. If the
production hostname changes, both functions must be updated in a new migration
— there is no runtime configuration to adjust.
