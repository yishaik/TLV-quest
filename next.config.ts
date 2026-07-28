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
  disableLogger: true,
  authToken: process.env.SENTRY_AUTH_TOKEN
});
