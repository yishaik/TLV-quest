import "server-only";

import { hashSecret } from "@/lib/crypto";
import {
  clientIpFromRequest,
  RATE_LIMIT_POLICIES,
  RateLimitExceededError,
  type RateLimitPolicyName
} from "@/lib/rate-limit-core";
import { createAdminClient } from "@/lib/supabase/admin";

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export const enforceRateLimit = async ({
  policyName,
  subject
}: {
  policyName: RateLimitPolicyName;
  subject: string;
}): Promise<RateLimitDecision> => {
  const policy = RATE_LIMIT_POLICIES[policyName];
  const bucketKey = `${policy.scope}:${hashSecret(`${policy.scope}:${subject}`)}`;
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("consume_rate_limit", {
    p_bucket_key: bucketKey,
    p_limit: policy.limit,
    p_window_seconds: policy.windowSeconds
  });
  if (error) throw error;

  const result = asRecord(Array.isArray(data) ? data[0] : data);
  if (
    typeof result.allowed !== "boolean" ||
    typeof result.remaining !== "number" ||
    typeof result.retry_after_seconds !== "number"
  ) {
    throw new Error("rate_limit_result_invalid");
  }

  const decision: RateLimitDecision = {
    allowed: result.allowed,
    limit: policy.limit,
    remaining: Math.max(0, Math.floor(result.remaining)),
    retryAfterSeconds: Math.max(0, Math.ceil(result.retry_after_seconds))
  };
  if (!decision.allowed) {
    throw new RateLimitExceededError(
      policy.scope,
      Math.max(1, decision.retryAfterSeconds)
    );
  }
  return decision;
};

export const enforceParticipantRateLimit = (
  policyName: "answer" | "hint" | "participantState",
  token: string
) => enforceRateLimit({ policyName, subject: `participant:${token}` });

export const enforceIpRateLimit = (
  policyName: "join" | "leads" | "worker",
  request: Request
) =>
  enforceRateLimit({
    policyName,
    subject: `ip:${clientIpFromRequest(request)}`
  });

export const cleanupRateLimitBuckets = async (batchSize = 1_000) => {
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("cleanup_rate_limit_buckets", {
    p_batch_size: Math.max(1, Math.min(5_000, Math.floor(batchSize)))
  });
  if (error) throw error;
  return { deleted: typeof data === "number" ? data : 0 };
};
