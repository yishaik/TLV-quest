# Security access model

Last verified: 2026-07-30 against Supabase project `TLV-quest`.

## Browser-role matrix

| Surface | `anon` | `authenticated` | `service_role` |
|---|---|---|---|
| `leaderboard_entries` | `SELECT`, public policy | `SELECT`, public policy | Full |
| `quest_realtime_events` | None | `SELECT`, participant-bound RLS | Full |
| `quest_presence` | None | Team read and own-device write/delete through participant-bound RLS | Full |
| Every other `public` table | None | None | Full |
| `game-media` storage bucket | None | None | Server-mediated only |
| `private` schema | None | Only `USAGE` plus `EXECUTE` on the realtime binding predicate | Internal/service access |

The server uses a Supabase secret key. It never sends that key to the browser.
Participant API routes authenticate opaque personal tokens after applying an
HMAC and return an explicit public projection. Organizer routes do the same for
organizer tokens. Admin routes require a Supabase session whose email is in the
allowlist.

## Deny-by-default controls

- RLS is enabled on every application table.
- `anon` and `authenticated` lose table, sequence, and function privileges by
  default. Migrations re-grant only the three surfaces in the matrix.
- New tables and functions inherit revoked browser privileges through
  `ALTER DEFAULT PRIVILEGES`.
- Mutating RPCs (`apply_submission`, outbox claiming, maintenance, content
  publishing, and rate limiting) are executable only by `service_role`.
- The `SECURITY DEFINER` realtime predicate lives in `private`, has a fixed
  search path, and is callable only by `authenticated` for RLS evaluation.
- Rate-limit keys are HMACs. Raw IP addresses and participant tokens are not
  persisted.

## Regression verification

Run:

```bash
npm run test
npm run audit:prod
```

`tests/production-readiness.test.ts` guards the participant projection, Twilio
media boundary, opaque API errors, stable idempotency requirements, and database
privilege migration. `tests/private-realtime.test.ts` covers participant-bound
Realtime and presence behavior.

After every database migration, run Supabase security advisors and confirm there
are no `WARN` or `ERROR` database findings. `rls_enabled_no_policy` at `INFO` is
expected for service-role-only tables: the absence of a policy is intentional.

## Threat and privacy check

- Correct answers, photo criteria, scoring rules, fallback accepted answers,
  and hint inventories never enter participant state.
- Twilio credentials are sent only to HTTPS Twilio API hosts, only for a media
  resource belonging to the configured account, with redirects blocked.
- Unknown backend failures return a bilingual generic message and correlation
  ID. Full errors remain in Sentry/server logs.
- Personal data and media are tied to `retention_until`; metrics contain no
  participant, team, run, phone, name, or media identifiers.

