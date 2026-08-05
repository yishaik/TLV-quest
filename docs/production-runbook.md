# Production runbook

Adapted from #40 on 2026-08-01. It was **not** harvested verbatim: the original
described a system that does not exist on `main`. Corrections are marked
inline, because a runbook that is confidently wrong is worse than no runbook —
it is consulted under pressure.

## Go / no-go

Before a paid event:

1. Vercel production is `READY`, the custom domain responds, and the deployed
   commit matches the approved release.
2. Supabase is `ACTIVE_HEALTHY`; security advisors show no database `WARN` or
   `ERROR` findings.
3. The route publish report has no blocking errors and every required field
   verification is complete. `docs/field-verification.md` is currently
   **entirely unchecked** — the Tel Aviv Port walk has not been done.
4. WhatsApp signature validation is enabled and a signed inbound text,
   location, and photo test passes.
5. The maintenance worker has succeeded within the last ten minutes, no
   final-failure outbox rows remain, and no retention job is overdue.
6. The critical-flow and 30-player concurrency suites pass against the release
   candidate.

Do not start a paid run while any item is red.

## Live monitoring and response

- **Vercel** runtime errors: group by route and status for the production
  deployment.
- **Sentry**: filter by the Vercel commit release. The `tlv-quest-maintenance`
  monitor must check in every five minutes.
- **Supabase**: inspect `message_outbox`, `checkpoint_health`, active teams,
  and Realtime/presence health.
- API failures carry `x-correlation-id`. Use it in Sentry and Vercel log
  searches instead of asking a player for private details.

Organizer recovery order:

1. Pause the run if progress or scoring integrity is uncertain.
2. Identify affected teams and the last authoritative `game_event`.
3. Use an audited override with a reason; never edit a score or team directly.
4. Retry a failed outbox row through the idempotent operator action.
5. Disable a broken checkpoint, resume, and broadcast the change.
6. End the run only if integrity cannot be restored.

## Scheduled workers and retention

Both workers are driven by pg_cron inside Supabase. Full detail in
`docs/scheduled-workers.md`.

| Job | Cadence | Endpoint |
|---|---|---|
| `outbox-worker-every-minute` | `* * * * *` | `/api/internal/outbox` |
| `maintenance-worker-every-five-minutes` | `*/5 * * * *` | `/api/internal/worker` |

> **Corrected from #40.** The original said a scheduler must call the worker
> with `Authorization: Bearer $CRON_SECRET`, and that production was a no-go
> until Vercel Pro or an external scheduler was purchased. There is no
> `CRON_SECRET` in this codebase, and no upgrade is needed: pg_cron is not
> plan-limited. Manual invocation uses `WORKER_SECRET`; the schedule uses a
> single-use token minted in Postgres.

The maintenance worker stages are: expire stale runs (a run still open seven
hours after creation is cancelled if it never started, finished if it did),
start due runs, send due hints, drain 30 outbox messages, clean up abandoned
photo uploads, clean up rate-limit buckets, and purge expired runs. **Storage objects are deleted before the
database rows**, so a failure mid-purge leaves orphaned rows rather than
orphaned media.

> **Corrected from #40.** The original also listed adaptive-difficulty and
> anomaly-detection stages. Neither exists on `main`.

> **Known gap.** The original told you to verify runs by querying
> `public.maintenance_runs`. That table exists, but **no code writes to it** —
> the query returns nothing. Worker health is observable through the Sentry
> monitor and `cron.job_run_details` only. Wiring the worker to record its
> stages is unfinished work, not a step you can perform.

To verify:

```sql
-- schedules exist and are active
select jobname, schedule, active from cron.job order by jobname;

-- recent invocations and their outcome
select jobname, status, return_message, start_time
from cron.job_run_details
order by start_time desc
limit 20;

-- backfill metrics for completed runs
select public.record_completed_run_metrics(100);
```

## Backup and restore

Owner: project owner. Restore approval requires a second reviewer before the
first paid event.

The Supabase organization is on the **Free** plan, and staying there is the
default. Free provides daily backups with a limited retention window; it does
not provide point-in-time recovery.

> **Changed from #40.** The original declared production a no-go until the
> project was upgraded. That is a decision, not a fact. Upgrade when the
> recovery point objective for a paid event genuinely cannot be met by daily
> backups — not before. Until then, record the accepted data-loss window
> explicitly rather than leaving it implied.

Record before the first paid event:

- the backup retention window and the most recent successful backup;
- the accepted recovery point objective on the current plan, in hours;
- the named restore approver and operator;
- a completed isolated restore rehearsal.

Restore rehearsal:

1. Select a recovery point before a known test event.
2. Restore to an isolated project — **never over the live project**.
3. Apply pending migrations and compare migration history.
4. Verify counts and foreign keys for templates, runs, teams, events,
   submissions, outbox, and media metadata.
5. Exercise join, submission, leaderboard, and organizer reads with external
   messaging disabled.
6. Record start/end time, recovery point, data-loss window, findings, and
   reviewer sign-off.
7. Delete the isolated restore only after the evidence is retained.

A rehearsal was impossible before #68: the repository could not rebuild its own
database. `npm run verify:schema` now proves it can, which is a prerequisite
for step 3 meaning anything.

## Required production configuration

- Supabase leaked-password protection enabled. **(SEC-03, still open.)**
- Backup posture recorded per the section above, with a completed restore
  rehearsal.
- Both pg_cron schedules active, with three consecutive healthy maintenance
  runs recorded.
- `TWILIO_VALIDATE_SIGNATURES=true`.
- `WORKER_SECRET` set to a random value distinct from `ADMIN_API_SECRET`.
- Sentry DSN, organization, project, auth token, release, and a named alert
  owner.
- The Sentry workflow named exactly `TLV Quest live-run 5xx`, owned and
  enabled. `npm run verify:sentry-production` fails without it.
- External messaging disabled outside production except for explicit test
  recipients.

> **Corrected from #40.** The original required `CRON_SECRET` and
> `WORKER_SECRET` to be separate values. There is no `CRON_SECRET`.
