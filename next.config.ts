import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import {
  inspectSentryBuildConfiguration,
  resolveSentryEnvironment,
  resolveSentryRelease
} from "./lib/sentry-config";

const sentryRelease = resolveSentryRelease(process.env);
const sentryEnvironment = resolveSentryEnvironment(process.env);
const sentryBuild = inspectSentryBuildConfiguration(process.env);
const sentryReleaseUploadEnabled =
  sentryBuild.configured && Boolean(sentryRelease);
const vercelDeploymentHost =
  process.env.VERCEL_URL?.trim() ||
  process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
const vercelDeploymentUrl = vercelDeploymentHost
  ? `https://${vercelDeploymentHost.replace(/^https?:\/\//, "")}`
  : undefined;

if (process.env.VERCEL && !sentryReleaseUploadEnabled) {
  const missing = [
    ...sentryBuild.missing,
    ...(sentryRelease ? [] : ["VERCEL_GIT_COMMIT_SHA"])
  ];
  console.warn(
    `[sentry] Release upload disabled. Missing: ${missing.join(", ")}`
  );
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: {
    SENTRY_ENVIRONMENT: sentryEnvironment,
    SENTRY_RELEASE: sentryRelease ?? "",
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: sentryEnvironment,
    NEXT_PUBLIC_SENTRY_RELEASE: sentryRelease ?? ""
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb"
    }
  }
};

export default withSentryConfig(nextConfig, {
  authToken: sentryBuild.authToken,
  org: sentryBuild.org,
  project: sentryBuild.project,
  silent: !sentryReleaseUploadEnabled,
  telemetry: false,
  sourcemaps: {
    disable: !sentryReleaseUploadEnabled,
    deleteSourcemapsAfterUpload: true
  },
  ...(sentryRelease
    ? {
        release: {
          name: sentryRelease,
          create: sentryReleaseUploadEnabled,
          finalize: sentryReleaseUploadEnabled,
          ...(sentryReleaseUploadEnabled
            ? {
                deploy: {
                  env: sentryEnvironment,
                  name: vercelDeploymentHost ?? sentryRelease,
                  url: vercelDeploymentUrl
                }
              }
            : {})
        }
      }
    : {})
});
