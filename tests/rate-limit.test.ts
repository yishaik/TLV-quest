import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleRouteError } from "../lib/http";
import {
  clientIpFromRequest,
  RATE_LIMIT_POLICIES,
  RateLimitExceededError
} from "../lib/rate-limit-core";
import { readRetryAfterSeconds } from "../lib/rate-limit-client";

const migration = readFileSync(
  "supabase/migrations/20260730170000_rate_limits_and_answer_cooldown.sql",
  "utf8"
);
const rateLimitServer = readFileSync("lib/rate-limit.ts", "utf8");
const answerRoute = readFileSync(
  "app/api/participants/[token]/answer/route.ts",
  "utf8"
);
const hintRoute = readFileSync(
  "app/api/participants/[token]/hint/route.ts",
  "utf8"
);
const stateRoute = readFileSync(
  "app/api/participants/[token]/state/route.ts",
  "utf8"
);
const joinRoute = readFileSync("app/api/runs/[code]/join/route.ts", "utf8");
const leadsRoute = readFileSync("app/api/leads/route.ts", "utf8");
const workerRoute = readFileSync("app/api/internal/worker/route.ts", "utf8");
const premiumPlayer = readFileSync(
  "components/PremiumQuestPlayer.tsx",
  "utf8"
);

describe("runtime rate limiting", () => {
  it("uses the documented per-route budgets", () => {
    expect(RATE_LIMIT_POLICIES.answer).toMatchObject({
      limit: 10,
      windowSeconds: 60
    });
    expect(RATE_LIMIT_POLICIES.hint).toMatchObject({
      limit: 5,
      windowSeconds: 60
    });
    expect(RATE_LIMIT_POLICIES.participantState).toMatchObject({
      limit: 60,
      windowSeconds: 60
    });
    expect(RATE_LIMIT_POLICIES.join).toMatchObject({
      limit: 5,
      windowSeconds: 60
    });
    expect(RATE_LIMIT_POLICIES.leads).toMatchObject({
      limit: 3,
      windowSeconds: 3_600
    });
    expect(RATE_LIMIT_POLICIES.worker).toMatchObject({
      limit: 10,
      windowSeconds: 60
    });
  });

  it("uses Vercel's overwritten forwarding header and rejects malformed IPs", () => {
    expect(
      clientIpFromRequest(
        new Request("https://example.test", {
          headers: { "x-forwarded-for": "203.0.113.8, 10.0.0.2" }
        })
      )
    ).toBe("203.0.113.8");
    expect(
      clientIpFromRequest(
        new Request("https://example.test", {
          headers: { "x-forwarded-for": "2001:db8::1" }
        })
      )
    ).toBe("2001:db8::1");
    expect(
      clientIpFromRequest(
        new Request("https://example.test", {
          headers: { "x-forwarded-for": "not-an-ip" }
        })
      )
    ).toBe("unknown");
  });

  it("returns a structured 429 and Retry-After for transport limits", async () => {
    const response = handleRouteError(new RateLimitExceededError("answer", 17));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        details: {
          code: "rate_limit_exceeded",
          retryAfterSeconds: 17
        }
      }
    });
  });

  it("maps the database answer cooldown to the same HTTP contract", async () => {
    const response = handleRouteError(
      new Error("answer_cooldown_active:23")
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("23");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        details: {
          code: "answer_cooldown_active",
          retryAfterSeconds: 23
        }
      }
    });
  });

  it("reads retry timing for a client-visible countdown", () => {
    expect(
      readRetryAfterSeconds(
        new Response("{}", {
          status: 429,
          headers: { "retry-after": "31" }
        }),
        {}
      )
    ).toBe(31);
    expect(
      readRetryAfterSeconds(
        new Response("{}", {
          status: 429,
          headers: { "retry-after": "31" }
        }),
        { error: { details: { retryAfterSeconds: 12 } } }
      )
    ).toBe(12);
  });

  it("wires every exposed route to its intended subject class", () => {
    expect(answerRoute).toContain(
      'enforceParticipantRateLimit("answer", token)'
    );
    expect(hintRoute).toContain(
      'enforceParticipantRateLimit("hint", token)'
    );
    expect(stateRoute).toContain(
      'enforceParticipantRateLimit("participantState", token)'
    );
    expect(joinRoute).toContain('enforceIpRateLimit("join", request)');
    expect(leadsRoute).toContain('enforceIpRateLimit("leads", request)');
    expect(workerRoute).toContain('enforceIpRateLimit("worker", request)');
    expect(rateLimitServer).toContain("hashSecret(`${policy.scope}:${subject}`)");
  });

  it("uses atomic database buckets with service-role-only access", () => {
    expect(migration).toContain("create table if not exists public.rate_limit_buckets");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain(
      "on conflict (bucket_key)"
    );
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain(
      "from public, anon, authenticated"
    );
    expect(migration).toContain("to service_role");
  });

  it("enforces and resets a concurrency-safe per-checkpoint answer cooldown", () => {
    expect(migration).toContain("from public.teams");
    expect(migration).toContain("for update");
    expect(migration).toContain("v_team.wrong_attempts >= 5");
    expect(migration).toContain("answer_cooldown_active:%");
    expect(migration).toContain("last_wrong_attempt_at = clock_timestamp()");
    expect(migration).toContain("wrong_attempts = 0");
    expect(migration).toContain("last_wrong_attempt_at = null");
    expect(premiumPlayer).toContain("answerCooldownSeconds");
    expect(premiumPlayer).toContain("readRetryAfterSeconds");
  });
});
