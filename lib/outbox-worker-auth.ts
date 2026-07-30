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

export const authorizeOutboxWorker = async (
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
    console.error("outbox.worker_auth_failed", {
      errorCode: "worker_token_validation_failed"
    });
    return false;
  }

  return data === true;
};
