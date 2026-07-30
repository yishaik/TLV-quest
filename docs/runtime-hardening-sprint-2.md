# Runtime hardening sprint 2

This sprint closes the four player-flow gaps identified after the Content Studio launch.

## Optional checkpoints

`is_optional` now has runtime meaning. A participant may skip the current optional checkpoint for their team. The operation is transactional, idempotent, awards zero points, records a submission and event, increments route progress, and advances only that team.

## Hybrid checkpoints

A hybrid checkpoint is a two-step challenge:

1. scan the checkpoint QR/NFC marker;
2. submit the correct answer.

Scanning records `STATION_SCANNED` and returns the team to the player without advancing. The database-authoritative `apply_submission` function rejects correct hybrid answers until the scan exists. Pure `scan` checkpoints still complete immediately when scanned.

## Active content publish guard

A database trigger blocks a route version from becoming `published` when any active route stop references a station or riddle whose lifecycle status is not `active`. The check runs inside the publish transaction, so prior publication state is not partially changed.

## Photo fallback

A photo checkpoint fallback is no longer dead-end copy. After a rejected or below-threshold photo attempt, the player receives a structured fallback question and answer field. The answer endpoint independently verifies that a rejected photo exists before accepting the fallback.

## Runtime state

The participant state endpoint now exposes:

- `isOptional`
- `scanVerified`
- `photoFallbackAvailable`

The player safety panel uses these fields to display only the controls relevant to the current checkpoint.

## Security

All new progression functions are executable only by `service_role`. Player tokens are resolved server-side, and the database validates run, team, participant, current checkpoint and idempotency state before mutation.
