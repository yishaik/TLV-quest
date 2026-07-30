import { requestHint } from "@/lib/repository";
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
      scope: "participant-hint",
      identifier: token,
      limit: 5,
      windowSeconds: 60
    });
    const idempotencyKey = requireIdempotencyKey(request);
    return jsonOk(await requestHint({ token, idempotencyKey }));
  } catch (error) {
    return handleRouteError(error);
  }
}
