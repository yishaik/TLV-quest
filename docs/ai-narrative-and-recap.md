# AI narrative, route generator, and shareable recap

Third harvest slice from #40 (PLY-08, RTE, P4 recap). As with the earlier
slices, the database side was already live in production — `generated_epilogues`,
`route_generation_drafts`, `recap_shares` and the `create_recap_share` /
`revoke_recap_share` RPCs existed with no application code driving them.

## Shared Gemini text helper

`lib/providers.ts` now has one private `geminiText` helper used by translation,
epilogue and route ordering. It returns `null` on any failure — unset key, HTTP
error, 15s timeout, empty candidate — because every caller produces an optional
draft with a deterministic fallback. "No model" degrades the feature; it never
breaks the screen that asked.

## Epilogue (PLY-08)

`GET/POST /api/participants/{token}/epilogue`

- Unlocks only when the team or run is `finished` (typed 409 otherwise).
- The prompt receives **aggregate stats only** (team name, score, counters) and
  forbids inventing details, so the model cannot leak locations or answers it
  was never given. Provenance is stored alongside the text.
- Deterministic bilingual fallback keeps the finale celebratory with no model.
- Rate limit `epilogue`: 3/day per participant token — an epilogue is generated
  once per finished run, retries exist for flaky networks, and each call
  reaches a paid model.
- Idempotency key is scoped `epilogue:{teamId}:{locale}:{key}`, so a retry
  returns the stored row instead of regenerating.

## Route generator (draft-only)

`POST /api/admin/content/route-generator`

Admin-only. Gemini proposes an ordering over the supplied station candidates;
`lib/route-planning.ts` provides the deterministic nearest-neighbour fallback
and re-validates every returned stationId against the candidate list, so a
hallucinated id cannot reach a route. Output lands in
`route_generation_drafts` — never directly in a published route.
Rate limit `routeGenerator`: 10/min keyed by admin email.

## Recap (P4)

- Organizer control gains `create_recap_share` / `revoke_recap_share` actions.
  The recap token **is** the idempotency key: retrying the same request returns
  the same share instead of minting a second public link.
- `GET /api/recap/{token}` + `/recap/{token}` page render the shared recap via
  `lib/recap.ts` and the deterministic replay in `lib/quest-replay.ts`.
- Shares expire (1–168h, default 72) and are revocable; the public route rate
  limit (`recap`: 30/min per token) allows a group-chat burst without letting
  one link hammer the database.

## Not harvested

`components/RouteSafetyMap.tsx` and the ContentStudioV2 wiring for the route
generator stayed behind: main's Content Studio diverged from #40's, so the
generator UI needs to be built against the current studio rather than pasted.
The API is live and testable via curl in the meantime.
