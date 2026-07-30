import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleRouteError } from "../lib/http";
import { validatedTwilioMediaUrl } from "../lib/twilio-media-security";

const experienceState = readFileSync("lib/experience-meta.ts", "utf8");
const participantTypes = readFileSync("lib/quest-realtime-types.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260730102628_production_readiness.sql",
  "utf8"
);
const participantRoutes = [
  "answer",
  "hint",
  "location",
  "photo",
  "scan",
  "skip"
].map((name) =>
  readFileSync(`app/api/participants/[token]/${name}/route.ts`, "utf8")
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("production readiness", () => {
  it("never projects answer validation, scoring, hints, or fallback answers", () => {
    expect(experienceState).toContain("participantCheckpoint");
    expect(experienceState).toContain("choiceOptions");
    expect(experienceState).toContain("fallbackPrompt");
    expect(experienceState).not.toContain("...state,");
    expect(experienceState).not.toContain("...currentCheckpoint,");
    expect(participantTypes).not.toMatch(
      /\b(validation|scoring|hints|fallback):/
    );
  });

  it("accepts only same-account Twilio media resource URLs", () => {
    const accountSid = `AC${"a".repeat(32)}`;
    const messageSid = `MM${"b".repeat(32)}`;
    const mediaSid = `ME${"c".repeat(32)}`;
    const path = `/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media/${mediaSid}`;

    expect(
      validatedTwilioMediaUrl(`https://api.twilio.com${path}`, accountSid)
        .hostname
    ).toBe("api.twilio.com");
    expect(
      validatedTwilioMediaUrl(
        `https://api.dublin.ie1.twilio.com${path}`,
        accountSid
      ).hostname
    ).toBe("api.dublin.ie1.twilio.com");

    expect(() =>
      validatedTwilioMediaUrl(`https://127.0.0.1${path}`, accountSid)
    ).toThrow("twilio_media_url_rejected");
    expect(() =>
      validatedTwilioMediaUrl(`http://api.twilio.com${path}`, accountSid)
    ).toThrow("twilio_media_url_rejected");
    expect(() =>
      validatedTwilioMediaUrl(
        `https://api.twilio.com${path}?redirect=https://example.com`,
        accountSid
      )
    ).toThrow("twilio_media_url_rejected");
    expect(() =>
      validatedTwilioMediaUrl(
        `https://api.twilio.com${path}`,
        `AC${"d".repeat(32)}`
      )
    ).toThrow("twilio_media_url_rejected");
  });

  it("returns opaque 500 errors with a correlation identifier", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = handleRouteError(
      new Error("postgres password=do-not-expose relation internal_table")
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(response.headers.get("x-correlation-id")).toBeTruthy();
    expect(JSON.stringify(payload)).not.toContain("do-not-expose");
    expect(payload.error.details.code).toBe("internal_error");
  });

  it("requires caller-stable idempotency keys on every participant mutation", () => {
    for (const route of participantRoutes) {
      expect(route).toContain("requireIdempotencyKey(request)");
      expect(route).not.toContain("randomUUID");
    }
  });

  it("uses shared limits, private authorization, and server-only RPC grants", () => {
    expect(migration).toContain("create table public.rate_limit_buckets");
    expect(migration).toContain("function public.consume_rate_limit");
    expect(migration).toContain("function private.quest_realtime_binding_allowed");
    expect(migration).toContain("answer_cooldown_active:60");
    expect(migration).toContain("to service_role");
    expect(migration).not.toContain(
      "function public.quest_realtime_binding_allowed"
    );
  });
});
