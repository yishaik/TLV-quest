import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  release:
    process.env.NEXT_PUBLIC_SENTRY_RELEASE ??
    process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
  tracesSampleRate: process.env.NEXT_PUBLIC_VERCEL_ENV === "production" ? 0.1 : 1,
  sendDefaultPii: false,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
