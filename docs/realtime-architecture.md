# Supabase Realtime architecture

## Decision

The player connects directly from the browser to Supabase Realtime. Vercel remains the authoritative HTTP API for loading protected participant state and performing game actions.

Private gameplay tables are not exposed through Postgres Changes. The participant link is exchanged through a protected Vercel endpoint for a short-lived Supabase Auth access token. That token is bound server-side to one participant, team and run. Realtime Authorization policies permit only the matching private team and run topics.

Broadcast payloads are intentionally data-minimal and contain only the source table, operation and timestamp. After receiving a signal, the browser reloads authoritative state through the protected participant API.

The public leaderboard continues to use filtered Postgres Changes because `leaderboard_entries` is intentionally public and protected by its existing read policy.

## Player data flow

1. The player performs one initial state request.
2. The response contains opaque team and run topics.
3. The browser exchanges the participant link for a short-lived Realtime access token.
4. One shared React provider joins private team and run Broadcast channels.
5. The team channel also publishes Presence for the participant and device.
6. Database changes cause a debounced authoritative state refresh.
7. Every player component reads the same state snapshot.
8. Visibility changes, network recovery and WebSocket reconnection trigger a fresh read.

There is no recurring state polling. Token renewal and stale-connection timers do not fetch game state unless a reconnect or event requires it.

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

Presence is scoped to the private team topic. Each browser tracks a random device identifier together with the participant ID, first name, visibility state and connection timestamp. The UI groups multiple devices belonging to the same participant and never treats Presence as authoritative game state.

Presence is ephemeral. Persisted activity comes from filtered `game_events` returned by the participant API.

## Security properties

- private channels require a Supabase Auth JWT and Realtime RLS authorization
- authorization binds `auth.uid()` to one participant, team and run with an expiry
- team and run topics are random and returned only by the token-protected state API
- Broadcast messages contain no player names, phone numbers, answers, locations or checkpoint content
- protected state and activity are loaded through Vercel using the participant token
- clients may publish Presence but cannot publish Broadcast messages
- `teams`, `participants`, `submissions`, `media_assets`, `game_events` and `game_runs` remain outside the `supabase_realtime` Postgres Changes publication
- the Supabase service key is never sent to the browser
- the participant Realtime client is isolated from Content Studio authentication sessions

## Next realtime features

The next layer is the organizer control room: team health, stalled-team alerts, manual photo approval, checkpoint overrides and targeted announcements. Synchronized countdowns and global story events should follow only after those recovery controls exist.
