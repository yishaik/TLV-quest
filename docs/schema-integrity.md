# Schema integrity

`supabase/migrations/` is the source of truth for the database. This document
records how that stopped being true, how it was repaired, and the gate that
keeps it true.

## What went wrong

Between 2026-07-30 and 2026-07-31 the roadmap branch behind #40 applied twelve
migrations **directly to the production Supabase project**. #40 itself was
never merged — it conflicts, and it is being mined incrementally instead. Four
harvest pull requests (#61, #63, #66, #67) landed the application code from it,
but the migration files stayed on the unmerged branch.

The result: `main` shipped code that reads and writes objects no migration in
this repository creates. Everything worked, because production already had
them. Nothing else did.

A build from `main` alone was missing:

| Object | Kind | Feature that fails without it |
|---|---|---|
| `content_import_batches` | table | bulk import (#63) |
| `content_bulk_import` | function | bulk import (#63) |
| `content_rollback_import` | function | bulk import (#63) |
| `translation_suggestions` | table | he↔en translation (#63) |
| `recap_shares` | table | shareable recap (#67) |
| `create_recap_share` | function | shareable recap (#67) |
| `revoke_recap_share` | function | shareable recap (#67) |
| `generated_epilogues` | table | AI epilogue (#67) |
| `route_generation_drafts` | table | AI route generator (#67) |
| `tenant_usage_events` | table | AI route generator (#67) |
| `tenant_memberships` | table | `lib/tenant-admin.ts` |
| `marketing_leads` | table | `/api/leads` lead capture |

Plus schema that no feature names directly but production depends on: the
`organizer_tenants` tenancy root, `tenant_id` on `game_templates` / `game_runs`
/ `organizer_invites`, the quota and usage triggers, `maintenance_runs`, six
columns on `anonymous_run_metrics`, `game_runs.metrics_recorded_at`, and the
`adaptive_difficulty_decisions` / `cross_team_events` / `operational_anomalies`
tables that P5 work will need.

Two consequences were worse than "a feature 500s":

- **`purge_expired_run_data` was silently wrong.** #40 replaced its body to
  call `private.upsert_anonymous_run_metric`. `main` still declared the
  pre-#40 body, which inserts into `anonymous_run_metrics` without
  `metric_key` — a column production made `NOT NULL`. A database rebuilt from
  `main` would fail on its first expired run, i.e. the retention path.
- **SEC-09 could not have passed.** The P0 exit criterion is a rehearsed
  restore. Restoring from this repository would have produced a database that
  cannot run the product.

`marketing_leads` deserves its own note: it exists in neither `main` nor #40.
It was created out of band and has been serving the marketing lead form ever
since. It was reconstructed here from the live catalog.

## The repair

`20260801090000_schema_parity_catch_up.sql` reconstructs everything above.

It was **not** copied on trust from #40. Every table, column, constraint, index
and trigger was read out of the live project's catalog on 2026-08-01 and the
migration was written to match, then verified by rebuilding a database from
`supabase/migrations/` alone and comparing checksums against production:

| Scope | Objects | Match |
|---|---:|---|
| Tables + functions | 102 | exact |
| Columns | 481 | exact |
| Constraints | 201 | exact |
| Indexes | 157 | exact |
| Triggers | 17 | exact |

The only trigger production has that a rebuild does not is
`realtime.subscription:tr_check_filters`, which belongs to the Realtime
service rather than to this schema.

Every statement is idempotent, so the migration is a no-op against production
and a repair everywhere else.

### One deliberate behaviour change

`rate_limit_buckets.request_count` carried `check (>= 0)` in production and
`check (> 0)` in this repository — #40 created the table first, so the later
`create table if not exists` in `20260730170000` never took effect. The
repository was aligned to production rather than the reverse: the live database
is the truth, and the difference is not load-bearing because
`consume_rate_limit` is the only writer and only ever stores `1` or
`request_count + 1`.

The rewrite is wrapped in a guard that checks the current definition first, so
it does not take an `ACCESS EXCLUSIVE` lock on a hot table for nothing.

## The gate

```bash
npm run verify:schema
```

`scripts/verify-schema.mjs` builds the database from `supabase/migrations/`
alone, then asserts that every `.from("table")` and `.rpc("function")` in
`app/`, `lib/`, `components/` and `scripts/` resolves. It reports each missing
object together with the files that use it, and exits non-zero.

It runs as its own `schema` job in CI, in parallel with `validate`, on every
pull request. Nothing in lint, unit tests, build or Playwright touches
Postgres, which is why the original drift survived five green CI runs.

By default the gate manages a throwaway `supabase/postgres` container. Point it
at your own database instead with:

```bash
SCHEMA_GATE_PSQL='psql -h 127.0.0.1 -p 5432 -U postgres -d postgres' \
  node scripts/verify-schema.mjs
```

### The CI bootstrap

`scripts/schema-gate-bootstrap.sql` supplies the three things Supabase provides
through *services* rather than through the database image: `pg_cron` / `pg_net`
(installable but not preinstalled), `realtime.send` (created by Realtime's own
migrations, stubbed to a no-op), and the `public` / `file_size_limit` /
`allowed_mime_types` columns on `storage.buckets` (added by Storage).

Nothing in that file is a migration and none of it runs against a real
environment. The gate proves the schema builds and that referenced objects
exist; it does not attempt to reproduce Realtime delivery or Storage
enforcement.

## Working rule

Schema changes belong in `supabase/migrations/`, applied from there. If
something has to be applied to the live project first — an incident, a
hand-run fix — write the matching migration in the same change. The gate now
fails the build if application code references an object the repository cannot
create, but it cannot see schema that no code references yet.
