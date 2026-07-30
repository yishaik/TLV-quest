# Production runbook

Last verified: 2026-07-30.

## Go / no-go

Before a paid event:

1. Vercel production is `READY`, the custom domain responds, and the deployed
   commit matches the approved release.
2. Supabase is `ACTIVE_HEALTHY`; security advisors have no database `WARN` or
   `ERROR` findings.
3. The route publish report has no blocking errors and every required field
   verification is complete.
4. WhatsApp signature validation is enabled and a signed inbound text, location,
   and photo test passes.
5. The worker has succeeded within ten minutes, no final-failure outbox rows
   remain, and no retention job is overdue.
6. The critical-flow and 30-player concurrency suites pass against the release
   candidate.

Do not start a paid run while any item is red.

## Live monitoring and response

- Vercel runtime errors: group by route and status for the production deployment.
- Sentry: filter by the Vercel commit release. The `tlv-quest-maintenance`
  monitor must check in every five minutes.
- Supabase: inspect `maintenance_runs`, `message_outbox`, `checkpoint_health`,
  active teams, and Realtime/presence health.
- API incidents include `x-correlation-id`; use it in Sentry and Vercel log
  searches without asking a player for private details.

Organizer recovery order:

1. Pause the run if progress or scoring integrity is uncertain.
2. Identify affected teams and the last authoritative `game_event`.
3. Use an audited override with a reason; never edit a score/team directly.
4. Retry a failed outbox row through the idempotent operator action.
5. Disable a broken checkpoint, resume, and broadcast the change.
6. End the run only if integrity cannot be restored.

## Scheduled worker and retention

The production scheduler calls `GET /api/internal/worker` every five minutes
with `Authorization: Bearer $CRON_SECRET`. A manual retry may use
`WORKER_SECRET`. The worker records every stage in `maintenance_runs`; a failed
stage produces a failed Sentry check-in and is retried on the next schedule.

The connected Vercel account was verified on 2026-07-30 as **Hobby**, which
rejects schedules more frequent than daily. No misleading daily fallback is
embedded in the release. Production remains a no-go until either Vercel Pro or
an approved external scheduler is configured at five-minute cadence and three
consecutive successful `maintenance_runs` plus Sentry check-ins are recorded.

Stages start scheduled runs, apply adaptive-difficulty decisions, issue due
hints, drain the outbox, record anonymous metrics, detect/resolve operational
anomalies, delete expired storage/database data, and clean ephemeral rows.
Database data is deleted only after the corresponding storage deletion succeeds.

To verify:

```sql
select status, stages, error_summary, started_at, finished_at
from public.maintenance_runs
order by started_at desc
limit 20;

select public.record_completed_run_metrics(100);
```

## Backup and restore ownership

Owner: project owner. Backup verification and restore approval must have a
second reviewer before the first paid event.

The Supabase organization was verified on 2026-07-30 as **Free**. That plan does
not satisfy the roadmap requirement for guaranteed daily backups or PITR.
Production remains a no-go until the project is upgraded and the following are
recorded:

- backup retention window and most recent successful backup;
- PITR recovery window and recovery point objective;
- named restore approver and operator;
- a successful isolated restore rehearsal.

Restore rehearsal after upgrade:

1. Select a recovery point before a known test event.
2. Restore to an isolated project/branch—never over the live project.
3. Apply pending migrations and compare migration history.
4. Verify counts and foreign keys for templates, runs, teams, events,
   submissions, outbox, and media metadata.
5. Exercise join, submission, leaderboard, and organizer reads without sending
   external messages.
6. Record start/end time, selected recovery point, data loss window, findings,
   and reviewer sign-off.
7. Delete the isolated restore only after evidence is retained.

## Required production configuration

- Supabase leaked-password protection enabled.
- Supabase daily backups and PITR enabled, with a completed isolated restore
  rehearsal.
- Five-minute production worker schedule on Vercel Pro or an approved external
  scheduler; three consecutive healthy executions recorded.
- `TWILIO_VALIDATE_SIGNATURES=true`.
- `CRON_SECRET` and `WORKER_SECRET` are separate random values.
- Sentry DSN, organization, project, auth token, release, and alert ownership.
- Sentry alert: any new fatal event, or API 5xx rate above 2% for five minutes,
  pages the live-run owner.
- External messaging remains disabled outside production except for explicit
  test recipients.
