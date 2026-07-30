type Environment = Record<string, string | undefined>;

const value = (input: string | undefined) => input?.trim() || undefined;

const SENTRY_BUILD_VARIABLES = [
  "SENTRY_AUTH_TOKEN",
  "SENTRY_ORG",
  "SENTRY_PROJECT"
] as const;

export const resolveSentryRelease = (environment: Environment) =>
  value(environment.SENTRY_RELEASE) ??
  value(environment.VERCEL_GIT_COMMIT_SHA) ??
  value(environment.GITHUB_SHA) ??
  value(environment.NEXT_PUBLIC_SENTRY_RELEASE);

export const resolveSentryEnvironment = (environment: Environment) =>
  value(environment.SENTRY_ENVIRONMENT) ??
  value(environment.VERCEL_ENV) ??
  value(environment.NODE_ENV) ??
  "development";

export const inspectSentryBuildConfiguration = (
  environment: Environment
) => {
  const missing = SENTRY_BUILD_VARIABLES.filter(
    (key) => !value(environment[key])
  );

  return {
    configured: missing.length === 0,
    missing,
    authToken: value(environment.SENTRY_AUTH_TOKEN),
    org: value(environment.SENTRY_ORG),
    project: value(environment.SENTRY_PROJECT)
  };
};

export const sentryRuntimeStatus = (environment: Environment) => {
  const build = inspectSentryBuildConfiguration(environment);
  const release = resolveSentryRelease(environment);

  return {
    dsnConfigured: Boolean(value(environment.NEXT_PUBLIC_SENTRY_DSN)),
    release: release ?? null,
    environment: resolveSentryEnvironment(environment),
    releaseUploadConfigured: build.configured && Boolean(release),
    missingReleaseUploadVariables: [
      ...build.missing,
      ...(release ? [] : ["SENTRY_RELEASE or VERCEL_GIT_COMMIT_SHA"])
    ]
  };
};
