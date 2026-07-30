# API error handling

API routes must pass failures through `handleRouteError`.

- Throw `AppError` for an intentional client-visible failure. Set an explicit
  HTTP `status`, stable machine-readable `code`, and a safe `message`.
- Throw or rethrow ordinary errors for unexpected infrastructure, database, or
  provider failures. Their messages and metadata are never returned to clients.
- Every error response includes the same correlation ID in
  `x-correlation-id` and `error.details.correlationId`.
- Unexpected errors and all 5xx errors are captured in Sentry with
  `correlation_id` and logged as `api.route_error`, so support can search by the
  ID shown in the response.
- A temporary exact-match allowlist keeps existing intentional domain failures
  compatible while call sites migrate to `AppError`. Do not add substring or
  regular-expression status inference.

Unknown failures return HTTP 500 with a generic Hebrew/English message and
`error.details.code = "internal_error"`.
