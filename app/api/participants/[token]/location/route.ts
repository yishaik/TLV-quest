import { verifyLocation } from "@/lib/physical-actions";
import {
  handleRouteError,
  jsonOk,
  readJson,
  requireIdempotencyKey
} from "@/lib/http";
import { enforceRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    await enforceRateLimit({
      scope: "participant-location",
      identifier: token,
      limit: 12,
      windowSeconds: 60
    });
    const body = await readJson<Record<string, unknown>>(request);
    if (typeof body.latitude !== "number" || typeof body.longitude !== "number") {
      throw new Error("Valid latitude and longitude are required");
    }

    return jsonOk(
      await verifyLocation({
        token,
        latitude: body.latitude,
        longitude: body.longitude,
        idempotencyKey: requireIdempotencyKey(request)
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
