import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleRouteError } from "../lib/http";

const migration = readFileSync(
  "supabase/migrations/20260730034000_runtime_progression_hardening.sql",
  "utf8"
);
const stationScan = readFileSync("lib/station-scan.ts", "utf8");
const answerSubmission = readFileSync("lib/answer-submission.ts", "utf8");
const safetyNet = readFileSync("components/QuestRuntimeSafetyNet.tsx", "utf8");

describe("runtime progression hardening", () => {
  it("implements team-level optional skipping with no score award", () => {
    expect(migration).toContain("function public.skip_optional_checkpoint");
    expect(migration).toContain("if not v_checkpoint.is_optional");
    expect(migration).toContain("'optional_checkpoint_skipped'");
    expect(migration).toContain("'skip'");
    expect(safetyNet).toContain("/skip");
    expect(safetyNet).toContain("No points will be awarded");
  });

  it("requires a scan before hybrid completion", () => {
    expect(migration).toContain("v_checkpoint.kind = 'hybrid'");
    expect(migration).toContain("event_type = 'STATION_SCANNED'");
    expect(migration).toContain("scan_verification_required");
    expect(stationScan).toContain('state.checkpoint.kind === "scan"');
    expect(stationScan).toContain('state.checkpoint.kind !== "hybrid"');
    expect(stationScan).toContain("requiresAnswer: true");
    expect(answerSubmission).toContain('checkpoint.kind === "hybrid"');
  });

  it("blocks publishing inactive station or riddle sources", () => {
    expect(migration).toContain("template_versions_active_sources_guard");
    expect(migration).toContain("station.status <> 'active'");
    expect(migration).toContain("riddle.status <> 'active'");
    expect(handleRouteError(new Error("inactive_content_sources")).status).toBe(409);
  });

  it("unlocks photo fallback only after a rejected photo", () => {
    expect(answerSubmission).toContain('checkpoint.kind === "photo"');
    expect(answerSubmission).toContain("photo_fallback_not_unlocked");
    expect(answerSubmission).toContain('.from("media_assets")');
    expect(safetyNet).toContain("photoFallbackAvailable");
    expect(handleRouteError(new Error("photo_fallback_not_unlocked")).status).toBe(409);
  });

  it("keeps new database functions server-only", () => {
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("to service_role");
  });
});
