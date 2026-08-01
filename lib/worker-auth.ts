import "server-only";

import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const bearerToken = (request: Request): string | null => {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer (\S{32,256})$/);
  return match?.[1] ?? null;
};

const equalSecret = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
};

/**
 * Authorizes a background worker request from either credential:
 *
 *   - the configured `WORKER_SECRET`, for manual and external invocation;
 *   - a single-use token minted inside Postgres, for pg_cron schedules.
 *
 * The minted-token path is what lets `pg_cron` drive the workers without a
 * long-lived secret being stored in the database. The token table is still
 * named `outbox_worker_tokens` for historical reasons; it backs every
 * scheduled worker, not just the outbox.
 */
export const authorizeWorkerRequest = async (
  request: Request
): Promise<boolean> => {
  const token = bearerToken(request);
  if (!token) return false;

  const configuredSecret = process.env.WORKER_SECRET?.trim();
  if (configuredSecret && equalSecret(token, configuredSecret)) return true;

  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("consume_outbox_worker_token", {
    p_token: token
  });
  if (error) {
    console.error("worker.auth_failed", {
      errorCode: "worker_token_validation_failed"
    });
    return false;
  }

  return data === true;
};
