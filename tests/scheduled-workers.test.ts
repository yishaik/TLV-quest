import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260801100000_schedule_maintenance_worker.sql",
  "utf8"
);
const outboxMigration = readFileSync(
  "supabase/migrations/20260730150000_reliable_outbox_worker.sql",
  "utf8"
);
const workerRoute = readFileSync("app/api/internal/worker/route.ts", "utf8");
const outboxRoute = readFileSync("app/api/internal/outbox/route.ts", "utf8");
const workerAuth = readFileSync("lib/worker-auth.ts", "utf8");

// The migration's own header explains why WORKER_SECRET is absent, so the
// assertions below have to look at executable SQL rather than at prose.
const migrationStatements = migration
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("maintenance worker schedule", () => {
  it("runs every five minutes, matching the Sentry monitor's expectation", () => {
    expect(migration).toContain("'maintenance-worker-every-five-minutes'");
    expect(migration).toContain("'*/5 * * * *'");
    expect(migration).toContain(
      "select private.invoke_maintenance_worker();"
    );
  });

  it("unschedules any previous job before scheduling, so re-running is safe", () => {
    const unschedule = migration.indexOf("cron.unschedule");
    const schedule = migration.indexOf("select cron.schedule(");
    expect(unschedule).toBeGreaterThan(-1);
    expect(schedule).toBeGreaterThan(unschedule);
  });

  it("targets the maintenance endpoint, not the outbox endpoint", () => {
    expect(migration).toContain("/api/internal/worker");
    expect(migration).not.toContain("/api/internal/outbox");
    expect(outboxMigration).toContain("/api/internal/outbox");
  });

  it("mints a single-use token instead of storing WORKER_SECRET in the database", () => {
    expect(migrationStatements).toContain("extensions.gen_random_bytes(32)");
    expect(migrationStatements).toContain("private.outbox_worker_tokens");
    expect(migrationStatements).not.toContain("WORKER_SECRET");
    expect(migrationStatements).not.toContain("vault");
  });

  it("keeps the token short-lived and the invoker unreachable from browser roles", () => {
    expect(migration).toContain("clock_timestamp() + interval '5 minutes'");
    expect(migration).toContain(
      "revoke execute on function private.invoke_maintenance_worker()\n  from public, anon, authenticated, service_role;"
    );
  });
});

describe("worker request authorization", () => {
  it("guards both internal worker routes with the shared check", () => {
    for (const route of [workerRoute, outboxRoute]) {
      expect(route).toContain("authorizeWorkerRequest(request)");
      expect(route).toContain('jsonError("Unauthorized", 401)');
    }
  });

  it("no longer requires the static secret on the maintenance route", () => {
    expect(workerRoute).not.toContain("requireBearer");
  });

  it("still rate limits the maintenance route before authorizing", () => {
    const rateLimit = workerRoute.indexOf('enforceIpRateLimit("worker"');
    const authorize = workerRoute.indexOf("authorizeWorkerRequest(request)");
    expect(rateLimit).toBeGreaterThan(-1);
    expect(authorize).toBeGreaterThan(rateLimit);
  });

  it("accepts WORKER_SECRET and minted tokens, and nothing else", () => {
    expect(workerAuth).toContain("process.env.WORKER_SECRET");
    expect(workerAuth).toContain("consume_outbox_worker_token");
    expect(workerAuth).toContain("timingSafeEqual");
    // A malformed or absent bearer header must short-circuit to false rather
    // than reaching the database.
    expect(workerAuth).toContain("if (!token) return false;");
  });
});

describe("stale run expiry", () => {
  const migration = readFileSync(
    "supabase/migrations/20260805090000_expire_stale_runs.sql",
    "utf8"
  );
  const maintenance = readFileSync("lib/maintenance.ts", "utf8");

  it("closes any run still open seven hours after creation", () => {
    // Abandoned bookings otherwise sit in registration_open forever —
    // retention is only stamped on finish — and count against the tenant's
    // active-run quota until every new game in the system is refused.
    expect(migration).toContain("interval '7 hours'");
    expect(migration).toContain("'draft','registration_open','ready'");
    expect(migration).toContain("'active','paused'");
  });

  it("cancels the never-started and finishes the started", () => {
    // A started run keeps its scores and flows through recap and metrics like
    // any completed game; a never-started one has nothing worth keeping.
    const cancel = migration.indexOf("status = 'cancelled'");
    const finish = migration.indexOf("status = 'finished'");
    expect(cancel).toBeGreaterThan(-1);
    expect(finish).toBeGreaterThan(cancel);
    expect(migration).toContain("retention_until = coalesce");
  });

  it("runs from the maintenance worker before anything else", () => {
    const expire = maintenance.indexOf('rpc("expire_stale_runs")');
    const starts = maintenance.indexOf("startDueRuns()");
    expect(expire).toBeGreaterThan(-1);
    expect(expire).toBeLessThan(starts);
  });

  it("is service-role only", () => {
    expect(migration).toContain(
      "revoke all on function public.expire_stale_runs"
    );
    expect(migration).toContain("to service_role");
  });
});
