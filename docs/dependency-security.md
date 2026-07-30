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

## Blocked major upgrades

Two majors are held back in `.github/dependabot.yml`. Neither is a code
migration we can do: each crashes ESLint before it reports a single violation,
so merging either would take `npm run lint` — and therefore CI — down. Both
were reproduced locally on 2026-07-30 against `main`.

**`eslint` held below `10`** (attempted by #56, ESLint `10.8.0`). ESLint 10
removes `context.getFilename()`, which `eslint-plugin-react@7.37.5` still
calls via its React-version detection:

```
TypeError: Error while loading rule 'react/display-name':
contextOrFilename.getFilename is not a function
```

That plugin version is bundled by `eslint-config-next@16.2.12`, and both are
the current npm `latest` — there is no newer release to upgrade into. Remove
the ignore when an `eslint-config-next` release ships an ESLint 10-compatible
`eslint-plugin-react`.

**`typescript` held below `7`** (attempted by #57, TypeScript `7.0.2`).
`typescript-eslint@8.65.0`, also current `latest`, refuses TS 7.0 outright:

```
typescript-eslint does not support TS 7.0.
```

Upstream is tracking support for TS `>=7.1` in typescript-eslint#10940. Worth
noting that `npx tsc --noEmit` passes cleanly on `7.0.2`, so the codebase
itself is already TS 7-ready and this is purely a lint-toolchain block. Remove
the ignore when typescript-eslint ships TS 7 support.

Because both ignores are open-ended (`>=10`, `>=7`), Dependabot will stay quiet
on these two packages entirely — including for a later major that *does* fix
the incompatibility. Re-check them when Next.js publishes a new major.

## Pinned versions

Twilio is pinned to `6.0.2`, which is the current npm `latest` release as of
2026-07-30. The 6.0.0 breaking change raised the minimum Node.js version to 20;
the project runs Node 22. Signature validation and TwiML generation have
regression coverage.
