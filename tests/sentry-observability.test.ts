import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  inspectSentryBuildConfiguration,
  resolveSentryEnvironment,
  resolveSentryRelease,
  sentryRuntimeStatus
} from "../lib/sentry-config";

describe("Sentry production observability", () => {
  it("uses the deployment commit consistently as the release", () => {
    expect(
      resolveSentryRelease({
        SENTRY_RELEASE: " explicit-release ",
        VERCEL_GIT_COMMIT_SHA: "vercel-sha"
      })
    ).toBe("explicit-release");
    expect(
      resolveSentryRelease({
        VERCEL_GIT_COMMIT_SHA: " vercel-sha ",
        GITHUB_SHA: "github-sha"
      })
    ).toBe("vercel-sha");
    expect(resolveSentryRelease({ GITHUB_SHA: " github-sha " })).toBe(
      "github-sha"
    );
  });

  it("requires the complete server-only upload credential set", () => {
    expect(inspectSentryBuildConfiguration({})).toMatchObject({
      configured: false,
      missing: ["SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT"]
    });
    expect(
      inspectSentryBuildConfiguration({
        SENTRY_AUTH_TOKEN: "token",
        SENTRY_ORG: "organization",
        SENTRY_PROJECT: "project"
      })
    ).toMatchObject({
      configured: true,
      missing: []
    });
  });

  it("reports safe runtime status without secret values", () => {
    const status = sentryRuntimeStatus({
      NEXT_PUBLIC_SENTRY_DSN: "https://public@example.invalid/1",
      SENTRY_AUTH_TOKEN: "super-secret",
      SENTRY_ORG: "organization",
      SENTRY_PROJECT: "project",
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_SHA: "release-sha"
    });

    expect(status).toEqual({
      dsnConfigured: true,
      release: "release-sha",
      environment: "production",
      releaseUploadConfigured: true,
      missingReleaseUploadVariables: []
    });
    expect(JSON.stringify(status)).not.toContain("super-secret");
    expect(resolveSentryEnvironment({})).toBe("development");
  });

  it("flushes the closing check-in before the serverless function freezes", () => {
    const maintenance = readFileSync("lib/maintenance.ts", "utf8");

    // `captureCheckIn` only buffers. Vercel freezes the function the moment the
    // response is returned, so without an explicit flush the closing check-in
    // never leaves the process: Sentry sees `in_progress`, never `ok`, and
    // marks every healthy run as a timeout. Observed in production on
    // 2026-08-01 — two consecutive runs returned HTTP 200 while the monitor
    // recorded `timeout` and then a stuck `in_progress`.
    expect(maintenance).toContain("Sentry.flush(MAINTENANCE_FLUSH_TIMEOUT_MS)");

    // The flush has to be in `finally`, or the error path reports a failure
    // that never reaches Sentry either.
    const finallyIndex = maintenance.indexOf("} finally {");
    const flushIndex = maintenance.indexOf("await Sentry.flush(");
    expect(finallyIndex).toBeGreaterThan(-1);
    expect(flushIndex).toBeGreaterThan(finallyIndex);

    // A Sentry outage must not hold the worker past its 60s route budget.
    // Read from source rather than imported: lib/maintenance.ts is
    // `server-only` and pulls in the Supabase admin client.
    const timeout = Number(
      /MAINTENANCE_FLUSH_TIMEOUT_MS = (\d+)/.exec(maintenance)?.[1]
    );
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThanOrEqual(5000);
  });

  it("wires releases, deployments, live-run tags and worker check-ins", () => {
    const nextConfig = readFileSync("next.config.ts", "utf8");
    const sentryConfig = readFileSync("lib/sentry-config.ts", "utf8");
    const clientConfig = readFileSync("instrumentation-client.ts", "utf8");
    const serverConfig = readFileSync("sentry.server.config.ts", "utf8");
    const edgeConfig = readFileSync("sentry.edge.config.ts", "utf8");
    const maintenance = readFileSync("lib/maintenance.ts", "utf8");
    const verification = readFileSync(
      "scripts/verify-sentry-production.mjs",
      "utf8"
    );

    expect(sentryConfig).toContain("VERCEL_GIT_COMMIT_SHA");
    expect(nextConfig).toContain("deploy:");
    expect(nextConfig).toContain("deleteSourcemapsAfterUpload: true");
    expect(clientConfig).toContain("NEXT_PUBLIC_SENTRY_RELEASE");
    expect(serverConfig).toContain("resolveSentryRelease");
    expect(edgeConfig).toContain("resolveSentryRelease");
    expect(maintenance).toContain("Sentry.captureCheckIn");
    expect(maintenance).toContain('"*/5 * * * *"');
    expect(verification).toContain("operational_scope");
    expect(verification).toContain("live_run");
  });
});
