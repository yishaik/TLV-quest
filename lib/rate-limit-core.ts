import { isIP } from "node:net";

export const RATE_LIMIT_POLICIES = {
  answer: { scope: "answer", limit: 10, windowSeconds: 60 },
  hint: { scope: "hint", limit: 5, windowSeconds: 60 },
  participantState: {
    scope: "participant-state",
    limit: 60,
    windowSeconds: 60
  },
  organizerControl: {
    scope: "organizer-control",
    limit: 30,
    windowSeconds: 60
  },
  organizerState: {
    scope: "organizer-state",
    limit: 60,
    windowSeconds: 60
  },
  join: { scope: "join", limit: 5, windowSeconds: 60 },
  leads: { scope: "leads", limit: 3, windowSeconds: 60 * 60 },
  // Free booking creates real rows and real tokens from an unauthenticated
  // request, so it needs a transport limit — but it must sit *above* the
  // three-run cap it fronts, not at it. At three per hour per address the IP
  // limit fires first and the per-person cap is never reached, so anyone
  // behind carrier NAT or an office gateway blocks their colleagues after
  // three bookings between them. This bounds hammering; the real limit is
  // FREE_RUNS_PER_BOOKER, which no address change can evade.
  freeBooking: { scope: "free-booking", limit: 12, windowSeconds: 60 * 60 },
  worker: { scope: "worker", limit: 10, windowSeconds: 60 },
  // Authoring routes are admin-only and already behind requireAdmin, so these
  // bound cost and accidental loops rather than abuse. Translation is the
  // tighter of the two because each call reaches a paid upstream model.
  contentImport: { scope: "content-import", limit: 10, windowSeconds: 60 },
  contentTranslate: {
    scope: "content-translate",
    limit: 20,
    windowSeconds: 60
  },
  // 3 per day, not per minute: an epilogue is generated once per finished run,
  // retries exist only for flaky networks, and each call reaches a paid model.
  epilogue: { scope: "participant-epilogue", limit: 3, windowSeconds: 86_400 },
  routeGenerator: {
    scope: "route-generator",
    limit: 10,
    windowSeconds: 60
  },
  // Public, token-keyed: recap links get shared in group chats, so allow a
  // burst of curious teammates without letting one link hammer the database.
  recap: { scope: "public-recap", limit: 30, windowSeconds: 60 }
} as const;

export type RateLimitPolicyName = keyof typeof RATE_LIMIT_POLICIES;

export class RateLimitExceededError extends Error {
  readonly code = "rate_limit_exceeded";
  readonly retryAfterSeconds: number;
  readonly scope: string;

  constructor(scope: string, retryAfterSeconds: number) {
    super("rate_limit_exceeded");
    this.name = "RateLimitExceededError";
    this.scope = scope;
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
  }
}

export const clientIpFromRequest = (request: Request): string => {
  // Vercel overwrites x-forwarded-for at the edge unless an explicit trusted
  // proxy is configured, so the first value is the platform-authenticated IP.
  const candidate =
    request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ?? "";
  return isIP(candidate) ? candidate : "unknown";
};
