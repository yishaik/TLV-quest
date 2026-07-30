# Dependency security

Production dependencies are checked in CI with:

```sh
npm run audit:prod
```

The command fails on high or critical vulnerabilities and excludes development
tools from the production gate. Dependabot checks npm weekly, groups compatible
minor and patch updates, and leaves major upgrades in separate pull requests.

## Current transitive overrides

Next.js 16.2.12 pins vulnerable transitive versions even though compatible
patched releases are available:

- `postcss` is overridden to `8.5.25`.
- `sharp` is overridden to `0.35.3`.

Both overrides must remain covered by lint, unit, build, and browser tests.
Remove an override when a supported Next.js release resolves the corresponding
dependency itself.

Twilio is pinned to `6.0.2`, which is the current npm `latest` release as of
2026-07-30. The 6.0.0 breaking change raised the minimum Node.js version to 20;
the project runs Node 22. Signature validation and TwiML generation have
regression coverage.
