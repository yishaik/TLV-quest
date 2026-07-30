# Content authoring: bulk import, assisted translation, difficulty

Three capabilities harvested from the `agent/complete-roadmap` branch (#40) onto
current `main`. Their database schema was already applied to the production
project, so before this change the tables existed with no application code
driving them.

| Capability | Code | Tables |
|---|---|---|
| Bulk import (CNT-04) | `lib/content-import.ts` | `content_import_batches` |
| Assisted translation (CNT-07) | `app/api/admin/content/translate` | `translation_suggestions` |
| Dynamic difficulty (PLY-06) | `lib/difficulty.ts` | `adaptive_difficulty_decisions` |

## Bulk import

`POST /api/admin/content/templates/{templateId}/versions/{version}/imports`

Accepts `format: "csv" | "json"`, a `content` string, and `dryRun` (defaults to
**true** — you must pass `dryRun: false` explicitly to commit). Requires an
`Idempotency-Key` header so a retried import cannot double-apply.

`lib/content-import.ts` hand-rolls its CSV parser rather than taking a
dependency: it handles quoted cells containing commas, `""` escapes, CRLF, a
UTF-8 BOM and blank lines. Headers are lowercased and spaces/hyphens collapse to
underscores, so `Station Slug` and `station-slug` both reach `station_slug`.

`contentImportCsvTemplate` is the starting point handed to authors. A test
asserts the template survives its own importer, because a broken template is a
silent trap for every new route.

### The error contract

`normalizeContentImportRows` returns `{ rows, errors }`, and **a best-effort row
is still returned next to its errors**. Callers must gate on `errors`, not on
`rows` being empty. The import route does this: any error short-circuits into
`{ ok: false, errors }` before the `content_bulk_import` RPC is called, so a
partially valid file never writes anything.

Error rows are numbered as **spreadsheet lines, counting the header** — the
first data row is row 2. This matches what an author sees in Excel or Sheets.

## Assisted translation

`POST /api/admin/content/translate` drafts a he↔en translation of player copy
and records it in `translation_suggestions` with `reviewRequired: true`.

**Translation is draft-only and never auto-applies.** `suggestTranslation` also
never throws: a missing Gemini key, an upstream error, or an empty candidate all
fall back to echoing the source text with `provider: "deterministic"`. A visible
no-op in the review UI is better than an authoring screen that dies because a
third-party API had a bad minute.

Validation failures raise typed `AppError`s. Bare `throw new Error` would be
redacted into a generic 500 by `handleRouteError` (see `error-handling.md`),
hiding the reason from the author who needs it.

## Difficulty

`lib/difficulty.ts` is pure and dependency-free: `evaluateDifficulty` maps
elapsed time, wrong attempts and hint usage onto `challenge | standard |
assisted`, and `adjustScoreForDifficulty` keeps scoring honest when a team is
moved to an easier variant.

## Rate limits

Both authoring routes are admin-only and already behind `requireAdmin`, so their
limits bound cost and runaway loops rather than abuse:

- `contentImport` — 10/min
- `contentTranslate` — 20/min, tighter because each call reaches a paid model

They key off the **authenticated admin email**, not the IP
(`enforceAdminRateLimit`). Admins share office and mobile NATs, so an IP subject
would let one editor's bulk import lock out every other editor on the network.

## Testing note

`vitest.config.ts` now mirrors the tsconfig `@/*` alias. Without it any module
importing via `@/lib/...` — most of `lib/` — was untestable: the suite failed to
resolve the module instead of reporting a real result.

## Not harvested

`requestIp` from #40 was deliberately left behind. It reads the **last**
`x-forwarded-for` entry, which on Vercel is the edge proxy rather than the
client, so every visitor would share one rate-limit bucket. `main`'s existing
`clientIpFromRequest` takes the first entry and validates it with `isIP()`.
