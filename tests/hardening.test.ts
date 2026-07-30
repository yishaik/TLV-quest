import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleRouteError } from "../lib/http";

const migration = readFileSync(
  "supabase/migrations/20260730011500_content_rpc_security_hardening.sql",
  "utf8"
);

describe("security hardening", () => {
  it("returns accurate authentication and authorization statuses", () => {
    expect(handleRouteError(new Error("Unauthorized")).status).toBe(401);
    expect(handleRouteError(new Error("Admin access is not allowed")).status).toBe(403);
  });

  it("keeps Content Studio RPCs service-role only", () => {
    expect(migration).toContain("revoke all on function");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain("grant execute on function %s to service_role");
  });

  it("pins mutable helper search paths", () => {
    expect(migration).toContain("content_normalize_slug(text)");
    expect(migration).toContain("content_default_checkpoint_config(text)");
    expect(migration).toContain("public, pg_temp");
  });
});
