# Live event operations

The organizer link is the authorization boundary for the live control room. Do
not share it with participants. Every control-room mutation requires a
free-form reason and an idempotency key; the server records the actor, reason,
timestamp, and before/after state.

## Go / No-Go

Before launch, confirm that the dashboard reports **מוכן להפעלה**:

- every enabled checkpoint has an active source;
- field verification is `verified` or `not_required`;
- every photo or hybrid checkpoint has a deterministic fallback;
- no delivery is currently failed.

Pending, blocked, or unhealthy checkpoints remain visible with their field
notes. If a checkpoint cannot be made safe, enter a reason and use **השבתה
וקידום צוותים**. This disables it and atomically advances teams currently
there.

The stuck-team threshold defaults to 10 minutes. It can be changed per run with
`settings.stuck_threshold_minutes` (3–60 minutes).

## During a run

The team map shows the current checkpoint, distinct online participants, time
since progress, wrong attempts, and hints used. A stuck row offers these
recovery actions without database access:

1. grant the next hint;
2. force-complete the current checkpoint;
3. correct the score;
4. move a participant to another team.

Broadcasts can target the whole run or one team. One audited operation creates
both localized WhatsApp outbox rows and a localized in-app banner. The API
immediately kicks only the rows created by that operation; the worker remains
the durable retry path.

The outbox monitor distinguishes queued, processing, sent, delivered, and
failed messages. A retry resets the same failed/cancelled row and is itself
idempotent, so an uncertain browser retry cannot create a second outbox row.

## 30-participant operator drill

Before the first production event, use a non-production run at the full
30-participant limit and verify:

1. all participants and teams appear in the dashboard;
2. presence counts change as devices connect and disconnect;
3. one team crosses the stuck threshold and can receive a hint;
4. one targeted and one run-wide broadcast appear in-app and in the outbox;
5. a deliberately failed message can be retried;
6. a participant can be moved between teams and receives the new realtime
   authorization;
7. a checkpoint can be disabled and affected teams advance;
8. every operation appears in the audit list with its reason and before/after
   state.

The Playwright live-ops scenario covers the dashboard flow with 30 mocked
participants. Provider delivery and field safety still require the on-site
drill above.
