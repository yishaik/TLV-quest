import { skipOptionalCheckpoint } from "@/lib/runtime-progression";
import { handleRouteError, jsonOk, requireIdempotencyKey } from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    await enforceRateLimit({
      scope: "participant-skip",
      identifier: token,
      limit: 5,
      windowSeconds: 60
    });
    return jsonOk(
      await skipOptionalCheckpoint({
        token,
        idempotencyKey: requireIdempotencyKey(request)
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
