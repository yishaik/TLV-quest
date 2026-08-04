import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync("lib/free-booking.ts", "utf8");
const route = readFileSync("app/api/runs/free/route.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260803220000_free_self_service_booking.sql",
  "utf8"
);

describe("free booking limits", () => {
  it("caps free runs at three per person", () => {
    // Read from source rather than imported: lib/free-booking.ts is
    // `server-only` and pulls in the Supabase admin client.
    const perBooker = Number(
      /FREE_RUNS_PER_BOOKER = (\d+)/.exec(source)?.[1]
    );
    const maxParticipants = Number(
      /FREE_RUN_MAX_PARTICIPANTS = (\d+)/.exec(source)?.[1]
    );
    expect(perBooker).toBe(3);
    expect(maxParticipants).toBeLessThanOrEqual(30);
  });

  it("counts by keyed hash, not by anything the client sends", () => {
    // The organizer contact is encrypted and therefore unqueryable, and a
    // client-supplied identifier could simply be changed. Only a keyed hash of
    // the email can both count and resist enumeration.
    expect(source).toContain("hashSecret(email)");
    expect(source).toContain("booker_email_hash");
  });

  it("re-checks the cap after creating, because the check is not atomic", () => {
    // Two requests can pass the pre-check together; the surplus run is
    // cancelled rather than silently kept.
    const preCheck = source.indexOf("const already = await countFreeRunsForBooker");
    const postCheck = source.indexOf("const total = await countFreeRunsForBooker");
    expect(preCheck).toBeGreaterThan(-1);
    expect(postCheck).toBeGreaterThan(preCheck);
    expect(source).toContain('status: "cancelled"');
  });

  it("rejects malformed email before touching the database", () => {
    expect(source).toContain("EMAIL_PATTERN");
    const validate = source.indexOf("normalizeBookerEmail");
    const count = source.indexOf("countFreeRunsForBooker");
    expect(validate).toBeLessThan(count);
  });

  it("rate limits the public endpoint independently of the per-person cap", () => {
    // The cap stops one person booking four games. The transport limit stops
    // one origin hammering the endpoint with many addresses.
    expect(route).toContain('enforceIpRateLimit("freeBooking", request)');
  });

  it("keeps the transport limit above the per-person cap", () => {
    // Observed in production: at three per hour per address the IP limit fired
    // first and the cap was never reached, so anyone behind carrier NAT would
    // block their colleagues after three bookings between them.
    const core = readFileSync("lib/rate-limit-core.ts", "utf8");
    const transport = Number(
      /freeBooking: \{ scope: "free-booking", limit: (\d+)/.exec(core)?.[1]
    );
    const perBooker = Number(/FREE_RUNS_PER_BOOKER = (\d+)/.exec(source)?.[1]);
    expect(transport).toBeGreaterThan(perBooker);
  });

  it("never returns the organizer token as a bare value", () => {
    // The management URL embeds it and is shown once; echoing the raw token
    // separately would invite it being logged or copied elsewhere.
    expect(route).toContain("manageUrl");
    expect(route).not.toContain("organizerToken:");
    expect(route).toContain('"cache-control": "private, no-store"');
  });

  it("leaves invite-created runs uncapped", () => {
    // Null means "not a free booking"; the partial index encodes that too.
    expect(migration).toContain("where booker_email_hash is not null");
    expect(migration).toContain("add column if not exists booker_email_hash");
  });
});

describe("marketing page reflects live content", () => {
  const page = readFileSync("app/page.tsx", "utf8");
  const reader = readFileSync("lib/marketing-route.ts", "utf8");
  const home = readFileSync("components/MarketingHome.tsx", "utf8");

  it("reads the published route instead of hardcoding it", () => {
    // The previous page described a time capsule and three checkpoints that no
    // longer existed anywhere, and nothing caught it because the copy had no
    // relationship to the data.
    expect(page).toContain("getMarketingRoute");
    expect(reader).toContain("is_active");
    expect(reader).toContain("active_version");
  });

  it("is not statically cached, so content changes surface", () => {
    expect(page).toContain('export const dynamic = "force-dynamic"');
  });

  it("renders without content rather than hanging on it", () => {
    // The route strip is an enhancement. Blocking the render on a database
    // round trip would let a slow Postgres take the marketing site down, and
    // in CI — where the Supabase host is a placeholder — it made every
    // navigation hang past the test timeout.
    expect(reader).toContain("CONTENT_TIMEOUT_MS");
    expect(reader).toContain("Promise.race");
    expect(reader).toContain("catch(() => null)");
  });

  it("shows only curated hero photos, never the raw gallery", () => {
    // The gallery is a working archive — signage shots for authoring,
    // calibration rejects. The hero column is the one curated slot, so it is
    // the only thing the marketing page is allowed to read.
    expect(reader).toContain("hero_image_url");
    expect(reader).not.toContain("galleryEntries");
    expect(home).toContain("stop.photo");
  });

  it("no longer advertises the deleted time-capsule route", () => {
    expect(home).not.toContain("קפסולת זמן שננעלה");
    expect(home).not.toContain("A time capsule sealed in 1936");
  });
});
