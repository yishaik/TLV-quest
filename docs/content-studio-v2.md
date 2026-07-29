# Content Studio v2

## Product model

Content Studio now separates three concepts that previously lived inside one checkpoint editor:

1. **Station** — a reusable physical place. It owns coordinates, verification radius, address, accessibility, field health, tags and imagery.
2. **Riddle** — a reusable challenge that belongs to one station. A station may have any number of text, choice, photo, scan, location, hybrid or finale riddles.
3. **Route stop** — the use of one station with one selected riddle inside one route version. It owns route order, route-specific slug, optional/active flags and future overrides.

A route version is therefore an ordered list of station+riddle selections, rather than a collection of duplicated checkpoint records.

## Editing workflow

### Stations

Create the physical location once and maintain:

- Hebrew and English name, description and address
- latitude, longitude and verification radius
- station image
- tags and accessibility
- field-verification requirement, operational status and notes

Station changes are recompiled into every draft or review route version that uses the station. Published versions remain unchanged.

### Riddles

Create several challenges for the same station and maintain:

- challenge type
- bilingual story, prompt, location hint and success copy
- accepted answers, choice options or photo-validation criteria
- ordered hints and penalties
- scoring and speed bonus
- fallback question
- tags and lifecycle status

Riddle changes are also recompiled only into editable route versions.

### Routes

The route builder provides a visual station library and timeline:

- select a station
- select one of its riddles
- add it to the route
- change the selected riddle later
- drag to reorder, or use accessible up/down controls
- mark a stop optional or inactive
- remove the stop without deleting the source station or riddle

## Runtime compatibility

The existing game engine and run snapshot model remain intact.

`content_compile_route_version` converts route stops into `template_checkpoints`. New runs continue to snapshot those compiled checkpoints into `run_checkpoints`. This preserves the important rule that an existing run never changes when content is edited later.

The compiled checkpoint includes source identifiers for traceability:

- `source_station_id`
- `source_riddle_id`
- `source_route_stop_id`

Station or riddle images are compiled into localized checkpoint content as `imageUrl`. The participant player displays this visual alongside the active mission on larger screens.

## Publishing

Immediately before publishing, the database recompiles the version from the reusable libraries and then runs the existing authoritative gates:

- bilingual title and prompt
- valid answers or choices
- photo criteria
- one finale placed last
- coordinates and radius for location-sensitive stops
- completed field verification when required

Published route versions are immutable. Editing a station or riddle never rewrites published content or historical runs.

## Media

Station images are stored in the public `content-media` Supabase Storage bucket.

- accepted formats: JPEG, PNG, WebP
- maximum size: 8 MB
- writes require an authenticated, allowlisted admin session
- old station images are removed after successful replacement

The bucket is public only for delivery. Content-library database tables remain service-role-only with RLS enabled.

## Migration and compatibility

The migration backfills every existing route checkpoint into:

- a reusable station
- a version-specific riddle
- a route stop linking the two

The current published route and existing runs retain their original version and snapshot. Existing checkpoint APIs remain available for backward compatibility, but the new interface uses the station/riddle/route-stop APIs.
