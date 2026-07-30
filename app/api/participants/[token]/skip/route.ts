import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { skipOptionalCheckpoint } from "@/lib/runtime-progression";
import { handleRouteError, jsonOk } from "@/lib/http";
import { processOutbox } from "@/lib/providers";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const result = await skipOptionalCheckpoint({
      token,
      idempotencyKey:
        request.headers.get("idempotency-key") ?? `optional-skip:${randomUUID()}`
    });
    const outboxIds = result.delivery.outboxIds;
    if (outboxIds.length) {
      after(async () => {
        try {
          await processOutbox(outboxIds.length, { outboxIds });
        } catch {
          console.error("checkpoint_skip.low_latency_kick_failed", {
            actorType: "participant",
            queued: outboxIds.length,
            errorCode: "outbox_kick_failed"
          });
        }
      });
    }
    return jsonOk({
      ...result,
      delivery: { queued: result.delivery.queued }
    });
  } catch (error) {
    return handleRouteError(error);
  }
}
