import "server-only";

import { hashSecret } from "@/lib/crypto";
import { AppError } from "@/lib/http";
import { createAdminClient } from "@/lib/supabase/admin";

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retry_after_seconds: number;
};

export const requestIp = (request: Request) => {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return (
    request.headers.get("x-real-ip")?.trim() ||
    forwarded?.at(-1) ||
    "unknown"
  ).slice(0, 128);
};

export const enforceRateLimit = async ({
  scope,
  identifier,
  limit,
  windowSeconds
}: {
  scope: string;
  identifier: string;
  limit: number;
  windowSeconds: number;
}) => {
  const bucketKey = hashSecret(`rate-limit:${scope}:${identifier}`);
  const { data, error } = await createAdminClient().rpc("consume_rate_limit", {
    p_bucket_key: bucketKey,
    p_limit: limit,
    p_window_seconds: windowSeconds
  });
  if (error) throw error;

  const result = (Array.isArray(data) ? data[0] : data) as
    | RateLimitResult
    | null;
  if (!result) throw new Error("Rate limit result is unavailable");
  if (!result.allowed) {
    throw new AppError({
      message:
        "נשלחו בקשות רבות מדי. נסו שוב בעוד רגע. / Too many requests. Please try again shortly.",
      status: 429,
      code: "rate_limit_exceeded",
      details: {
        retryAfter: Math.max(1, result.retry_after_seconds)
      }
    });
  }

  return {
    remaining: Math.max(0, result.remaining)
  };
};
