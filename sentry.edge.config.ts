import * as Sentry from "@sentry/nextjs";
import {
  resolveSentryEnvironment,
  resolveSentryRelease
} from "./lib/sentry-config";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  release: resolveSentryRelease(process.env),
  environment: resolveSentryEnvironment(process.env),
  tracesSampleRate: process.env.VERCEL_ENV === "production" ? 0.1 : 1,
  sendDefaultPii: false
});
