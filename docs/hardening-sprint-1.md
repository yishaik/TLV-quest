# Hardening sprint 1

This change closes the highest-priority findings from the post-Content-Studio review.

## Database security

All `public.content_*` functions are executable only by `service_role`. Browser roles (`anon` and `authenticated`) cannot call the authoring RPCs directly and therefore cannot bypass the protected Next.js admin API.

The migration also pins the `search_path` of the two SQL helper functions and adds covering indexes for the new source foreign keys.

## API semantics

Authentication and authorization failures now return HTTP 401 and 403 respectively. Location and scan prerequisites continue to return HTTP 409 with player-facing guidance.

## Runtime

The project is pinned to Node 22.x to avoid an unreviewed major runtime upgrade on Vercel.

## Verification

After applying the migration, every `content_*` function was checked directly in Postgres:

- `anon`: no execute permission
- `authenticated`: no execute permission
- `service_role`: execute permission

The four expected covering indexes are present.
