# TLV Quest MVP Product Specification

## Goal

Deliver an autonomous, product-like urban quest pilot at Tel Aviv Port. An organizer receives a single-use creation link, configures a game, shares participant links and then observes rather than operates the event.

## Core journey

1. Admin creates a single-use organizer invitation.
2. Organizer completes a guided game wizard and receives secret management, registration and live-board links.
3. Participants register individually in Hebrew or English, receive a personal web link and optional Twilio Sandbox onboarding links.
4. The system creates or balances teams and starts scheduled, manually or on a rolling basis.
5. Any connected teammate can answer, request a hint, scan QR/NFC, verify location or submit a photo.
6. Atomic database transitions ensure the first valid action advances the shared team state once.
7. The live leaderboard updates without exposing precise locations or personal names.
8. The game ends automatically after the finale and exposes results for 72 hours.
9. The maintenance worker removes media from Storage, deletes operational data and retains anonymous aggregate metrics only.

## Vertical slice route

The first version contains three bilingual checkpoints:

1. **Port origin** — answer via WhatsApp or web; historical key: 1936.
2. **Pioneer crane** — QR/NFC arrival and forced-perspective team photo; deterministic fallback: 1938–1965.
3. **Reading lighthouse finale** — point-in-time location verification followed by the historical key: 1935.

All physical coordinates, signage references, walking paths and accessible alternatives are marked as requiring one field-verification walk before a public pilot.

## Technical architecture

```text
Next.js on Vercel
├── organizer wizard and emergency dashboard
├── participant PWA-style web experience
├── public live leaderboard
├── Twilio webhooks
├── signed-token APIs
└── protected maintenance worker

Supabase
├── PostgreSQL source of truth
├── atomic state-transition RPCs
├── private Storage bucket
├── Realtime sanitized leaderboard
├── RLS deny-by-default tables
└── Auth Magic Links for admins

External providers
├── Twilio WhatsApp Sandbox
├── Gemini image validation
├── Resend email abstraction
└── Sentry observability
```

## Security and privacy

- Personal links and organizer links are random opaque tokens stored only as HMAC hashes.
- Names, phone numbers and organizer contact data are encrypted with AES-256-GCM.
- The frontend never receives a Supabase secret/service key.
- Twilio webhooks validate `X-Twilio-Signature` when enabled.
- All state-changing actions use idempotency keys.
- Public database access is restricted to sanitized leaderboard rows.
- Exact locations are converted into verification results and coarse distance buckets.
- Media is private and removed before database deletion.
- External messaging is disabled by default outside configured production/test allowlists.

## MVP capacity

- Up to 30 participants.
- Up to 10 teams.
- Default team size: 3–5.
- Hebrew and English.
- Active internet connection required.

## Definition of done for the vertical slice

- CI passes lint, unit tests, production build and mobile/desktop Playwright checks.
- A game can be created through a single-use invite.
- Two or more participants can join one team and connect to the Twilio Sandbox.
- The organizer can start the run.
- One team can complete text, photo and location interactions.
- Duplicate simultaneous actions do not double-score or double-advance.
- Leaderboard changes are visible in real time.
- Outbox retries failed provider deliveries.
- A finished test run and its Storage files are deleted after a shortened retention test.
- The three field locations are verified in person before the first external pilot.
