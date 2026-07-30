# Supabase Realtime architecture

## Decision

The player connects directly from the browser to Supabase Realtime. Vercel remains the authoritative HTTP API for loading protected participant state and performing game actions.

Private gameplay tables are not exposed through Postgres Changes. Participants use opaque personal tokens rather than Supabase Auth sessions, so the database emits public Broadcast wake-up signals to random team and run topics. Broadcast payloads contain only the table name, operation and timestamp. After receiving a signal, the browser reloads authoritative state through the protected participant API.

The public leaderboard continues to use filtered Postgres Changes because `leaderboard_entries` is already intentionally public and protected by its existing read policy.

## Player data flow

1. The player performs one initial state request.
2. The response contains random team and run topics.
3. One shared React provider subscribes to both Broadcast topics and the run leaderboard.
4. Database changes cause a debounced state refresh.
5. Every player component reads the same state snapshot.
6. Visibility changes, browser reconnection and WebSocket reconnection trigger a fresh authoritative read.

There is no recurring interval polling.

## Events covered

- team score, progress, checkpoint and status changes
- game start, pause, resume, finish and cancellation
- participant membership changes
- photo validation and fallback availability
- optional checkpoint skipping
- hybrid scan verification
- leaderboard ranking changes

## Security properties

- team and run topics are random and are returned only by the token-protected state API
- Broadcast messages contain no player names, phone numbers, answers, locations or checkpoint content
- all protected state is still loaded through Vercel using the participant token
- `teams`, `participants`, `submissions`, `media_assets` and `game_runs` remain outside the `supabase_realtime` Postgres Changes publication
- the Supabase service key is never sent to the browser

## Deferred realtime features

The same foundation can later support Presence, organizer interventions, team event toasts, synchronized countdowns and live story announcements. These should be introduced as separate product changes rather than mixed into the transport migration.
