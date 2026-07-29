# TLV Quest Route Composer

## Scope

The Route Composer is the operational authoring surface for building a complete quest from an empty route to a published, runnable product.

It replaces seed-file editing and most raw JSON work with a structured workflow:

1. Create a route.
2. Create or clone a version.
3. Add, duplicate, remove and reorder checkpoints.
4. Author bilingual story and task content.
5. Configure validation, hints, scoring, interaction, accessibility and fallback behavior.
6. Verify physical stations.
7. Pass publication gates.
8. Publish the version.
9. Select the published route when creating a game run.

## Route lifecycle

A new route starts with version 1 in `draft` state and is not visible to organizers.

Publishing a version:

- marks the previous published version as `superseded`
- marks the selected version as `published`
- updates `game_templates.active_version`
- activates the route for the organizer wizard
- affects only future runs

Every created run receives a snapshot of the selected route's active published version.

## Version operations

The studio supports multiple concurrent draft/review versions and cloning from any existing version.

A version can be permanently deleted only when:

- it is not the active published version
- no game run references it
- another version remains in the route

For an unpublished route, deleting the version currently used as its internal pointer automatically moves that pointer to another remaining version.

## Checkpoint composition

An editable version supports:

- add a checkpoint after the currently selected checkpoint
- duplicate a checkpoint with a new unique slug
- permanently delete a checkpoint
- drag-and-drop ordering
- accessible up/down ordering controls
- active/inactive checkpoints
- optional checkpoints

All ordering changes are transactional and must contain every checkpoint exactly once.

## Structured checkpoint authoring

### Localized content

Each checkpoint has Hebrew and English:

- title
- story
- task prompt
- location hint
- success message

### Validation types

- Text, location, hybrid and finale: accepted answers and fuzzy threshold
- Choice: option list and accepted option
- Photo: AI validation criteria and confidence threshold
- Scan: QR/NFC completion through the station route

The participant player renders choice checkpoints as buttons and submits them through the same idempotent scoring pipeline as text answers.

### Operational configuration

- location coordinates and radius
- wheelchair and stroller accessibility
- ordered hints and per-hint penalty
- base score, error penalty, hint penalty and speed bonus
- primary interaction channel and web fallback
- scan requirement and station slug
- WhatsApp media acceptance
- localized fallback question and accepted answers

## Field verification

A checkpoint can require an on-site verification walk. The operator records:

- status: pending, verified, needs attention or blocked
- signage visibility
- access conditions
- safety
- lighting
- QR presence
- NFC presence
- field notes

Saving a content, validation or location change on a field-sensitive checkpoint resets its verification to pending.

## Publication gates

The frontend and database both enforce:

1. At least one active checkpoint.
2. Hebrew and English title and prompt for every active checkpoint.
3. Accepted answers for text, location, hybrid and finale checkpoints.
4. Valid option list and accepted option for choice checkpoints.
5. AI criteria for photo checkpoints.
6. Exactly one finale.
7. The finale is the last active checkpoint.
8. Coordinates and positive radius for location-sensitive checkpoints.
9. Verified field health for every checkpoint that requires it.

The database function is the authoritative gate and publishes transactionally.

## Organizer integration

`GET /api/routes` exposes only active routes whose active version is published.

The organizer creation wizard requires selection of one of those routes. `POST /api/runs` validates the selection again, creates the run and snapshots its checkpoints. Later route edits or publications do not mutate that run.

## Safety properties

- Admin routes require Supabase Magic Link authentication and the admin allowlist.
- Authoring tables are inaccessible to normal browser users.
- Database mutations are exposed only through service-role RPCs.
- Published content is immutable through the editing APIs.
- Destructive operations are blocked when they could invalidate run history.
- Checkpoint ordering uses a single transaction and unique sequence constraints.
- Run creation validates that the chosen route is still published immediately before snapshotting.
