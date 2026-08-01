# TLV Quest

Autonomous urban quest platform. The first route is a teen-focused time-capsule adventure in the Tel Aviv Port.

Development happens through short-lived feature branches and pull requests. See `docs/product-spec.md` for the current MVP scope.

Copy `.env.example` to `.env.local` and replace every placeholder before
running or building the app. The Supabase URL and publishable key are required;
there is deliberately no production-project fallback in source.

Operational notes for Twilio's Public Beta typing indicator, including its
read-receipt side effect and the long-running photo strategy, are in
`docs/whatsapp-typing-indicators.md`.

The Supabase browser-role allowlist, Realtime isolation model, credential
handling, and production probe are documented in
`docs/security-access-model.md`.

The public API error contract, safe `AppError` usage, and correlation-ID
workflow are documented in `docs/error-handling.md`.

The production audit gate, Dependabot policy, and reviewed transitive
dependency overrides are documented in `docs/dependency-security.md`.

`supabase/migrations/` is the source of truth for the database. `npm run
verify:schema` rebuilds it from those files alone and fails if application code
references a table or RPC no migration creates; it runs on every pull request.
The drift this gate was built to close is documented in
`docs/schema-integrity.md`.

The outbox and maintenance workers are scheduled by pg_cron inside Supabase,
with single-use tokens rather than a stored secret. See
`docs/scheduled-workers.md`.
