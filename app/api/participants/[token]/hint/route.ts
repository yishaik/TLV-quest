import { requestHint } from "@/lib/repository";
import {
  handleRouteError,
  jsonOk,
  requireIdempotencyKey
} from "@/lib/http";
import { enforceParticipantRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    await enforceParticipantRateLimit("hint", token);
    const idempotencyKey = requireIdempotencyKey(request);
    return jsonOk(await requestHint({ token, idempotencyKey }));
  } catch (error) {
    return handleRouteError(error);
  }
}
