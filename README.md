# TLV Quest

A self-running urban quest platform. An organizer gets one link, configures a game in a guided wizard, shares participant links — and then watches the event rather than operating it.

**Live:** https://tlv-quest.vercel.app

The first route is a bilingual (Hebrew / English) time-capsule adventure through the Tel Aviv Port: three checkpoints, answers over WhatsApp or web, QR/NFC arrival, a forced-perspective team photo, and a location-verified finale at the Reading lighthouse.

## How a game runs

1. An admin issues a single-use organizer invitation.
2. The organizer completes the wizard and receives management, registration and live-board links.
3. Participants register in Hebrew or English, get a personal web link, and can be onboarded through the Twilio WhatsApp sandbox.
4. Teams are created or balanced. The game starts on a schedule, manually, or on a rolling basis.
5. Any connected teammate can answer, request a hint, scan QR/NFC, verify location, or submit a photo.
6. Atomic Postgres state transitions guarantee the first valid action advances shared team state exactly once.
7. The live leaderboard updates without exposing precise locations or personal names.
8. The game ends automatically after the finale; results stay available for 72 hours.
9. A maintenance worker then deletes media and operational data, retaining anonymous aggregates only.

## Stack

**Next.js on Vercel** — organizer wizard and emergency dashboard, participant web experience, public live leaderboard, Twilio webhooks, signed-token APIs, protected maintenance worker.

**Supabase** — Postgres as source of truth, atomic state-transition RPCs, private Storage bucket, Realtime for the sanitized leaderboard, deny-by-default RLS, magic-link auth for admins.

## The parts that took the longest

| Doc | What it covers |
|---|---|
| [schema-integrity](docs/schema-integrity.md) | `supabase/migrations/` is the only source of truth. `npm run verify:schema` rebuilds from migrations alone and fails the PR if app code references a table or RPC no migration creates — plus the drift that motivated the gate. |
| [security-access-model](docs/security-access-model.md) | Supabase browser-role allowlist, Realtime isolation model, credential handling, production probe. |
| [scheduled-workers](docs/scheduled-workers.md) | Outbox and maintenance workers on pg_cron inside Supabase, authenticated with single-use tokens rather than a stored secret. |
| [whatsapp-typing-indicators](docs/whatsapp-typing-indicators.md) | Twilio's public-beta typing indicator, its read-receipt side effect, and the long-running photo strategy. |
| [field-verification](docs/field-verification.md) | `/admin/field` — recording coordinates, checklists, calibration photos and answer edits on site. |
| [error-handling](docs/error-handling.md) | Public API error contract, safe `AppError` usage, correlation-ID workflow. |
| [realtime-architecture](docs/realtime-architecture.md) · [pwa-offline](docs/pwa-offline.md) | Live state propagation and offline behaviour on the participant device. |
| [dependency-security](docs/dependency-security.md) | Production audit gate, Dependabot policy, reviewed transitive overrides. |
| [production-runbook](docs/production-runbook.md) · [live-ops](docs/live-ops.md) | Go/no-go checklist, live incident response, retention behaviour, required production configuration. |

Current MVP scope is in [docs/product-spec.md](docs/product-spec.md); the full index is in [`docs/`](docs/).

## Running it

```bash
cp .env.example .env.local     # replace every placeholder
npm install
npm run dev
```

The Supabase URL and publishable key are required. There is deliberately no production-project fallback in source.

Development goes through short-lived feature branches and pull requests.

## License

MIT.
