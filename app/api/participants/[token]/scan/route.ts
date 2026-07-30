import { recordStationScan } from "@/lib/station-scan";
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
      scope: "participant-scan",
      identifier: token,
      limit: 12,
      windowSeconds: 60
    });
    const body = await readJson<Record<string, unknown>>(request);
    const stationSlug =
      typeof body.stationSlug === "string" ? body.stationSlug : "";
    if (!stationSlug) throw new Error("Station is required");

    return jsonOk(
      await recordStationScan({
        token,
        stationSlug,
        idempotencyKey: requireIdempotencyKey(request)
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
