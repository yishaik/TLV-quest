# Supabase Realtime architecture

## Decision

The player connects directly from the browser to Supabase Realtime. Vercel remains the authoritative HTTP API for loading protected participant state and performing game actions.

The participant link is exchanged through a protected Vercel endpoint for a short-lived Supabase Auth access token. That token is bound server-side to one participant, team and run.

Private gameplay changes are distributed through two application-owned tables:

- `quest_realtime_events` contains data-minimal wake-up rows.
- `quest_presence` contains expiring participant/device heartbeats.

Both tables use RLS based on the server-managed participant binding. They are the only protected gameplay tables added to the `supabase_realtime` publication. Full game state, answers, coordinates and private participant data remain outside Realtime and are loaded through the protected Vercel API.

The public leaderboard continues to use filtered Postgres Changes because `leaderboard_entries` is intentionally public and protected by its existing read policy.

## Player data flow

1. The player performs one initial state request.
2. The browser exchanges the participant link for a short-lived Realtime access token.
3. One shared React provider subscribes to authorized run events, team presence and the public leaderboard.
4. Database triggers insert a minimal event row after relevant gameplay changes.
5. An event causes a debounced authoritative state refresh.
6. Presence heartbeats update an expiring device row without polling game state.
7. Presence changes update team availability directly from Realtime payloads.
8. Every player component reads the same state snapshot.
9. Visibility changes, network recovery and WebSocket reconnection trigger a fresh authoritative read.

There is no recurring game-state polling. Presence uses a small periodic write because online state cannot be inferred reliably from a browser without a lease or heartbeat.

## Events covered

- team score, progress, checkpoint and status changes
- game start, pause, resume, finish and cancellation
- participant membership changes
- game events and the safe team activity feed
- photo validation and fallback availability
- optional checkpoint skipping
- hybrid scan verification
- leaderboard ranking changes

## Presence

Presence is scoped by RLS to one team. Each browser maintains a random device identifier together with the participant ID, visibility state, heartbeat time and expiry. The UI groups multiple devices belonging to the same participant and never treats Presence as authoritative game state.

A device is considered offline after its lease expires. Stale rows are ignored immediately by clients and can be removed asynchronously. Persisted gameplay activity comes from filtered `game_events` returned by the participant API.

## Security properties

- Realtime access requires a short-lived Supabase Auth JWT.
- Authorization binds `auth.uid()` to one participant, team and run with an expiry.
- RLS prevents participants from reading events or Presence outside their own run/team.
- Clients can only insert, update or delete their own Presence device rows.
- Realtime event rows are service-controlled and contain no names, phone numbers, answers, locations or checkpoint content.
- Protected state and activity are loaded through Vercel using the participant token.
- `teams`, `participants`, `submissions`, `media_assets`, `game_events` and `game_runs` remain outside the Realtime publication.
- The Supabase service key and refresh tokens are never sent to the browser.
- The participant Realtime client is isolated from Content Studio authentication sessions.

## Next realtime features

The next layer is the organizer control room: team health, stalled-team alerts, manual photo approval, checkpoint overrides and targeted announcements. Synchronized countdowns and global story events should follow only after those recovery controls exist.
