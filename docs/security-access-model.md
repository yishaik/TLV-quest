# Supabase access model

Last production verification: 2026-07-30.

The Supabase URL and publishable key are public browser configuration. They are
not an authorization boundary. Database grants, RLS policies, opaque quest
tokens, and server-side authorization are the boundary.

## Browser-role matrix

| Surface | `anon` | `authenticated` | `service_role` |
| --- | --- | --- | --- |
| `leaderboard_entries` | `SELECT` through the public policy | `SELECT` through the public policy | Full |
| `quest_realtime_events` | None | Participant/team-bound `SELECT` | Full |
| `quest_presence` | None | Team-bound `SELECT`; own-device writes | Full |
| Every other `public` table or view | None | None | Full |
| `private` schema | None | Only the Realtime predicate required by RLS | Internal/service access |
| `game-media` storage | Signed upload only | Signed upload only | Server-mediated |

Participant state, organizer operations, content management, lead capture, and
outbox processing go through Next.js API routes. Those routes use the Supabase
secret key only after their own token/session and authorization checks.

The generic browser client is used for Supabase Auth, public leaderboard
subscriptions, and server-issued signed Storage uploads. Quest Realtime uses a
separate non-persistent client with a short-lived participant access token.

## Deny-by-default controls

- Every application table has RLS enabled.
- Browser roles lose table, view, sequence, and function privileges by default.
- The migration re-grants only the three surfaces listed above and aborts if
  the effective privileges differ from that allowlist.
- New objects created by the `postgres` migration role inherit revoked browser
  privileges.
- `private.quest_realtime_binding_allowed` is `SECURITY DEFINER`, has a fixed
  search path, and is the only private function executable by
  `authenticated`.
- Realtime confidentiality does not depend on guessing a channel or legacy
  random topic. RLS binds each short-lived Auth user to one participant, team,
  run, and expiry.

The Supabase secret key is a full-database credential. Keep it only in encrypted
Vercel server-side environment variables, never under a `NEXT_PUBLIC_` name.
To rotate it, create/activate the replacement in Supabase, update Vercel,
redeploy and verify the server routes, then revoke the old key.

## Verification

Run the remote REST probe against the target project:

```bash
SUPABASE_URL=https://your-project-ref.supabase.co \
SUPABASE_PUBLISHABLE_KEY=your-publishable-key \
npm run test:rls-remote
```

The script permits only an empty response or a permission error for private
tables. It redacts any unexpected rows before writing CI logs. The public
leaderboard must remain readable.

The manually dispatched Realtime production smoke runs the same anonymous probe
before exercising participant-bound event reads, own presence writes, and a
foreign-team write denial. It requires an active run reserved for smoke data;
it is not run automatically on every pull request because joining mutates
production.

After every database migration, run the Supabase security advisor. An
`rls_enabled_no_policy` informational notice is expected for service-only
tables: with no browser grants and no policy, access is intentionally denied.
