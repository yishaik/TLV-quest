# Sentry production gate

TLV Quest uses the Vercel Git commit SHA as the Sentry release on the browser,
Node.js and Edge runtimes. When all three build credentials are present, the
Sentry build plugin creates and finalizes the release, uploads source maps and
adds the Vercel deployment to that release.

## Vercel configuration

Set these variables for Production and Preview:

- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

The build token must be server-only and have release upload access. Vercel
provides `VERCEL_GIT_COMMIT_SHA`, `VERCEL_ENV` and `VERCEL_URL`; do not manually
set a different public release. A build with missing Sentry credentials remains
deployable but logs the names of the missing variables and disables release and
source-map upload.

The authenticated `GET /api/admin/health` response exposes only safe
observability state: whether a DSN and release upload configuration exist, the
release, environment, and names of missing variables. It never exposes tokens
or the DSN value.

## Live-run error-rate alert

Create an enabled Sentry workflow named exactly `TLV Quest live-run 5xx`:

1. Project: the TLV Quest project.
2. Environment: `production`.
3. Condition: at least 5 error events in 5 minutes.
4. Filter: event tag `operational_scope` equals `live_run`.
5. Action: notify an owned team or user immediately.
6. Owner: the same on-call team or user; an unowned workflow does not pass the
   production gate.

All unexpected 5xx failures from participant, organizer, leaderboard, join and
Twilio live-run routes carry that tag, plus stable `route`, `error_code`,
`status_code` and `correlation_id` tags. The same failures increment
`tlv_quest.api.errors` for dashboards.

## Worker monitor

The maintenance worker upserts the `tlv-quest-maintenance` Sentry monitor on
each invocation. It expects a run every five minutes, allows a two-minute
margin, reports a timeout after two minutes, opens an issue on the first
failure, and resolves after the next successful check-in.

The monitor detects missing or failed invocations; it does not schedule the
worker. The schedule itself is the `maintenance-worker-every-five-minutes`
pg_cron job, documented in `docs/scheduled-workers.md`. The endpoint also
accepts `Authorization: Bearer $WORKER_SECRET` for manual invocation.

## Verification

Add `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, and `SENTRY_PROJECT` as GitHub Actions
secrets. The verification token needs release, alert, project, and monitor read
access. After a production deployment, run **Sentry production gate** with the
deployed commit SHA.

The gate fails unless all of these are true:

- that exact release exists;
- it has a `production` deploy;
- the owned, enabled, scoped frequency alert has an active notification action;
- the maintenance monitor exists and is not disabled or muted.

The same check can be run locally without printing secrets:

```bash
SENTRY_AUTH_TOKEN=... \
SENTRY_ORG=... \
SENTRY_PROJECT=... \
SENTRY_RELEASE=<production-commit-sha> \
npm run verify:sentry-production
```
