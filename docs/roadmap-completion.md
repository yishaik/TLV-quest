# Roadmap completion record

Release candidate prepared: 2026-07-30.

This document maps the implementation to the canonical roadmap in issues
[#26](https://github.com/yishaik/TLV-quest/issues/26) through
[#33](https://github.com/yishaik/TLV-quest/issues/33). It is an evidence record,
not a production approval: the go/no-go decision remains governed by
`docs/production-runbook.md`.

## Production decision

**Current decision: NO-GO for a paid production event.**

The application, database migrations, unit/integration suite, production build,
and dependency audit pass. Two controls require an owner-approved Supabase plan
upgrade and cannot be enabled by application code:

1. Auth leaked-password protection.
2. Guaranteed backups/PITR followed by an isolated restore rehearsal.

Sentry paging ownership and the release-candidate 30-player exercise must also
be evidenced before promotion. The release is therefore deployed to Preview
first and must not be promoted merely because its build is green.

## P0 — production readiness

| ID | Status | Evidence |
|---|---|---|
| SEC-01 | Complete | Explicit service-role access model, browser-role revocations, RLS regression coverage, and `docs/security-access-model.md`. |
| SEC-02 | Complete | Fixed-search-path realtime predicate; restricted grants and authorization regression coverage. |
| SEC-03 | External gate | Supabase advisor still reports leaked-password protection on the connected Free project. |
| SEC-04 | Complete in code | Critical browser flow and signed Twilio webhook scenarios in `tests/e2e/smoke.spec.ts`; cloud release-candidate execution is part of the deployment record. |
| SEC-05 | Complete in code | Exact 30-participant/10-team idempotency race gate in `scripts/quest-load-test.mjs` and the manually approved production-like workflow. |
| SEC-06 | Complete | HMAC-keyed persistent rate limits and cooldown responses cover join, answer, hint, state, lead, realtime, media, physical-action, and worker routes. |
| SEC-07 | Configuration gate | Sentry release/error capture and worker monitor check-ins are implemented; paging ownership must be confirmed externally. |
| SEC-08 | Complete | Scheduled retention deletes storage before database metadata and records every worker stage. |
| SEC-09 | External gate | Free-plan project has no guaranteed backup/PITR control; restore rehearsal procedure is documented in the runbook. |
| SEC-10 | Complete | Anonymous aggregate run metrics exclude participant, team, run, phone, name, and media identifiers. |

The connected Supabase project reports no security or performance errors and no
performance warnings. `rls_enabled_no_policy` information notices are expected:
those tables are deliberately service-role-only. Unused-index information
notices are retained until real workload data exists.

## P1–P6 implementation map

| Epic | Delivered capability |
|---|---|
| P1 live operations | Team/presence map, stuck-team detection, reasoned audited overrides, targeted/all-team broadcast outbox and banners, delivery/retry monitor, and checkpoint go/no-go controls. |
| P2 player continuity | Distance/direction map with GPS error states, progressive costed hints, reduced-motion-aware feedback and mute, short-code/teammate-QR recovery, and team presence. |
| P3 content operations | Shared player projection preview in both languages, bilingual editing, atomic publish lint report, and idempotent CSV/JSON dry-run/import/rollback. |
| P4 recap/replay | Consent-aware media and event statistics, revocable expiring shares, and deterministic operational replay. |
| P5 product scale | Adaptive difficulty, cross-team events, audio/companion/aggregate-only epilogues, PWA/offline snapshot recovery, tenant portal/quotas/usage, anomalies, white-label branding, existing reusable riddle/field-verification flows, and review-only assisted translation. |
| P6 route authoring | Route distance/walking/safety analysis and a polygon/audience/duration/language constrained generator that stores provenance, confidence, and mandatory verification in draft-only records. |

## Related findings #17–#24

| Issue | Resolution |
|---|---|
| #17 answer disclosure | Participant state now uses an explicit allowlisted projection; accepted answers, fallback solutions, scoring rules, and unconsumed hint inventories are never serialized. |
| #18 missing rate limits | Covered by SEC-06, including structured retry timing. |
| #19 Twilio media SSRF | HTTPS Twilio API host/account path allowlist, redirect rejection, streamed byte cap, timeout, and content-type validation. |
| #20 hardcoded project URL | Removed fallback and real project reference; deployment fails clearly when required public configuration is absent. |
| #21 deny-by-default RLS | Access matrix, default privilege revocations, service-only RPCs, and browser-role tests added. |
| #22 internal error disclosure | Typed public errors plus generic bilingual unknown-error response and correlation ID; details stay in server/Sentry logs. |
| #23 dependency audit | `twilio@6.0.2` is the current registry release; audit CI, webhook regression coverage, and Dependabot are enabled. |
| #24 random idempotency | Mutations require stable client keys, the PWA client persists/reuses them, and team-concurrent submissions are deduplicated atomically. |

## Verification commands

```bash
npm run check
npx tsc --noEmit
npm run test:e2e
npm run test:load
```

The latter two run against a deployed release candidate with disposable data.
Promotion evidence should record the deployment ID/commit, test output, Sentry
release, Supabase advisor result, and cleanup of the disposable run.
