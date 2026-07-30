import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260730200000_explicit_browser_role_access.sql",
  "utf8"
);
const remoteProbe = readFileSync(
  "scripts/verify-supabase-public-access.mjs",
  "utf8"
);
const productionSmoke = readFileSync(
  ".github/workflows/realtime-production-smoke.yml",
  "utf8"
);
const accessModel = readFileSync("docs/security-access-model.md", "utf8");

describe("Supabase browser-role access", () => {
  it("revokes browser access by default and re-grants only the allowlist", () => {
    expect(migration).toContain(
      "revoke all on all tables in schema public from public, anon, authenticated"
    );
    expect(migration).toContain(
      "revoke all on all sequences in schema public from public, anon, authenticated"
    );
    expect(migration).toContain(
      "grant select on table public.leaderboard_entries to anon, authenticated"
    );
    expect(migration).toContain(
      "grant select on table public.quest_realtime_events to authenticated"
    );
    expect(migration).toContain(
      "grant select, insert, update, delete on table public.quest_presence"
    );
    expect(migration).toContain("not relation.relrowsecurity");
    expect(migration).toContain("Unexpected browser table privileges");
    expect(migration).toContain("Unexpected browser sequence privileges");
  });

  it("keeps the Realtime predicate private and checks function ACLs", () => {
    expect(migration).toContain(
      "function private.quest_realtime_binding_allowed"
    );
    expect(migration).toContain(
      "drop function if exists public.quest_realtime_binding_allowed"
    );
    expect(migration).toContain(
      "revoke execute on all functions in schema private"
    );
    expect(migration).toContain("set search_path = pg_catalog, pg_temp");
    expect(migration).toContain("Unexpected browser function privileges");
  });

  it("probes every high-risk table without leaking unexpected rows to logs", () => {
    for (const table of [
      "participants",
      "teams",
      "submissions",
      "media_assets",
      "message_outbox",
      "game_events",
      "game_runs",
      "run_checkpoints",
      "content_stations",
      "content_riddles",
      "marketing_leads",
      "admin_allowlist",
      "quest_realtime_events",
      "quest_presence",
      "leaderboard_entries"
    ]) {
      expect(remoteProbe).toContain(`"${table}"`);
    }
    expect(remoteProbe).toContain("[REDACTED ${rows.length} ROW(S)]");
    expect(remoteProbe).toContain("exposed rows to anon");
  });

  it("runs the remote probe only in an operator-dispatched production smoke", () => {
    expect(productionSmoke).toContain("workflow_dispatch:");
    expect(productionSmoke).not.toContain("pull_request:");
    expect(productionSmoke).toContain(
      "node scripts/verify-supabase-public-access.mjs"
    );
    expect(productionSmoke).toContain("foreign_presence_write_http");
  });

  it("documents the public-key boundary and service credential handling", () => {
    expect(accessModel).toContain("not an authorization boundary");
    expect(accessModel).toContain("Every other `public` table or view");
    expect(accessModel).toContain("full-database credential");
    expect(accessModel).toContain("npm run test:rls-remote");
  });
});
