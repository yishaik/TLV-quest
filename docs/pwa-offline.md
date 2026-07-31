# PWA and offline shell

Harvested from #40 (PLY-09). Installable app shell plus a graceful offline
screen, registered from the root layout via `components/PwaRegistration.tsx`.

| Piece | File |
|---|---|
| Web manifest | `app/manifest.ts` → `/manifest.webmanifest` |
| Service worker | `public/sw.js` |
| Offline screen | `app/offline/page.tsx` |
| Registration | `components/PwaRegistration.tsx` |

## Caching policy

The important property is **what is never cached**. Participant and organizer
URLs carry secret tokens (`/play/{token}`, `/organize/{token}`, `/recap/{token}`),
so those paths get network-first with an offline fallback and are never written
to the cache — a shared or restored device must not replay someone's quest from
disk. `/api/*` and cross-origin requests are skipped entirely.

Everything else is navigate-then-cache, with static assets (`style`, `script`,
`image`, `font`) served cache-first.

## Install hardening

Shell precaching adds entries **individually** rather than via `cache.addAll()`.
`addAll` is all-or-nothing: one renamed or 404ing asset rejects the whole
install, the worker never activates, and offline support dies with no signal. A
missing asset should cost that asset, not the entire offline mode.

Bump `CACHE` (`tlv-quest-shell-v1`) when the shell changes; `activate` deletes
every cache that does not match the current name.

## Not harvested

#40's `lib/client-idempotency.ts` was left behind. `main` already has
`lib/idempotency-client.ts` (`ClientIdempotencyKeys`), which is richer — it
tracks in-flight count, resolved and uncertain states — and is already wired
into the player components. #40's version is simpler but persists keys in
`sessionStorage`, so it survives a reload where `main`'s in-memory map does not.
That persistence is worth having, but as a deliberate change to the existing
helper rather than a second competing abstraction smuggled in beside it.
