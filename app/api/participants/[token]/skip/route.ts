import { randomUUID } from "node:crypto";
import { skipOptionalCheckpoint } from "@/lib/runtime-progression";
import { handleRouteError, jsonOk } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    return jsonOk(
      await skipOptionalCheckpoint({
        token,
        idempotencyKey:
          request.headers.get("idempotency-key") ?? `optional-skip:${randomUUID()}`
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
