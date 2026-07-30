import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "12mb"
    }
  }
};

export default withSentryConfig(nextConfig, {
  silent: true,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  release: {
    name: process.env.VERCEL_GIT_COMMIT_SHA
  },
  sourcemaps: {
    deleteSourcemapsAfterUpload: true
  }
});
