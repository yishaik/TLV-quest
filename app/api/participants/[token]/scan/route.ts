import { randomUUID } from "node:crypto";
import { verifyStationScan } from "@/lib/physical-actions";
import { handleRouteError, jsonOk, readJson } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params;
    const body = await readJson<Record<string, unknown>>(request);
    const stationSlug =
      typeof body.stationSlug === "string" ? body.stationSlug : "";
    if (!stationSlug) throw new Error("Station is required");

    return jsonOk(
      await verifyStationScan({
        token,
        stationSlug,
        idempotencyKey:
          request.headers.get("idempotency-key") ?? `scan:${randomUUID()}`
      })
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
